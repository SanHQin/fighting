/**
 * 配置。唯一来源，其余模块一律 import 这里，不许自己读 process.env。
 *
 * 为什么启动即校验：配置错在启动时炸掉，比跑到某个请求才 500 好定位得多。
 */
import 'dotenv/config'
import { z } from 'zod'

/** 布尔环境变量：只有明确写 1/true/yes 才算真 */
const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
    })

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),

  /// mysql://user:pass@host:port/database
  DATABASE_URL: z.string().min(1, '缺少 DATABASE_URL'),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),

  /// HS256 最少 32 字节
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 字符'),

  /// access token 有效期：15 分钟（见 docs/06-account.md 1.4）
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).default(15 * 60),
  /// refresh token 有效期：7 天
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().min(600).default(7 * 24 * 3600),
  /// refresh 轮换的宽限期：多标签页同时刷新时不判为盗用（秒）
  REFRESH_GRACE_SEC: z.coerce.number().int().min(0).default(5),

  /// 允许的前端来源，逗号分隔
  CORS_ORIGIN: z.string().default('http://127.0.0.1:5173'),
  /// 生产必须 true，否则 refresh cookie 不会带 Secure
  COOKIE_SECURE: boolish(false),

  /// 游客记录保留天数，超期清理
  GUEST_TTL_DAYS: z.coerce.number().int().min(1).default(30),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
  console.error('[config] 环境变量校验失败：\n' + lines.join('\n'))
  console.error('[config] 参考 .env.example 补全后重试。')
  process.exit(1)
}

const env = parsed.data

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  corsOrigins: env.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const

export type Config = typeof config
