/**
 * refresh token：32 字节随机串，base64url 编码后给客户端，
 * 库里只存 sha256 十六进制。
 *
 * 为什么不是 JWT：refresh 必须能吊销。可吊销的东西就一定要落库，
 * 既然落库了就没必要再背一个签名。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '../config.ts'

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** 定长十六进制比较，避免按字符提前 return 泄露长度信息 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export function refreshExpiryDate(now = new Date()): Date {
  return new Date(now.getTime() + config.REFRESH_TOKEN_TTL_SEC * 1000)
}

/** refresh cookie 的 Path —— 只发给 /api/auth，别的接口收不到 */
export const REFRESH_COOKIE_PATH = '/api/auth'
export const REFRESH_COOKIE_NAME = 'rt'
