/**
 * 密码哈希：argon2id，参数按 OWASP 2024 建议。
 *
 * 为什么不是 bcrypt：bcrypt 在 72 字节处静默截断，且内存成本不可调，
 * 面对 GPU/ASIC 的性价比远不如 argon2id。见 docs/06-account.md 1.3。
 *
 * 注意 `Algorithm` 是 const enum，只能用值导入 —— 这也正好避开
 * `verbatimModuleSyntax` 下"类型当值用"的坑。
 */
import { Algorithm, hash, verify } from '@node-rs/argon2'

const OPTIONS = {
  /** 19 MiB */
  memoryCost: 19456,
  /** 2 轮 */
  timeCost: 2,
  parallelism: 1,
  algorithm: Algorithm.Argon2id,
} as const

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS)
}

/**
 * 校验。任何异常都当作失败返回 —— 哈希串损坏不能变成 500，
 * 否则等于给攻击者一个"这个账号的哈希坏了"的探测通道。
 */
export async function verifyPassword(hashString: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashString, plain)
  } catch {
    return false
  }
}
