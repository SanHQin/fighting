/**
 * 种子化伪随机数发生器（PRNG）
 *
 * 铁律 L2 禁的是 `Math.random()` / `Math.sin` 等不可复现的源。
 * 模拟里需要"随机"的地方（AI 决策、场地事件的相位抖动）一律走这里，
 * 并把状态（`state`）放进 `World`，这样回滚重演能得到同一串数。
 *
 * 算法是 xorshift32：三个移位 + 三次异或，全是整数运算，
 * 跨引擎必然一致（JS 的 `>>> 0` 是规范定义的）。
 */

export interface Rng {
  /** 当前状态。**必须进快照**，否则重演会漂 */
  state: number
  next(): number
}

/** 把任意数字洗成一个非零种子（0 是 xorshift 的不动点） */
export function seedOf(n: number): number {
  let s = (Math.floor(n) ^ 0x9e3779b9) >>> 0
  if (s === 0) s = 0x6d2b79f5
  return s
}

export function createRng(seed: number): Rng {
  const rng: Rng = {
    state: seedOf(seed),
    next(): number {
      let x = rng.state
      x ^= x << 13
      x >>>= 0
      x ^= x >>> 17
      x ^= x << 5
      x >>>= 0
      rng.state = x
      // [0, 1)
      return x / 4294967296
    },
  }
  return rng
}
