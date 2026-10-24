/**
 * Fastify 实例组装。
 *
 * 插件顺序有讲究：cookie 必须在路由之前注册，websocket 要在任何
 * `app.get(..., { websocket: true })` 之前注册。
 */
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import { ZodError } from 'zod'
import { config } from '../config.ts'
import { ApiError, err } from './errors.ts'
import { healthRoutes } from './routes/health.ts'
import { authRoutes } from './routes/auth.ts'
import { adminRoutes } from './routes/admin.ts'
import { registerWsGateway } from '../ws/gateway.ts'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.isProd ? 'info' : 'debug',
      transport: config.isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,reqId' },
          },
    },
    // 前面有 Nginx 时要信任它给的 X-Forwarded-For，否则所有 IP 都是 127.0.0.1
    trustProxy: config.isProd,
    bodyLimit: 256 * 1024,
  })

  await app.register(cors, {
    origin: (origin, cb) => {
      // 无 Origin（curl、同源、服务端调用）直接放行
      if (!origin) return cb(null, true)
      if (config.corsOrigins.includes(origin)) return cb(null, true)
      cb(new Error(`CORS 拒绝：${origin}`), false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  await app.register(cookie)

  await app.register(rateLimit, {
    // 开发期用内存；上 Redis 后换成 redis 客户端即可（见 docs/05-server.md）
    max: 300,
    timeWindow: '1 minute',
    allowList: [],
    errorResponseBuilder: () => ({
      ok: false,
      error: { code: 'RATE_LIMITED', message: '请求太频繁，请稍后再试' },
    }),
  })

  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  })

  // ---- 空 body 的 POST ----
  // /api/auth/refresh 与 /api/auth/logout 没有请求体，凭 cookie 就能干活。
  // 但不少客户端（.NET 的 HttpClient、部分 fetch 封装）会硬塞一个
  // Content-Type 上去，Fastify 找不到对应解析器就回 415 —— 让一个本来
  // 合法的请求因为"没内容"而被拒，属于把工具的限制当成协议的限制。
  // 这里只放宽一件事：**空的请求体**，不管声明成什么类型都当 {} 处理；
  // 非空的未知类型仍然拒绝，避免有人拿表单塞 JSON。
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    const buf = body as Buffer
    if (buf.length === 0) {
      done(null, {})
      return
    }
    done(err.badRequest('UNSUPPORTED_CONTENT_TYPE', '只接受 application/json'), undefined)
  })

  // ---- 错误处理：所有异常收敛成统一形状 ----
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError) {
      reply.code(error.status)
      return reply.send({
        ok: false,
        error: { code: error.code, message: error.message, detail: error.detail },
      })
    }

    if (error instanceof ZodError) {
      reply.code(400)
      return reply.send({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: '请求参数不合法',
          detail: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      })
    }

    // Fastify 的 error 在类型上是 unknown（插件可能抛任何东西），
    // 所以先收窄到一个带 statusCode 的形状再继续判断
    const e = error as Error & { statusCode?: number }

    // 限流插件的错误已经自己拼好了形状
    if (e.statusCode === 429) {
      reply.code(429)
      return reply.send({
        ok: false,
        error: { code: 'RATE_LIMITED', message: '请求太频繁，请稍后再试' },
      })
    }

    const status = e.statusCode ?? 500
    if (status >= 500) {
      req.log.error({ err: e }, 'unhandled error')
      reply.code(500)
      return reply.send({
        ok: false,
        error: { code: 'INTERNAL', message: '服务器出错了' },
      })
    }

    reply.code(status)
    return reply.send({
      ok: false,
      error: { code: 'BAD_REQUEST', message: e.message },
    })
  })

  app.setNotFoundHandler((req, reply) => {
    reply.code(404)
    return reply.send({
      ok: false,
      error: { code: 'NOT_FOUND', message: `没有这个接口：${req.method} ${req.url}` },
    })
  })

  // ---- 路由 ----
  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(adminRoutes, { prefix: '/api/admin' })

  // ---- WebSocket ----
  await registerWsGateway(app)

  return app
}
