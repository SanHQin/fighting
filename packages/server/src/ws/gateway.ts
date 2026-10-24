/**
 * WebSocket 网关（骨架）。
 *
 * 鉴权走**首条消息**而不是 query 参数：浏览器的 WebSocket 不能设 header，
 * 而 token 放 query 会进 Nginx access log。见 docs/06-account.md 1.8。
 *
 * 当前只做：连接 → 3 秒内必须 auth → 心跳 → 回显。
 * 房间与信令在 M7 接上，接口形状已经定，见 docs/05-server.md 第 2 章。
 */
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { verifyAccessToken } from '../security/jwt.ts'
import { config } from '../config.ts'

/** 首条消息必须是 auth，否则 3 秒后断开 */
const AUTH_TIMEOUT_MS = 3000
/** 心跳间隔。客户端超过 2 个周期没回就断 */
const HEARTBEAT_MS = 30_000

export const CLOSE = {
  AUTH_TIMEOUT: 4001,
  NOT_AUTHED: 4002,
  BAD_TOKEN: 4003,
  KICKED: 4004,
  SHUTDOWN: 4010,
} as const

interface Conn {
  socket: WebSocket
  uid: bigint | null
  nick: string
  alive: boolean
  authed: boolean
}

/** 在线连接。单进程内存版；多实例时要换 Redis pub/sub */
const byUid = new Map<string, Set<Conn>>()
const all = new Set<Conn>()

function addConn(c: Conn): void {
  all.add(c)
  if (!c.uid) return
  const key = c.uid.toString()
  let set = byUid.get(key)
  if (!set) {
    set = new Set()
    byUid.set(key, set)
  }
  set.add(c)
}

function dropConn(c: Conn): void {
  all.delete(c)
  if (!c.uid) return
  const key = c.uid.toString()
  const set = byUid.get(key)
  if (!set) return
  set.delete(c)
  if (set.size === 0) byUid.delete(key)
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload))
}

/** 给某个用户所有连接发消息。房间广播将来复用它 */
export function pushToUser(uid: bigint, payload: unknown): number {
  const set = byUid.get(uid.toString())
  if (!set) return 0
  for (const c of set) send(c.socket, payload)
  return set.size
}

/** 强制下线（封禁、异常登录时用） */
export function kickUser(uid: bigint, reason: string): number {
  const set = byUid.get(uid.toString())
  if (!set) return 0
  let n = 0
  for (const c of set) {
    send(c.socket, { t: 'kicked', reason })
    c.socket.close(CLOSE.KICKED, reason)
    n++
  }
  return n
}

export function onlineCount(): number {
  return all.size
}

export async function registerWsGateway(app: FastifyInstance): Promise<void> {
  // ---- 心跳：把死连接清掉，否则内存会被幽灵连接吃满 ----
  const timer = setInterval(() => {
    for (const c of all) {
      if (!c.alive) {
        c.socket.terminate()
        continue
      }
      c.alive = false
      send(c.socket, { t: 'ping', ts: Date.now() })
    }
  }, HEARTBEAT_MS)
  timer.unref()

  app.addHook('onClose', async () => {
    clearInterval(timer)
    for (const c of all) {
      try {
        c.socket.close(CLOSE.SHUTDOWN, 'server shutting down')
      } catch {
        /* 关的时候不需要再管错 */
      }
    }
    all.clear()
    byUid.clear()
  })

  app.get('/ws', { websocket: true }, (socket, req) => {
    const conn: Conn = { socket, uid: null, nick: '', alive: true, authed: false }
    addConn(conn)

    const authTimer = setTimeout(() => {
      if (!conn.authed) {
        send(socket, { t: 'error', code: 'AUTH_TIMEOUT', message: '未在 3 秒内完成鉴权' })
        socket.close(CLOSE.AUTH_TIMEOUT, 'auth timeout')
      }
    }, AUTH_TIMEOUT_MS)

    socket.on('message', (raw: Buffer) => {
      conn.alive = true

      let msg: { t?: unknown; token?: unknown } | null = null
      try {
        msg = JSON.parse(raw.toString('utf8')) as { t?: unknown; token?: unknown }
      } catch {
        send(socket, { t: 'error', code: 'BAD_JSON', message: '消息不是合法 JSON' })
        return
      }

      const type = typeof msg?.t === 'string' ? msg.t : ''

      // ---- 未鉴权：只接受 auth ----
      if (!conn.authed) {
        if (type !== 'auth') {
          socket.close(CLOSE.NOT_AUTHED, 'auth first')
          return
        }
        void (async () => {
          const token = typeof msg?.token === 'string' ? msg.token : ''
          const claims = token ? await verifyAccessToken(token) : null
          if (!claims) {
            send(socket, { t: 'error', code: 'BAD_TOKEN', message: '凭证无效' })
            socket.close(CLOSE.BAD_TOKEN, 'bad token')
            return
          }
          clearTimeout(authTimer)
          conn.authed = true
          conn.uid = BigInt(claims.sub)
          conn.nick = claims.nick
          addConn(conn)
          send(socket, {
            t: 'ready',
            uid: claims.sub,
            nick: claims.nick,
            guest: claims.guest,
            online: onlineCount(),
          })
        })()
        return
      }

      // ---- 已鉴权 ----
      switch (type) {
        case 'pong':
          return
        case 'ping':
          send(socket, { t: 'pong', ts: Date.now() })
          return
        case 'echo':
          send(socket, { t: 'echo', data: msg })
          return
        default:
          // 房间/信令/输入中继在 M7 接，先统一回 not_implemented，
          // 让前端可以按 code 分支而不是猜"为什么没反应"
          send(socket, { t: 'error', code: 'NOT_IMPLEMENTED', message: `不支持的消息：${type}` })
      }
    })

    socket.on('close', () => {
      clearTimeout(authTimer)
      dropConn(conn)
    })

    socket.on('error', (e: Error) => {
      req.log.warn({ err: e }, 'ws error')
      clearTimeout(authTimer)
      dropConn(conn)
    })

    send(socket, {
      t: 'hello',
      heartbeatMs: HEARTBEAT_MS,
      authDeadlineMs: AUTH_TIMEOUT_MS,
      env: config.NODE_ENV,
    })
  })
}
