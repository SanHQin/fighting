/**
 * 账号接口。见 docs/06-account.md 1.10。
 *
 * 响应形状统一 `{ ok: true, data }` / `{ ok: false, error: { code, message } }`，
 * 由 errorHandler 兜底，这里只管 throw。
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { config } from '../../config.ts'
import { prisma } from '../../db/client.ts'
import { err } from '../errors.ts'
import { currentUid, readAuth, requireAuth } from '../middleware/requireAuth.ts'
import { signAccessToken, accessTokenTtlSec } from '../../security/jwt.ts'
import { hashPassword } from '../../security/argon2.ts'
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../../security/refreshToken.ts'
import { revokeAllSessions, revokeSession, rotateSession, startSession } from '../../services/session.ts'
import {
  assertEmail,
  assertNickname,
  assertPassword,
  createGuest,
  createRegistered,
  fetchUser,
  loginWithPassword,
  toPublicUser,
  type PublicUser,
} from '../../services/user.ts'

// zod 只负责「形状」：字段在不在、是不是字符串、别超长到能撑爆内存。
// 「多长算合法」是**业务策略**，交给 services/user.ts 的 assertXxx ——
// 那里能给出中文的、带具体数字的提示（"密码至少 8 位"），
// 而 zod 的默认提示是英文的 "Too small: expected string to have >=8 characters"，
// 而且同一件事在两处校验必然有一天漂移成两套规则。
const registerBody = z.object({
  email: z.string().max(190),
  nickname: z.string().max(64),
  password: z.string().max(200),
})

const loginBody = z.object({
  email: z.string().max(190),
  password: z.string().max(200),
})

interface ClientMeta {
  userAgent: string | undefined
  ip: string | undefined
}

function metaOf(req: { headers: Record<string, unknown>; ip: string }): ClientMeta {
  const ua = req.headers['user-agent']
  return { userAgent: typeof ua === 'string' ? ua : undefined, ip: req.ip }
}

function setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    expires: expiresAt,
  })
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })
}

interface AuthPayload {
  user: PublicUser
  accessToken: string
  expiresIn: number
}

async function issue(
  reply: FastifyReply,
  uid: bigint,
  user: PublicUser,
  m: ClientMeta,
): Promise<AuthPayload> {
  const session = await startSession(uid, m)
  setRefreshCookie(reply, session.refreshToken, session.expiresAt)
  const accessToken = await signAccessToken({
    sub: uid.toString(),
    guest: user.isGuest,
    nick: user.nickname,
  })
  return { user, accessToken, expiresIn: accessTokenTtlSec }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** 游客登录：进游戏就能打，不用注册 */
  app.post('/guest', async (req, reply) => {
    const { user, uid } = await createGuest(metaOf(req))
    return { ok: true, data: await issue(reply, uid, user, metaOf(req)) }
  })

  app.post('/register', async (req, reply) => {
    const body = registerBody.parse(req.body)
    const { user, uid } = await createRegistered(body)
    return { ok: true, data: await issue(reply, uid, user, metaOf(req)) }
  })

  app.post('/login', async (req, reply) => {
    const body = loginBody.parse(req.body)
    const { user, uid } = await loginWithPassword(body)
    return { ok: true, data: await issue(reply, uid, user, metaOf(req)) }
  })

  /** 刷新：拿 cookie 换一对新令牌。旧 refresh 立即失效（5 秒宽限给多标签页） */
  app.post('/refresh', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE_NAME]
    if (!token) throw err.unauthorized('NO_REFRESH', '没有登录状态')
    const rotated = await rotateSession(token, metaOf(req))
    const user = await fetchUser(rotated.uid)
    if (!user) throw err.unauthorized('USER_GONE', '账号不存在')
    setRefreshCookie(reply, rotated.refreshToken, rotated.expiresAt)
    const accessToken = await signAccessToken({
      sub: rotated.uid.toString(),
      guest: user.isGuest,
      nick: user.nickname,
    })
    return { ok: true, data: { user, accessToken, expiresIn: accessTokenTtlSec } }
  })

  /** 登出当前设备。幂等 —— 没有会话也返回成功 */
  app.post('/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE_NAME]
    if (token) await revokeSession(token)
    clearRefreshCookie(reply)
    return { ok: true, data: { revoked: true } }
  })

  app.post('/logout-all', { preHandler: requireAuth }, async (req, reply) => {
    const count = await revokeAllSessions(currentUid(req))
    clearRefreshCookie(reply)
    return { ok: true, data: { revoked: count } }
  })

  /** 取当前用户。前端启动时用它判断会话是否还有效 */
  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const user = await fetchUser(currentUid(req))
    if (!user) throw err.unauthorized('USER_GONE', '账号不存在')
    return { ok: true, data: { user, expiresIn: accessTokenTtlSec } }
  })

  /**
   * 游客原地升级成注册账号：同一个 uid，战绩与对局历史全部保留。
   * 这就是"游客优先"能成立的关键 —— 不需要迁移任何数据。
   * refresh 会话不动，只换一张 guest:false 的 access。
   */
  app.post('/upgrade', { preHandler: requireAuth }, async (req) => {
    const body = registerBody.parse(req.body)
    const uid = currentUid(req)

    const me = await fetchUser(uid)
    if (!me) throw err.unauthorized('USER_GONE', '账号不存在')
    if (!me.isGuest) throw err.conflict('ALREADY_REGISTERED', '这个账号已经注册过了')

    const email = assertEmail(body.email)
    assertNickname(body.nickname)
    assertPassword(body.password)

    const dupEmail = await prisma.user.findUnique({ where: { email }, select: { uid: true } })
    if (dupEmail) throw err.conflict('EMAIL_TAKEN', '这个邮箱已经注册过了')

    const dupNick = await prisma.user.findFirst({
      where: { nickname: body.nickname, NOT: { uid } },
      select: { uid: true },
    })
    if (dupNick) throw err.conflict('NICKNAME_TAKEN', '这个昵称已经被占了')

    const passwordHash = await hashPassword(body.password)
    const row = await prisma.user.update({
      where: { uid },
      data: { email, nickname: body.nickname, passwordHash, isGuest: false },
      select: {
        uid: true,
        nickname: true,
        isGuest: true,
        email: true,
        rating: true,
        ratingDev: true,
        wins: true,
        losses: true,
        avatarHue: true,
        bannedUntil: true,
        createdAt: true,
      },
    })

    const user = toPublicUser(row)
    const accessToken = await signAccessToken({
      sub: uid.toString(),
      guest: false,
      nick: user.nickname,
    })
    return { ok: true, data: { user, accessToken, expiresIn: accessTokenTtlSec } }
  })

  /** 会话探测：不报错，让前端决定要不要弹登录 */
  app.get('/probe', async (req) => {
    const claims = await readAuth(req)
    return {
      ok: true,
      data: { authenticated: claims !== null, guest: claims?.guest ?? null },
    }
  })
}
