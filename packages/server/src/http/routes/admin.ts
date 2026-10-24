/**
 * 后台接口。
 *
 * 全部挂在 `/api/admin` 下，统一 `preHandler: requireAuth + requireAdmin`。
 * 分页一律用 `cursor`（上一页最后一条的 id）而不是 `offset` ——
 * 用户表在增长，offset 翻到第 100 页会越翻越慢，而且翻页期间新注册的人
 * 会让同一条记录出现两次。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/client.ts'
import { err } from '../errors.ts'
import { requireAdmin } from '../middleware/requireAdmin.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import {
  ADMIN_ACTIONS,
  ROLE,
  ROLE_LABEL,
  assertCanActOn,
  audit,
  assertAtLeast,
} from '../../services/admin.ts'
import { kickUser, onlineCount } from '../../ws/gateway.ts'
import { assertNickname } from '../../services/user.ts'

const PAGE = z.object({
  cursor: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
})

const banBody = z.object({
  /** 封禁小时数。0 表示永久 */
  hours: z.number().int().min(0).max(24 * 365 * 10),
  reason: z.string().min(1).max(200),
  /** 顺带把人踢下线 */
  kick: z.boolean().default(true),
})

const roleBody = z.object({
  role: z.number().int().min(0).max(2),
})

const nickBody = z.object({
  nickname: z.string().max(64),
})

function actorOf(req: FastifyRequest): bigint {
  const uid = req.user?.sub
  if (!uid) throw err.unauthorized()
  return BigInt(uid)
}

function ipOf(req: FastifyRequest): string {
  return req.ip ?? ''
}

/** 统一的用户行形状。**passwordHash 永不出库** */
const userSelect = {
  uid: true,
  nickname: true,
  email: true,
  isGuest: true,
  role: true,
  rating: true,
  wins: true,
  losses: true,
  bannedUntil: true,
  banReason: true,
  lastLoginAt: true,
  createdAt: true,
} as const

interface UserRow {
  uid: bigint
  nickname: string
  email: string | null
  isGuest: boolean
  role: number
  rating: number
  wins: number
  losses: number
  bannedUntil: Date | null
  banReason: string | null
  lastLoginAt: Date | null
  createdAt: Date
}

function shapeUser(u: UserRow) {
  return {
    uid: u.uid.toString(),
    nickname: u.nickname,
    email: u.email,
    isGuest: u.isGuest,
    role: u.role,
    roleLabel: ROLE_LABEL[u.role] ?? '未知',
    rating: u.rating,
    wins: u.wins,
    losses: u.losses,
    bannedUntil: u.bannedUntil?.toISOString() ?? null,
    banReason: u.banReason,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }
}

function listQuery(req: FastifyRequest): {
  cursor?: number
  take: number
  keyword: string
  filter: string
} {
  const q = PAGE.parse(req.query)
  const raw = req.query as { keyword?: unknown; filter?: unknown }
  return {
    ...q,
    keyword: typeof raw.keyword === 'string' ? raw.keyword.trim() : '',
    filter: typeof raw.filter === 'string' ? raw.filter : 'all',
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // 整个前缀都要登录 + 管理员（或审核员）
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireAdmin)

  // ------------------------------------------------------------ 我是谁
  app.get('/me', async (req) => {
    const uid = actorOf(req)
    const me = await prisma.user.findUnique({
      where: { uid },
      select: { uid: true, nickname: true, role: true },
    })
    if (!me) throw err.unauthorized()
    return {
      ok: true,
      data: {
        uid: me.uid.toString(),
        nickname: me.nickname,
        role: me.role,
        roleLabel: ROLE_LABEL[me.role] ?? '未知',
      },
    }
  })

  // ---------------------------------------------------------- 概览指标
  app.get('/stats', async () => {
    const now = new Date()
    const dayAgo = new Date(now.getTime() - 24 * 3600_000)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000)

    const [
      totalUsers,
      guests,
      registered,
      newUsers24h,
      activeUsers7d,
      matches24h,
      banned,
      matchesTotal,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isGuest: true } }),
      prisma.user.count({ where: { isGuest: false } }),
      prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: weekAgo } } }),
      prisma.match.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.user.count({ where: { bannedUntil: { gt: now } } }),
      prisma.match.count(),
    ])

    return {
      ok: true,
      data: {
        users: { total: totalUsers, guests, registered, new24h: newUsers24h, active7d: activeUsers7d },
        matches: { total: matchesTotal, last24h: matches24h },
        moderation: { banned },
        online: onlineCount(),
        serverTime: now.toISOString(),
      },
    }
  })

  // ------------------------------------------------------------ 用户列表
  app.get('/users', async (req) => {
    const q = listQuery(req)

    const where: Record<string, unknown> = {}
    if (q.keyword) {
      // 纯数字按 uid 精确查，否则按昵称/邮箱模糊查
      if (/^\d+$/.test(q.keyword)) {
        where.uid = BigInt(q.keyword)
      } else {
        where.OR = [{ nickname: { contains: q.keyword } }, { email: { contains: q.keyword } }]
      }
    }
    if (q.filter === 'guest') where.isGuest = true
    if (q.filter === 'registered') where.isGuest = false
    if (q.filter === 'banned') where.bannedUntil = { gt: new Date() }
    if (q.filter === 'staff') where.role = { gt: 0 }

    const rows = await prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { uid: 'desc' },
      take: q.take + 1,
      ...(q.cursor ? { cursor: { uid: BigInt(q.cursor) }, skip: 1 } : {}),
    })

    const hasMore = rows.length > q.take
    const page = hasMore ? rows.slice(0, q.take) : rows

    return {
      ok: true,
      data: {
        items: page.map((u) => shapeUser(u as UserRow)),
        nextCursor: hasMore ? page[page.length - 1]!.uid.toString() : null,
      },
    }
  })

  // ------------------------------------------------------------ 用户详情
  app.get('/users/:uid', async (req) => {
    const uid = BigInt((req.params as { uid: string }).uid)
    const u = await prisma.user.findUnique({ where: { uid }, select: userSelect })
    if (!u) throw err.notFound('USER_NOT_FOUND', '用户不存在')

    const [sessions, matches] = await Promise.all([
      prisma.userSession.findMany({
        where: { userId: uid },
        select: {
          id: true,
          userAgent: true,
          ip: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
        orderBy: { id: 'desc' },
        take: 20,
      }),
      prisma.matchPlayer.findMany({
        where: { uid },
        select: {
          matchId: true,
          slot: true,
          charId: true,
          stocksLeft: true,
          damageDealt: true,
          maxCombo: true,
        },
        orderBy: { id: 'desc' },
        take: 20,
      }),
    ])

    return {
      ok: true,
      data: {
        user: shapeUser(u as UserRow),
        sessions: sessions.map((s) => ({
          id: s.id.toString(),
          userAgent: s.userAgent,
          ip: s.ip,
          expiresAt: s.expiresAt.toISOString(),
          revokedAt: s.revokedAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
        })),
        recentMatches: matches.map((m) => ({
          matchId: m.matchId.toString(),
          slot: m.slot,
          charId: m.charId,
          stocksLeft: m.stocksLeft,
          damageDealt: m.damageDealt,
          maxCombo: m.maxCombo,
        })),
      },
    }
  })

  // -------------------------------------------------------------- 封禁
  app.post('/users/:uid/ban', async (req) => {
    const actor = actorOf(req)
    const actorRole = await assertAtLeast(actor, ROLE.MODERATOR)
    const targetUid = BigInt((req.params as { uid: string }).uid)
    const body = banBody.parse(req.body)

    const target = await prisma.user.findUnique({
      where: { uid: targetUid },
      select: { uid: true, role: true, nickname: true },
    })
    if (!target) throw err.notFound('USER_NOT_FOUND', '用户不存在')
    assertCanActOn(actor, actorRole, targetUid, target.role)

    const until =
      body.hours === 0
        ? new Date('9999-12-31T00:00:00Z')
        : new Date(Date.now() + body.hours * 3600_000)

    // 先审计再执行：审计写不进去，这次封禁就不该发生
    await audit({
      actorUid: actor,
      action: ADMIN_ACTIONS.USER_BAN,
      targetType: 'user',
      targetId: targetUid.toString(),
      detail: `封禁 ${body.hours === 0 ? '永久' : `${body.hours} 小时`}：${body.reason}`,
      ip: ipOf(req),
    })

    await prisma.user.update({
      where: { uid: targetUid },
      data: { bannedUntil: until, banReason: body.reason.slice(0, 255) },
    })

    let revoked = 0
    if (body.kick) {
      revoked = (
        await prisma.userSession.updateMany({
          where: { userId: targetUid, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      ).count
      kickUser(targetUid, 'banned')
    }

    return { ok: true, data: { bannedUntil: until.toISOString(), revokedSessions: revoked } }
  })

  // -------------------------------------------------------------- 解封
  app.post('/users/:uid/unban', async (req) => {
    const actor = actorOf(req)
    const actorRole = await assertAtLeast(actor, ROLE.MODERATOR)
    const targetUid = BigInt((req.params as { uid: string }).uid)

    const target = await prisma.user.findUnique({
      where: { uid: targetUid },
      select: { role: true },
    })
    if (!target) throw err.notFound('USER_NOT_FOUND', '用户不存在')
    assertCanActOn(actor, actorRole, targetUid, target.role)

    await audit({
      actorUid: actor,
      action: ADMIN_ACTIONS.USER_UNBAN,
      targetType: 'user',
      targetId: targetUid.toString(),
      detail: '解除封禁',
      ip: ipOf(req),
    })

    await prisma.user.update({
      where: { uid: targetUid },
      data: { bannedUntil: null, banReason: null },
    })
    return { ok: true, data: { unbanned: true } }
  })

  // ------------------------------------------------------------ 改角色
  app.post('/users/:uid/role', async (req) => {
    const actor = actorOf(req)
    await assertAtLeast(actor, ROLE.ADMIN)
    const targetUid = BigInt((req.params as { uid: string }).uid)
    const body = roleBody.parse(req.body)

    if (targetUid === actor && body.role !== ROLE.ADMIN) {
      // 允许自己降级，但要拦住"顺手把自己变成玩家然后没人能管"
      const admins = await prisma.user.count({ where: { role: ROLE.ADMIN } })
      if (admins <= 1) throw err.badRequest('LAST_ADMIN', '这是最后一个管理员，不能降级')
    }

    await audit({
      actorUid: actor,
      action: ADMIN_ACTIONS.USER_SET_ROLE,
      targetType: 'user',
      targetId: targetUid.toString(),
      detail: `角色 → ${ROLE_LABEL[body.role] ?? body.role}`,
      ip: ipOf(req),
    })

    await prisma.user.update({ where: { uid: targetUid }, data: { role: body.role } })
    return { ok: true, data: { role: body.role } }
  })

  // -------------------------------------------------------- 强制下线
  app.post('/users/:uid/revoke-sessions', async (req) => {
    const actor = actorOf(req)
    const actorRole = await assertAtLeast(actor, ROLE.MODERATOR)
    const targetUid = BigInt((req.params as { uid: string }).uid)

    const target = await prisma.user.findUnique({
      where: { uid: targetUid },
      select: { role: true },
    })
    if (!target) throw err.notFound('USER_NOT_FOUND', '用户不存在')
    assertCanActOn(actor, actorRole, targetUid, target.role)

    await audit({
      actorUid: actor,
      action: ADMIN_ACTIONS.USER_REVOKE_SESSIONS,
      targetType: 'user',
      targetId: targetUid.toString(),
      detail: '强制下线',
      ip: ipOf(req),
    })

    const res = await prisma.userSession.updateMany({
      where: { userId: targetUid, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    kickUser(targetUid, 'kicked')
    return { ok: true, data: { revoked: res.count } }
  })

  // ------------------------------------------------------------ 改昵称
  app.post('/users/:uid/nickname', async (req) => {
    const actor = actorOf(req)
    const actorRole = await assertAtLeast(actor, ROLE.MODERATOR)
    const targetUid = BigInt((req.params as { uid: string }).uid)
    const { nickname } = nickBody.parse(req.body)
    const trimmed = nickname.trim()
    assertNickname(trimmed)

    const target = await prisma.user.findUnique({
      where: { uid: targetUid },
      select: { role: true, nickname: true },
    })
    if (!target) throw err.notFound('USER_NOT_FOUND', '用户不存在')
    assertCanActOn(actor, actorRole, targetUid, target.role)

    await audit({
      actorUid: actor,
      action: ADMIN_ACTIONS.USER_SET_NICKNAME,
      targetType: 'user',
      targetId: targetUid.toString(),
      detail: `${target.nickname} → ${trimmed}`,
      ip: ipOf(req),
    })

    await prisma.user.update({ where: { uid: targetUid }, data: { nickname: trimmed } })
    return { ok: true, data: { nickname: trimmed } }
  })

  // ------------------------------------------------------------ 对局列表
  app.get('/matches', async (req) => {
    const q = PAGE.parse(req.query)
    const rows = await prisma.match.findMany({
      select: {
        id: true,
        publicId: true,
        stageId: true,
        mode: true,
        winnerSlot: true,
        durationMs: true,
        createdAt: true,
      },
      orderBy: { id: 'desc' },
      take: q.take + 1,
      ...(q.cursor ? { cursor: { id: BigInt(q.cursor) }, skip: 1 } : {}),
    })
    const hasMore = rows.length > q.take
    const page = hasMore ? rows.slice(0, q.take) : rows

    const ids = page.map((r) => r.id)
    const players = ids.length
      ? await prisma.matchPlayer.findMany({
          where: { matchId: { in: ids } },
          select: {
            matchId: true,
            uid: true,
            slot: true,
            charId: true,
            stocksLeft: true,
            damageDealt: true,
          },
        })
      : []

    const byMatch = new Map<string, typeof players>()
    for (const p of players) {
      const k = p.matchId.toString()
      const arr = byMatch.get(k) ?? []
      arr.push(p)
      byMatch.set(k, arr)
    }

    return {
      ok: true,
      data: {
        items: page.map((m) => ({
          matchId: m.id.toString(),
          publicId: m.publicId,
          stageId: m.stageId,
          mode: m.mode,
          winnerSlot: m.winnerSlot,
          durationMs: m.durationMs,
          createdAt: m.createdAt.toISOString(),
          players: (byMatch.get(m.id.toString()) ?? []).map((p) => ({
            uid: p.uid.toString(),
            slot: p.slot,
            charId: p.charId,
            stocksLeft: p.stocksLeft,
            damageDealt: p.damageDealt,
          })),
        })),
        nextCursor: hasMore ? page[page.length - 1]!.id.toString() : null,
      },
    }
  })

  // ------------------------------------------------------------ 审计日志
  app.get('/audit', async (req) => {
    const q = PAGE.parse(req.query)
    const rows = await prisma.adminAuditLog.findMany({
      orderBy: { id: 'desc' },
      take: q.take + 1,
      ...(q.cursor ? { cursor: { id: BigInt(q.cursor) }, skip: 1 } : {}),
    })
    const hasMore = rows.length > q.take
    const page = hasMore ? rows.slice(0, q.take) : rows

    const actorIds = [...new Set(page.map((r) => r.actorUid))]
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { uid: { in: actorIds } },
          select: { uid: true, nickname: true },
        })
      : []
    const nameOf = new Map(actors.map((a) => [a.uid.toString(), a.nickname]))

    return {
      ok: true,
      data: {
        items: page.map((r) => ({
          id: r.id.toString(),
          actorUid: r.actorUid.toString(),
          actorNickname: nameOf.get(r.actorUid.toString()) ?? '(已删除)',
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          detail: r.detail,
          ip: r.ip,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? page[page.length - 1]!.id.toString() : null,
      },
    }
  })
}
