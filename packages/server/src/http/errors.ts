/**
 * 统一错误形状。前端只按 code 分支，不解析 message
 * （见 docs/06-account.md 1.10）。
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail?: unknown

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export const err = {
  badRequest: (code: string, message: string, detail?: unknown) =>
    new ApiError(400, code, message, detail),
  unauthorized: (code = 'UNAUTHENTICATED', message = '请先登录') =>
    new ApiError(401, code, message),
  forbidden: (code = 'FORBIDDEN', message = '没有权限') => new ApiError(403, code, message),
  notFound: (code = 'NOT_FOUND', message = '不存在') => new ApiError(404, code, message),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  tooMany: (code = 'RATE_LIMITED', message = '太频繁了，歇一会儿') =>
    new ApiError(429, code, message),
  internal: (code = 'INTERNAL', message = '服务器出错了') => new ApiError(500, code, message),
}
