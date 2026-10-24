/**
 * Bearer 校验中间件。
 *
 * 关键约定：任何"可选登录"的接口不要用它，用 `readAuth`。
 * 这里失败一律 401，不做"游客兜底" —— 兜底会让权限判断散落在路由里。
 */
import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyAccessToken, type AccessClaims } from '../../security/jwt.ts'
import { err } from '../errors.ts'

declare module 'fastify' {
  interface FastifyRequest {
    user?: AccessClaims
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  const token = h.slice(7).trim()
  return token ? token : null
}

/** 解析但不报错，用于"登录了就更详细、没登录也能看"的接口 */
export async function readAuth(req: FastifyRequest): Promise<AccessClaims | null> {
  const token = bearer(req)
  if (!token) return null
  const claims = await verifyAccessToken(token)
  if (claims) req.user = claims
  return claims
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = bearer(req)
  if (!token) throw err.unauthorized()
  const claims = await verifyAccessToken(token)
  if (!claims) throw err.unauthorized('TOKEN_INVALID', '登录凭证无效或已过期')
  req.user = claims
}

/** 需要注册用户（游客不行）。排位、排行榜用 */
export async function requireRegistered(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply)
  if (req.user?.guest) {
    throw err.forbidden('GUEST_NOT_ALLOWED', '这个功能需要注册账号')
  }
}

/** 取当前 uid 的 BigInt 形式。调用前必须已过 requireAuth */
export function currentUid(req: FastifyRequest): bigint {
  const sub = req.user?.sub
  if (!sub) throw err.unauthorized()
  return BigInt(sub)
}
