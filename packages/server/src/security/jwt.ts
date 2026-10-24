/**
 * access token：HS256 JWT，15 分钟。
 *
 * 为什么 access 用 JWT 而 refresh 用不透明随机串：
 *   - access 每帧级的接口都要带，必须能无状态验签、不查库
 *   - refresh 只在刷新时用一次，必须能吊销 → 存库 + sha256
 * 见 docs/06-account.md 1.4。
 */
import { SignJWT, jwtVerify } from 'jose'
import { config } from '../config.ts'

const ISSUER = 'fighting'
const AUDIENCE = 'fighting-web'

const key = new TextEncoder().encode(config.JWT_SECRET)

export interface AccessClaims {
  /** 用户 uid 的十进制字符串。JWT 的 sub 必须是字符串 */
  sub: string
  /** 是否游客。游客不能排位 */
  guest: boolean
  /** 昵称，省一次查库去渲染顶栏 */
  nick: string
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ guest: claims.guest, nick: claims.nick })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + config.ACCESS_TOKEN_TTL_SEC)
    .sign(key)
}

/** 验签失败一律返回 null，调用方统一按 401 处理 */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    })
    const sub = payload.sub
    if (!sub) return null
    return {
      sub,
      guest: payload.guest === true,
      nick: typeof payload.nick === 'string' ? payload.nick : '',
    }
  } catch {
    return null
  }
}

/** access token 名义有效期（秒），前端据此提前一分钟刷新 */
export const accessTokenTtlSec = config.ACCESS_TOKEN_TTL_SEC
