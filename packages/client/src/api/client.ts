/**
 * 后端 API 客户端（玩家端）
 *
 * 三条硬规矩，和后台 `packages/admin/src/api.ts` 一致：
 *
 * 1. **accessToken 只放内存**（模块级变量，不进 localStorage / Pinia / devtools）。
 *    refreshToken 在 httpOnly Cookie 里，JS 读不到 —— 这才是"刷新令牌不进 JS"的意义。
 * 2. **并发 401 只刷新一次**：共享同一个 Promise，否则十个请求各自刷新、
 *    后刷的会把先刷的顶掉（服务端的会话轮换会认定"旧令牌被重放"→ 整个账号下线）。
 * 3. **刷新接口自己返回 401 时不能再走拦截器**，否则死循环。
 */
import type { CharDef } from '@fighting/battle-core'

export interface ApiUser {
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

export const contentApi = {
  async characters(signal?: AbortSignal): Promise<CharDef[]> {
    const data = await request<{ characters: CharDef[] }>('/characters', { signal })
    return data.characters
  },
}

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string; detail?: unknown }
}

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiFailure'
  }
}

/** 走 vite 代理到 3001：同源，cookie 才会带上 */
const BASE = '/api'

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

let refreshing: Promise<boolean> | null = null

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  /** 内部用：已经重试过一次就不再重试 */
  retry?: boolean
  signal?: AbortSignal
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (accessToken) headers['authorization'] = `Bearer ${accessToken}`

  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'include',
    signal: opts.signal,
  })

  // 401 且不是刷新接口本身：刷一次再重放
  if (res.status === 401 && !opts.retry && path !== '/auth/refresh') {
    const ok = await refreshOnce()
    if (ok) return request<T>(path, { ...opts, retry: true })
  }

  let payload: Envelope<T> | null = null
  try {
    payload = (await res.json()) as Envelope<T>
  } catch {
    payload = null
  }

  if (!res.ok || !payload || payload.ok === false) {
    const err = payload?.error
    throw new ApiFailure(
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `请求失败（HTTP ${res.status}）`,
      res.status,
      err?.detail,
    )
  }
  return payload.data as T
}

/** 拿 refresh cookie 换一张新的 access；并发时共享同一个 Promise */
export function refreshOnce(): Promise<boolean> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const data = await request<{ user: ApiUser; accessToken: string; expiresIn: number }>(
        '/auth/refresh',
        { method: 'POST', retry: true },
      )
      accessToken = data.accessToken
      return true
    } catch {
      accessToken = null
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export interface AuthResult {
  user: ApiUser
  accessToken: string
  expiresIn: number
}

function acceptAuth(r: AuthResult): AuthResult {
  accessToken = r.accessToken
  return r
}

export const authApi = {
  guest: () => request<AuthResult>('/auth/guest', { method: 'POST' }).then(acceptAuth),

  login: (email: string, password: string) =>
    request<AuthResult>('/auth/login', { body: { email, password } }).then(acceptAuth),

  register: (email: string, nickname: string, password: string) =>
    request<AuthResult>('/auth/register', { body: { email, nickname, password } }).then(acceptAuth),

  upgrade: (email: string, nickname: string, password: string) =>
    request<AuthResult>('/auth/upgrade', { body: { email, nickname, password } }).then(acceptAuth),

  /** 启动时用 refresh cookie 恢复登录；没有 cookie 就返回 null（不报错） */
  async restore(): Promise<ApiUser | null> {
    if (!(await refreshOnce())) return null
    try {
      const data = await request<{ user: ApiUser; expiresIn: number }>('/auth/me', { retry: true })
      return data.user
    } catch {
      return null
    }
  },

  async logout(): Promise<void> {
    try {
      await request<{ revoked: boolean }>('/auth/logout', { method: 'POST' })
    } finally {
      accessToken = null
    }
  },

  async me(): Promise<ApiUser> {
    const data = await request<{ user: ApiUser; expiresIn: number }>('/auth/me')
    return data.user
  },
}
