/**
 * 后台的接口层。
 *
 * 两条约束：
 *   1. accessToken **只放内存**，不放 localStorage —— 后台是共用电脑的高危场景，
 *      浏览器一关就该什么都留不下。页面刷新掉登录是可接受的代价。
 *   2. 并发 401 只刷一次：用共享 Promise，否则三个请求同时 401 会
 *      各自刷新、前两次的 token 立刻作废，用户被踢出去。
 */

let accessToken = ''
let refreshing: Promise<boolean> | null = null

export interface ApiErrorShape {
  code: string
  message: string
  detail?: unknown
}

export class ApiError extends Error {
  code: string
  status: number
  detail?: unknown
  constructor(status: number, e: ApiErrorShape) {
    super(e.message)
    this.status = status
    this.code = e.code
    this.detail = e.detail
  }
}

export function setToken(t: string): void {
  accessToken = t
}

export function getToken(): string {
  return accessToken
}

export function clearToken(): void {
  accessToken = ''
}

interface ReqOptions {
  method?: string
  body?: unknown
  /** 内部用：401 后重试时不再递归刷新 */
  retry?: boolean
}

async function raw(path: string, opts: ReqOptions): Promise<Response> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (accessToken) headers.authorization = `Bearer ${accessToken}`
  return fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    // 必须带上 cookie，refresh 全靠它
    credentials: 'same-origin',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

/** 用 refresh cookie 换一张新的 access。返回是否成功 */
export async function refreshAccess(): Promise<boolean> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) return false
      const json = (await res.json()) as { data?: { accessToken?: string } }
      if (!json.data?.accessToken) return false
      accessToken = json.data.accessToken
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function api<T>(path: string, opts: ReqOptions = {}): Promise<T> {
  let res = await raw(path, opts)

  if (res.status === 401 && !opts.retry) {
    const okRefresh = await refreshAccess()
    if (okRefresh) res = await raw(path, { ...opts, retry: true })
  }

  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!res.ok) {
    const shape = (json as { error?: ApiErrorShape } | null)?.error
    throw new ApiError(
      res.status,
      shape ?? { code: 'NETWORK', message: `请求失败（HTTP ${res.status}）` },
    )
  }

  return (json as { data: T }).data
}

// ---------------------------------------------------------------- 形状
export interface AdminMe {
  uid: string
  nickname: string
  role: number
  roleLabel: string
}

export interface AdminStats {
  users: { total: number; guests: number; registered: number; new24h: number; active7d: number }
  matches: { total: number; last24h: number }
  moderation: { banned: number }
  online: number
  serverTime: string
}

export interface AdminUser {
  uid: string
  nickname: string
  email: string | null
  isGuest: boolean
  role: number
  roleLabel: string
  rating: number
  wins: number
  losses: number
  bannedUntil: string | null
  banReason: string | null
  lastLoginAt: string | null
  createdAt: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface UserSessionRow {
  id: string
  userAgent: string | null
  ip: string | null
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

export interface UserMatchRow {
  matchId: string
  slot: number
  charId: number
  stocksLeft: number
  damageDealt: number
  maxCombo: number
}

export interface AdminUserDetail {
  user: AdminUser
  sessions: UserSessionRow[]
  recentMatches: UserMatchRow[]
}

export interface AdminMatch {
  matchId: string
  publicId: string
  stageId: string
  mode: number
  winnerSlot: number | null
  durationMs: number
  createdAt: string
  players: { uid: string; slot: number; charId: number; stocksLeft: number; damageDealt: number }[]
}

export interface AuditRow {
  id: string
  actorUid: string
  actorNickname: string
  action: string
  targetType: string
  targetId: string
  detail: string | null
  ip: string | null
  createdAt: string
}

// ------------------------------------------------------------ 便捷方法
export const adminApi = {
  login: (email: string, password: string) =>
    api<{ accessToken: string; user: { uid: string; nickname: string } }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),
  me: () => api<AdminMe>('/admin/me'),
  stats: () => api<AdminStats>('/admin/stats'),
  users: (q: { cursor?: string; take?: number; keyword?: string; filter?: string }) => {
    const p = new URLSearchParams()
    if (q.cursor) p.set('cursor', q.cursor)
    if (q.take) p.set('take', String(q.take))
    if (q.keyword) p.set('keyword', q.keyword)
    if (q.filter) p.set('filter', q.filter)
    return api<Page<AdminUser>>(`/admin/users?${p.toString()}`)
  },
  user: (uid: string) => api<AdminUserDetail>(`/admin/users/${uid}`),
  ban: (uid: string, hours: number, reason: string) =>
    api<{ bannedUntil: string; revokedSessions: number }>(`/admin/users/${uid}/ban`, {
      method: 'POST',
      body: { hours, reason, kick: true },
    }),
  unban: (uid: string) => api<{ unbanned: boolean }>(`/admin/users/${uid}/unban`, { method: 'POST' }),
  setRole: (uid: string, role: number) =>
    api<{ role: number }>(`/admin/users/${uid}/role`, { method: 'POST', body: { role } }),
  revokeSessions: (uid: string) =>
    api<{ revoked: number }>(`/admin/users/${uid}/revoke-sessions`, { method: 'POST' }),
  setNickname: (uid: string, nickname: string) =>
    api<{ nickname: string }>(`/admin/users/${uid}/nickname`, { method: 'POST', body: { nickname } }),
  matches: (cursor?: string) =>
    api<Page<AdminMatch>>(`/admin/matches?take=20${cursor ? `&cursor=${cursor}` : ''}`),
  audit: (cursor?: string) =>
    api<Page<AuditRow>>(`/admin/audit?take=30${cursor ? `&cursor=${cursor}` : ''}`),
}
