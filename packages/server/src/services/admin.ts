/**
 * 后台权限与审计。
 *
 * 三条原则（见 docs/08-admin.md 第 3 章）：
 *   1. 角色写进数据库，不写进 JWT —— 否则撤销一个 GM 要等他的 access 过期
 *   2. 每个写操作**先审计再执行**，审计失败就整体失败 ——
 *      宁可这次封禁没生效，也不能出现"封了但没人知道谁封的"
 *   3. 审计表只增不改不删
 */
import { prisma } from '../db/client.ts'
import { err } from '../http/errors.ts'

export const ROLE = {
  PLAYER: 0,
  MODERATOR: 1,
  ADMIN: 2,
} as const

export type Role = (typeof ROLE)[keyof typeof ROLE]

export const ROLE_LABEL: Record<number, string> = {
  0: '玩家',
  1: '审核员',
  2: '管理员',
}

/** 动作码。前后端共用一份，避免后台菜单和日志里的字符串飘成两套 */
export const ADMIN_ACTIONS = {
  USER_BAN: 'user.ban',
  USER_UNBAN: 'user.unban',
  USER_SET_ROLE: 'user.setRole',
  USER_REVOKE_SESSIONS: 'user.revokeSessions',
  USER_SET_NICKNAME: 'user.setNickname',
} as const

export interface AuditInput {
  actorUid: bigint
  action: string
  targetType: string
  targetId: string
  detail?: string | null
  ip?: string | null
}

/** 写一条审计。detail 超长截断而不是报错 —— 丢几个字好过丢整条记录 */
export async function audit(input: AuditInput): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      actorUid: input.actorUid,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: input.detail ? input.detail.slice(0, 512) : null,
      ip: input.ip ? input.ip.slice(0, 45) : null,
    },
  })
}

/** 读当前用户的角色。查不到用户当 0 —— 删号之后残留的 token 不该有权限 */
export async function roleOf(uid: bigint): Promise<Role> {
  const row = await prisma.user.findUnique({
    where: { uid },
    select: { role: true },
  })
  if (!row) return ROLE.PLAYER
  return (row.role as Role) ?? ROLE.PLAYER
}

export async function assertAtLeast(uid: bigint, need: Role): Promise<Role> {
  const role = await roleOf(uid)
  if (role < need) {
    throw err.forbidden('FORBIDDEN', need === ROLE.ADMIN ? '需要管理员权限' : '需要审核权限')
  }
  return role
}

/**
 * 能不能动这个人。
 *
 * 两条规则：
 *   1. **不能动自己** —— 自封自己的号、自撤自己的会话，除了把自己锁在门外
 *      没有任何收益。真正的自伤场景（想注销）应该走另一个流程。
 *   2. **不能动权限比自己高的人** —— 审核员封不了管理员。
 *
 * 注意同级之间是**允许**互相操作的：只防"自己"，不防"同级"。
 * 否则两个管理员互为镜像时，谁也没法处理谁，只能去服务器上改库。
 */
export function assertCanActOn(actorUid: bigint, actorRole: Role, targetUid: bigint, targetRole: number): void {
  if (actorUid === targetUid) {
    throw err.badRequest('CANNOT_ACT_ON_SELF', '不能对自己执行这个操作')
  }
  if (targetRole > actorRole) {
    throw err.forbidden('CANNOT_ACT_ON_PEER', '不能操作权限更高的账号')
  }
}
