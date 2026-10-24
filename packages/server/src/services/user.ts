/**
 * 用户：游客创建、注册、凭据校验、昵称生成。
 *
 * 游客优先（docs/06-account.md 1.1）：进游戏就能打，注册是可选的升级动作。
 */
import { prisma } from '../db/client.ts'
import { hashPassword, verifyPassword } from '../security/argon2.ts'
import { err } from '../http/errors.ts'

export const NICK_MIN = 2
export const NICK_MAX = 16
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 64

/** 允许的昵称字符：中英文数字与下划线，不含空格（空格在正文里对齐会很难看） */
const NICK_RE = /^[\p{Script=Han}A-Za-z0-9_]+$/u
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function assertNickname(nick: string): void {
  if (nick.length < NICK_MIN || nick.length > NICK_MAX) {
    throw err.badRequest('NICK_LENGTH', `昵称要 ${NICK_MIN}–${NICK_MAX} 个字符`)
  }
  if (!NICK_RE.test(nick)) {
    throw err.badRequest('NICK_CHARSET', '昵称只能用中英文、数字、下划线')
  }
}

export function assertEmail(raw: string): string {
  const email = normalizeEmail(raw)
  if (email.length > 190 || !EMAIL_RE.test(email)) {
    throw err.badRequest('EMAIL_INVALID', '邮箱格式不对')
  }
  return email
}

export function assertPassword(pw: string): void {
  if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) {
    throw err.badRequest('PASSWORD_LENGTH', `密码要 ${PASSWORD_MIN}–${PASSWORD_MAX} 个字符`)
  }
}

/** 游客昵称：游客 + 4 位数字。撞了就重试，最多 8 次 */
export async function generateGuestNickname(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const n = 1000 + Math.floor(Math.random() * 9000)
    const nick = `游客${n}`
    const exists = await prisma.user.findFirst({
      where: { nickname: nick },
      select: { uid: true },
    })
    if (!exists) return nick
  }
  // 极端情况：用时间戳兜底，保证一定能建出来
  return `游客${Date.now() % 100000}`
}

export interface PublicUser {
  uid: string
  nickname: string
  isGuest: boolean
  email: string | null
  rating: number
  ratingDev: number
  wins: number
  losses: number
  avatarHue: number
  bannedUntil: string | null
  createdAt: string
}

type UserRow = {
  uid: bigint
  nickname: string
  isGuest: boolean
  email: string | null
  rating: number
  ratingDev: number
  wins: number
  losses: number
  avatarHue: number
  bannedUntil: Date | null
  createdAt: Date
}

/** 统一出口：BigInt 不能 JSON.stringify，必须转字符串 */
export function toPublicUser(u: UserRow): PublicUser {
  return {
    uid: u.uid.toString(),
    nickname: u.nickname,
    isGuest: u.isGuest,
    email: u.email,
    rating: u.rating,
    ratingDev: u.ratingDev,
    wins: u.wins,
    losses: u.losses,
    avatarHue: u.avatarHue,
    bannedUntil: u.bannedUntil ? u.bannedUntil.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }
}

const publicSelect = {
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
} as const

export async function createGuest(meta: {
  userAgent?: string | undefined
  ip?: string | undefined
}): Promise<{ user: PublicUser; uid: bigint }> {
  const nickname = await generateGuestNickname()
  const row = await prisma.user.create({
    data: {
      nickname,
      isGuest: true,
      lastLoginAt: new Date(),
    },
    select: publicSelect,
  })
  void meta
  return { user: toPublicUser(row), uid: row.uid }
}

export async function createRegistered(input: {
  email: string
  nickname: string
  password: string
}): Promise<{ user: PublicUser; uid: bigint }> {
  const email = assertEmail(input.email)
  assertNickname(input.nickname)
  assertPassword(input.password)

  const dupEmail = await prisma.user.findUnique({ where: { email }, select: { uid: true } })
  if (dupEmail) throw err.conflict('EMAIL_TAKEN', '这个邮箱已经注册过了')

  // 昵称大小写敏感（utf8mb4_0900_as_cs），所以 findFirst 而不是 findUnique
  const dupNick = await prisma.user.findFirst({
    where: { nickname: input.nickname },
    select: { uid: true },
  })
  if (dupNick) throw err.conflict('NICKNAME_TAKEN', '这个昵称已经被占了')

  const passwordHash = await hashPassword(input.password)
  const row = await prisma.user.create({
    data: {
      email,
      nickname: input.nickname,
      passwordHash,
      isGuest: false,
      lastLoginAt: new Date(),
    },
    select: publicSelect,
  })
  return { user: toPublicUser(row), uid: row.uid }
}

/**
 * 邮箱密码登录。
 *
 * 失败信息统一成一句「账号或密码错误」：分开提示等于送攻击者一个
 * 「这个邮箱是否注册过」的查询接口。
 */
export async function loginWithPassword(input: {
  email: string
  password: string
}): Promise<{ user: PublicUser; uid: bigint }> {
  const email = normalizeEmail(input.email)
  const row = await prisma.user.findUnique({
    where: { email },
    select: { ...publicSelect, passwordHash: true },
  })

  const generic = err.unauthorized('BAD_CREDENTIALS', '账号或密码错误')

  if (!row || !row.passwordHash) {
    // 走一次假校验，抹平"存在/不存在"的响应时间差
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
      input.password,
    )
    throw generic
  }

  const ok = await verifyPassword(row.passwordHash, input.password)
  if (!ok) throw generic

  if (row.bannedUntil && row.bannedUntil.getTime() > Date.now()) {
    throw err.forbidden('BANNED', '账号被封禁')
  }

  await prisma.user.update({
    where: { uid: row.uid },
    data: { lastLoginAt: new Date() },
  })

  const { passwordHash: _ph, ...pub } = row
  return { user: toPublicUser(pub), uid: row.uid }
}

export async function fetchUser(uid: bigint): Promise<PublicUser | null> {
  const row = await prisma.user.findUnique({ where: { uid }, select: publicSelect })
  return row ? toPublicUser(row) : null
}
