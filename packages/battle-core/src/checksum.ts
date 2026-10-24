/**
 * 校验和（desync 检测的唯一硬指标）
 *
 * 用 FNV-1a 32 位：纯整数运算、无查表、跨引擎必然一致。
 * 输入是**定长定点**的数字串（`toFixed(3)`），不直接喂 `toString()`：
 * 浮点 `toString()` 对不同值的舍入边界很敏感，1e-15 的差异会被放大成
 * "完全不同"的字符串，而 `toFixed(3)` 把噪声抹掉、只留玩家能感知到的差异。
 *
 * 3 位小数 = 千分之一像素。角色标准高 64px，没人能感知 0.001px，
 * 但一次真实的逻辑分叉（少算一帧重力）会立刻超过这个阈值。
 */
import type { World } from './sim.ts'
import { FIGHTER_KEYS, FIGHTER_KEYS_NOT_IN_CHECKSUM, snapshotWorld, type WorldSnap } from './snapshot.ts'

const PRECISION = 3
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const SKIP = new Set(FIGHTER_KEYS_NOT_IN_CHECKSUM)

function fnv1a(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0
}

function mixStr(hash: number, s: string): number {
  for (let i = 0; i < s.length; i++) hash = fnv1a(hash, s.charCodeAt(i) & 0xff)
  return hash
}

/** 定点数字 → 字符串。负零统一成 0，避免 `-0` 与 `0` 打出不同校验和 */
function num(v: number): string {
  const q = Number(v.toFixed(PRECISION))
  return (q === 0 ? 0 : q).toFixed(PRECISION)
}

function bool(v: boolean): string {
  return v ? '1' : '0'
}

/**
 * 对一个快照求校验和。
 *
 * **刻意不含的东西**：`events`（渲染队列）、`flash`（纯视觉）、`px/py`（上一帧位置，只给插值用）。
 * 一个字段要不要进校验和，判据是「它是否影响下一帧的模拟结果」，
 * 不是「它看起来像不像状态」。
 */
export function checksumSnapshot(s: WorldSnap): number {
  let h = FNV_OFFSET
  h = mixStr(h, `f${s.frame}|r${s.round}|t${num(s.timeLeft)}|o${bool(s.over)}|w${s.winner ?? -1}|n${s.nextProjId}`)

  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i]!
    h = mixStr(h, `|P${i}:`)
    for (let k = 0; k < f.n.length; k++) {
      // px / py 只给渲染插值用，不进校验和（见 snapshot.ts 的说明）
      if (SKIP.has(FIGHTER_KEYS[k]!)) continue
      h = mixStr(h, num(f.n[k]!))
    }
    h = mixStr(h, `|${f.dir}|${f.st}|${f.kind}|${f.sp}`)
    h = mixStr(
      h,
      f.ledge ? `|L${f.ledge[0]},${num(f.ledge[1])},${num(f.ledge[2])},${f.ledge[3]}` : '|L-',
    )
  }

  for (const p of s.plats) {
    h = mixStr(
      h,
      `|p${p.id},${num(p.x)},${num(p.y)},${num(p.w)},${bool(p.broken)},${p.hp},${p.respawnTimer}`,
    )
  }
  for (const q of s.projectiles) {
    h = mixStr(
      h,
      `|q${q.id},${q.kind},${q.owner},${num(q.x)},${num(q.y)},${num(q.vx)},${num(q.vy)},${q.life},${bool(q.spent)},${q.arm},${q.fuse}`,
    )
  }
  for (const z of s.hazards) {
    h = mixStr(h, `|z${z.i},${bool(z.active)},${num(z.x)},${num(z.y)}`)
  }
  return h >>> 0
}

/** 直接对一局求校验和（内部会先存快照，故有分配开销；联机每 30 帧一次够用） */
export function checksumWorld(w: World): number {
  return checksumSnapshot(snapshotWorld(w))
}

/** 8 字符十六进制，方便塞进日志与数据库 */
export function checksumHex(w: World): string {
  return checksumWorld(w).toString(16).padStart(8, '0')
}

/**
 * 快照往返自检：存 → 回填 → 再求校验和，必须完全一致。
 *
 * 这是**开发期断言**，不是运行时逻辑：它抓的是"快照漏了字段"这类
 * 只有在回滚真正发生时才会暴露的 bug。docs 里把它列为必过测试之一。
 */
export function assertSnapshotRoundTrip(w: World): void {
  const before = checksumWorld(w)
  const snap = snapshotWorld(w)
  const after = checksumSnapshot(snap)
  if (before !== after) {
    throw new Error(
      `snapshot roundtrip mismatch @ frame ${w.frame}: ${before.toString(16)} != ${after.toString(16)}`,
    )
  }
}
