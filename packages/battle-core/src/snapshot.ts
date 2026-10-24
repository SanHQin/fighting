/**
 * 快照与回填（rollback 的地基）
 *
 * 铁律 L4/L5 的推论：**只要 `World` 里所有会影响下一帧的字段都能被完整复制**，
 * 回滚就是"存快照 → 喂旧输入重跑 → 再对一次校验和"。
 *
 * 三条刻意设计：
 *  1. 快照**不复制** `stage` / `char`（内容是不可变的常量表，按引用共享即可）；
 *  2. 快照**不复制** `events`（每个 step 开头就清空，是渲染层的消费队列，不是模拟状态）；
 *  3. `specialDef` 存**索引**而不是对象——它是 `char.specials` 里的元素，
 *     深拷贝会切断引用，导致回滚后"同一招"变成另一个对象实例。
 *
 * `restoreWorld` 是**原地回填**（in place），不新建 World：
 * 回滚每帧都要回填，新建对象会让渲染层持有的引用全部失效。
 */
import type { Fighter, PlatState, Projectile, World } from './sim.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 数字字段的扁平快照：键顺序固定，故可当校验和的输入 */
export type NumTuple = number[]

export interface FighterSnap {
  /** 除 char / specialDef 以外的全部标量字段，按 FIGHTER_KEYS 顺序 */
  n: NumTuple
  /** attackDir */
  dir: string
  /** state */
  st: string
  kind: 'normal' | 'special'
  /** char.specials 的下标，-1 = 无 */
  sp: number
  /** ledge: [platId, x, y, side] 或 null */
  ledge: [number, number, number, number] | null
}

/**
 * 顺序即序列化顺序 —— 加字段时**必须同时改这里和 `writeFighter`**，
 * 顺序变了校验和就变了（这是有意的：改协议就该换 `rulesetHash`）。
 */
export const FIGHTER_KEYS = [
  'x', 'y', 'vx', 'vy', 'onGround', 'jumpsLeft', 'jumpSquat', 'fastFalling',
  'damage', 'stocks', 'invincible', 'respawnTimer', 'hitstun', 'hitlag',
  'attackFrame', 'attackHit', 'attackFacing', 'specialSlot',
  'crouching', 'shield', 'shieldRegenDelay', 'shieldBreakStun', 'dropThroughTimer',
  'combo', 'comboExpire', 'maxComboTaken',
  'knockedDown', 'knockdownTimer', 'knockdowns',
  'dashTimer', 'dashCd', 'dashVecX', 'dashVecY', 'dashFramesTotal', 'dashSpeedTotal',
  'airDashes', 'recoveryDashes', 'dashAttack',
  'ledgeCd', 'climbTimer', 'ledgeLock',
  'hazardCd', 'cd0', 'cd1',
  'stateFramePhase', 'landLag', 'jumpBuffer', 'coyote', 'atkBuffer',
  'px', 'py', 'dealt', 'facing',
] as const

/**
 * 快照里有、但**不进校验和**的字段。
 *
 * `px` / `py` 是"上一帧位置"，唯一的消费者是渲染层的插值。
 * 把它算进校验和会让「同一局、同一逻辑、只是渲染插值差一点」变成误报 desync ——
 * 一个字段要不要进校验和，判据是「它是否影响下一帧的模拟结果」。
 */
export const FIGHTER_KEYS_NOT_IN_CHECKSUM: readonly string[] = ['px', 'py']

export interface WorldSnap {
  frame: number
  round: number
  timeLeft: number
  over: boolean
  endFrame: number
  winner: 0 | 1 | null
  nextProjId: number
  fighters: [FighterSnap, FighterSnap]
  plats: PlatState[]
  projectiles: Projectile[]
  hazards: { i: number; active: boolean; x: number; y: number; w: number; h: number }[]
}

/** 这些字段是布尔，但快照里统一存 0/1 —— 一个纯数字元组才好比较和求校验和 */
const BOOL_KEYS = new Set([
  'onGround', 'fastFalling', 'attackHit', 'crouching', 'knockedDown', 'dashAttack',
])

function readFighter(f: Fighter): FighterSnap {
  const n: number[] = []
  for (const k of FIGHTER_KEYS) {
    if (k === 'cd0') n.push(f.cooldown[0])
    else if (k === 'cd1') n.push(f.cooldown[1])
    else {
      const v = (f as unknown as Record<string, number | boolean>)[k]
      n.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v as number))
    }
  }
  return {
    n,
    dir: f.attackDir,
    st: f.state,
    kind: f.attackKind,
    sp: f.specialDef ? f.char.specials.indexOf(f.specialDef) : -1,
    ledge: f.ledge ? [f.ledge.platId, f.ledge.x, f.ledge.y, f.ledge.side] : null,
  }
}

function writeFighter(f: Fighter, s: FighterSnap): void {
  const rec = f as unknown as Record<string, number | boolean>
  for (let i = 0; i < FIGHTER_KEYS.length; i++) {
    const k = FIGHTER_KEYS[i]!
    const v = s.n[i]!
    if (k === 'cd0') f.cooldown[0] = v
    else if (k === 'cd1') f.cooldown[1] = v
    else rec[k] = BOOL_KEYS.has(k) ? v !== 0 : v
  }
  f.attackDir = s.dir as Fighter['attackDir']
  f.state = s.st as Fighter['state']
  f.attackKind = s.kind
  f.specialDef = s.sp >= 0 ? (f.char.specials[s.sp] ?? null) : null
  f.ledge = s.ledge
    ? { platId: s.ledge[0], x: s.ledge[1], y: s.ledge[2], side: s.ledge[3] as 1 | -1 }
    : null
}

function copyProj(p: Projectile): Projectile {
  return {
    id: p.id, kind: p.kind, owner: p.owner,
    x: p.x, y: p.y, vx: p.vx, vy: p.vy, w: p.w, h: p.h,
    damage: p.damage, angle: p.angle, kbGrowth: p.kbGrowth, baseKB: p.baseKB,
    life: p.life, gravity: p.gravity, grounded: p.grounded, fuse: p.fuse,
    spent: p.spent, arm: p.arm, facing: p.facing,
  }
}

function copyPlat(p: PlatState): PlatState {
  return {
    id: p.id, type: p.type, x: p.x, y: p.y, w: p.w, h: p.h,
    grabbable: p.grabbable, hp: p.hp, maxHp: p.maxHp, broken: p.broken,
    respawnTimer: p.respawnTimer, baseX: p.baseX, baseY: p.baseY,
    moveAmp: p.moveAmp, movePeriod: p.movePeriod, movePhase: p.movePhase,
    flash: p.flash,
  }
}

export function snapshotWorld(w: World): WorldSnap {
  return {
    frame: w.frame,
    round: w.round,
    timeLeft: w.timeLeft,
    over: w.over,
    endFrame: w.endFrame,
    winner: w.winner,
    nextProjId: w.nextProjId,
    fighters: [readFighter(w.fighters[0]), readFighter(w.fighters[1])],
    plats: w.plats.map(copyPlat),
    projectiles: w.projectiles.map(copyProj),
    hazards: w.hazards.map((h, i) => ({
      i, active: h.active, x: h.x, y: h.y, w: h.w, h: h.h,
    })),
  }
}

export function restoreWorld(w: World, s: WorldSnap): void {
  w.frame = s.frame
  w.round = s.round
  w.timeLeft = s.timeLeft
  w.over = s.over
  w.endFrame = s.endFrame
  w.winner = s.winner
  w.nextProjId = s.nextProjId
  writeFighter(w.fighters[0], s.fighters[0])
  writeFighter(w.fighters[1], s.fighters[1])
  // 平台与投射物：长度不同就重建数组（破坏/重生会改数量，但通常一样长）
  for (let i = 0; i < s.plats.length; i++) {
    const src = s.plats[i]!
    if (w.plats[i]) w.plats[i] = copyPlat(src)
    else w.plats.push(copyPlat(src))
  }
  w.plats.length = s.plats.length
  w.projectiles = s.projectiles.map(copyProj)
  for (let i = 0; i < s.hazards.length; i++) {
    const src = s.hazards[i]!
    const dst = w.hazards[src.i]
    if (!dst) continue
    dst.active = src.active
    dst.x = src.x
    dst.y = src.y
    dst.w = src.w
    dst.h = src.h
  }
  w.events.length = 0
}

/** 把快照变回独立的一局（测试用；联机时用 restoreWorld 原地回填） */
export function worldFromSnapshot(base: World, s: WorldSnap): World {
  const copy: World = {
    ...base,
    fighters: [base.fighters[0], base.fighters[1]],
    plats: base.plats.map(copyPlat),
    projectiles: [],
    hazards: base.hazards.map((h) => ({ ...h })),
    events: [],
  }
  restoreWorld(copy, s)
  return copy
}
