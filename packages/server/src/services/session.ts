/**
 * 会话：签发、轮换、吊销。
 *
 * 轮换是本项目最容易被写错的一段，见 docs/06-account.md 1.5：
 *   1. 查不到 → 401
 *   2. 查到但 revokedAt 非空 → 判定被盗，把这个用户**所有**未吊销会话全部作废
 *   3. 正常 → 事务内「旧置 revokedAt + 新建一条」
 * 多标签页并发刷新靠宽限期（REFRESH_GRACE_SEC）放行，不靠客户端配合。
 */
import { prisma } from '../db/client.ts'
import { config } from '../config.ts'
import {
  hashRefreshToken,
  newRefreshToken,
  refreshExpiryDate,
} from '../security/refreshToken.ts'
import { err } from '../http/errors.ts'

export interface IssuedSession {
  refreshToken: string
  expiresAt: Date
  sessionId: bigint
}

export interface RequestMeta {
  userAgent?: string | undefined
  ip?: string | undefined
}

async function createSession(
  uid: bigint,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const token = newRefreshToken()
  const expiresAt = refreshExpiryDate()
  const row = await prisma.userSession.create({
    data: {
      userId: uid,
      refreshTokenHash: hashRefreshToken(token),
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      ip: meta.ip?.slice(0, 45) ?? null,
      expiresAt,
    },
    select: { id: true },
  })
  return { refreshToken: token, expiresAt, sessionId: row.id }
}

/** 登录/注册/游客成功时调用 */
export function startSession(uid: bigint, meta: RequestMeta): Promise<IssuedSession> {
  return createSession(uid, meta)
}

export interface RotatedSession extends IssuedSession {
  uid: bigint
}

/**
 * 刷新。成功返回新的 access/refresh 与 uid。
 *
 * 并发竞态的处理：先读出旧记录，如果它已经被吊销但吊销时间在宽限期内，
 * 认为是对面那个标签页刚刚轮换过，直接放行签发新的 —— 而不是判定被盗。
 */
export async function rotateSession(
  presentedToken: string,
  meta: RequestMeta,
): Promise<RotatedSession> {
  const presentedHash = hashRefreshToken(presentedToken)

  const found = await prisma.userSession.findUnique({
    where: { refreshTokenHash: presentedHash },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true },
  })

  // 场景 1：查不到
  if (!found) {
    throw err.unauthorized('INVALID_REFRESH', '登录状态已失效，请重新登录')
  }

  // 场景 2：已吊销 —— 要么是被盗用的旧令牌，要么是并发刷新
  if (found.revokedAt) {
    const ageMs = Date.now() - found.revokedAt.getTime()
    const withinGrace = ageMs <= config.REFRESH_GRACE_SEC * 1000

    // 光看"吊销时间在宽限期内"不够：登出也会把 revokedAt 设成现在，
    // 于是「登出后 5 秒内拿旧 cookie 再来一次」会被误判成并发刷新，
    // 等于给了登出一个 5 秒的撤销窗口 —— 这是真的漏洞，不是理论问题。
    //
    // 并发刷新的**唯一可信证据**是「这条记录被吊销的同时，账号下多了一条
    // 更新的会话」。登出不会产生新会话，所以找不到替身就一律按被盗处理。
    if (withinGrace) {
      const replacement = await prisma.userSession.findFirst({
        where: {
          userId: found.userId,
          createdAt: { gte: new Date(found.revokedAt.getTime() - 1000) },
          id: { not: found.id },
        },
        select: { id: true },
      })
      if (replacement) {
        const issued = await createSession(found.userId, meta)
        return { ...issued, uid: found.userId }
      }
    }

    // 判定泄露：整账号下线。这是唯一正确的反应 ——
    // 既然两个方向都可能，就当最坏情况处理，让真用户重登一次
    await prisma.userSession.updateMany({
      where: { userId: found.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    throw err.unauthorized('SESSION_COMPROMISED', '检测到异常登录，已强制下线')
  }

  // 场景 3：过期
  if (found.expiresAt.getTime() <= Date.now()) {
    await prisma.userSession.update({
      where: { id: found.id },
      data: { revokedAt: new Date() },
    })
    throw err.unauthorized('REFRESH_EXPIRED', '登录已过期，请重新登录')
  }

  // 场景 4：正常轮换
  const token = newRefreshToken()
  const expiresAt = refreshExpiryDate()
  const [, created] = await prisma.$transaction([
    prisma.userSession.update({
      where: { id: found.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    }),
    prisma.userSession.create({
      data: {
        userId: found.userId,
        refreshTokenHash: hashRefreshToken(token),
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        ip: meta.ip?.slice(0, 45) ?? null,
        expiresAt,
      },
      select: { id: true },
    }),
  ])

  return { refreshToken: token, expiresAt, sessionId: created.id, uid: found.userId }
}

/** 登出当前设备。找不到也算成功（幂等） */
export async function revokeSession(presentedToken: string): Promise<void> {
  const presentedHash = hashRefreshToken(presentedToken)
  await prisma.userSession.updateMany({
    where: { refreshTokenHash: presentedHash, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/** 登出全部设备 */
export async function revokeAllSessions(uid: bigint): Promise<number> {
  const res = await prisma.userSession.updateMany({
    where: { userId: uid, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return res.count
}
