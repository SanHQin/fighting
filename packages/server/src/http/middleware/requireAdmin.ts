/**
 * 管理员鉴权。
 *
 * 为什么不把 role 塞进 JWT：那样撤销一个 GM 要等他手里的 access 过期
 * （最长 15 分钟）。多查一次库换 15 分钟的权限真空，值。
 */
import type { FastifyReply, FastifyRequest } from 'fastify'
import { err } from '../errors.ts'
import { ROLE, assertAtLeast } from '../../services/admin.ts'

export async function requireAdmin(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const sub = req.user?.sub
  if (!sub) throw err.unauthorized()
  await assertAtLeast(BigInt(sub), ROLE.MODERATOR)
}

export async function requireSuperAdmin(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const sub = req.user?.sub
  if (!sub) throw err.unauthorized()
  await assertAtLeast(BigInt(sub), ROLE.ADMIN)
}
