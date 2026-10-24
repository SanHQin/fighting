/**
 * 内容加载与校验
 *
 * 内核不知道数据从哪来（现在来自 `mock/data.ts`，将来来自 `char.json` / `stage.json`）。
 * 这一层负责三件事：
 *   1. **校验**：把数据错误在启动时暴露，而不是在某一帧算出一个 NaN；
 *   2. **索引**：id → 定义，避免每帧 `find()`；
 *   3. **规则哈希**：联机握手时比对，不一致就拒绝开局。
 *
 * 规则哈希只覆盖**会改变模拟结果**的字段。改美术、改音效、改选人页文案
 * 都不该让两个人无法对战 —— 这是"能不能连上"和"是不是同一版本"的分界线。
 */
import type { AttackDir, CharDef, StageDef } from './types.ts'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function hashStr(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ (s.charCodeAt(i) & 0xff), FNV_PRIME) >>> 0
  return h
}

function hashNum(h: number, v: number | undefined): number {
  return hashStr(h, v === undefined ? '-' : String(Math.round(v * 1000)))
}

export class ContentError extends Error {
  readonly where: string
  constructor(where: string, message: string) {
    super(`${where}: ${message}`)
    this.name = 'ContentError'
    this.where = where
  }
}

const ALL_DIRS: AttackDir[] = [
  'neutral', 'forward', 'back', 'up', 'upForward', 'upBack', 'down', 'downForward', 'downBack',
]

function assertFinite(where: string, key: string, v: unknown): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ContentError(where, `${key} 必须是有限数字，实际是 ${String(v)}`)
  }
}

/** 逐字段校验一个角色。故意写得笨而全：这是启动期一次性的成本。 */
export function validateChar(c: CharDef): void {
  const w = `char[${c.id}]`
  if (!c.id) throw new ContentError('char', 'id 不能为空')
  if (!Number.isInteger(c.numId) || c.numId <= 0) throw new ContentError(w, 'numId 必须是正整数')
  if (!['light', 'middle', 'heavy'].includes(c.weightClass)) {
    throw new ContentError(w, `weightClass 非法：${String(c.weightClass)}`)
  }
  assertFinite(w, 'knockdownGate', c.knockdownGate)
  assertFinite(w, 'knockdownFrames', c.knockdownFrames)
  assertFinite(w, 'getupInvincible', c.getupInvincible)
  if (c.knockdownGate < 0) throw new ContentError(w, 'knockdownGate 不能为负')

  for (const ov of Object.entries(c.moveOverrides ?? {})) {
    const [dir, patch] = ov
    if (!ALL_DIRS.includes(dir as AttackDir)) throw new ContentError(w, `moveOverrides 的方向非法：${dir}`)
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (k === 'boxBack') {
        if (typeof v !== 'boolean') throw new ContentError(w, `moveOverrides.${dir}.boxBack 必须是布尔`)
        continue
      }
      assertFinite(w, `moveOverrides.${dir}.${k}`, v)
    }
  }
  for (const [dir, patch] of Object.entries(c.moves ?? {})) {
    if (!ALL_DIRS.includes(dir as AttackDir)) throw new ContentError(w, `moves 的方向非法：${dir}`)
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (k === 'name') {
        if (typeof v !== 'string' || !v.trim()) throw new ContentError(w, `moves.${dir}.name 必须是非空文本`)
        continue
      }
      if (k === 'boxBack') {
        if (typeof v !== 'boolean') throw new ContentError(w, 'moves.boxBack must be boolean')
        continue
      }
      assertFinite(w, 'moves patch ' + k, v)
    }
  }

  const seen = new Set<string>()
  for (const sp of c.specials) {
    const k = `${sp.slot ?? 0}:${sp.dir ?? 'any'}`
    // 同一槽 + 同一方向只能有一条，否则 pickSpecial 的优先级就变成"数组顺序"这种不成文约定
    if (seen.has(k)) throw new ContentError(w, `必杀槽 ${k} 重复定义`)
    seen.add(k)
    assertFinite(w, `${sp.name}.cooldown`, sp.cooldown)
    assertFinite(w, `${sp.name}.damage`, sp.damage)
    assertFinite(w, `${sp.name}.life`, sp.life)
    if (sp.slot !== undefined && sp.slot !== 0 && sp.slot !== 1) {
      throw new ContentError(w, `${sp.name}.slot 只能是 0 或 1`)
    }
  }
}

export function validateStage(s: StageDef): void {
  const w = `stage[${s.id}]`
  if (!s.platforms.length) throw new ContentError(w, '至少要有一个平台')
  const ids = new Set<number>()
  for (const p of s.platforms) {
    if (ids.has(p.id)) throw new ContentError(w, `平台 id 重复：${p.id}`)
    ids.add(p.id)
    if (!['solid', 'passthrough', 'ceiling'].includes(p.type)) {
      throw new ContentError(w, `平台 ${p.id} 的 type 非法：${String(p.type)}`)
    }
    if (p.w <= 0 || p.h <= 0) throw new ContentError(w, `平台 ${p.id} 的尺寸必须为正`)
    assertFinite(w, `平台 ${p.id} 的 x`, p.x)
    if ((p.moveAmp ?? 0) > 0 && (p.movePeriod ?? 0) <= 0) {
      throw new ContentError(w, `平台 ${p.id} 有 moveAmp 但 movePeriod <= 0`)
    }
  }
  if (s.spawnPoints.length < 2) throw new ContentError(w, '至少要有两个出生点')
  const bz = s.blastZone
  assertFinite(w, 'blastZone.w', bz.w)
  if (bz.w <= 0 || bz.h <= 0) throw new ContentError(w, 'blastZone 尺寸必须为正')
  for (const h of s.hazards) {
    if (h.period <= 0) throw new ContentError(w, `hazard ${h.label} 的 period 必须为正`)
    if (h.phase < 0 || h.phase >= h.period) {
      throw new ContentError(w, `hazard ${h.label} 的 phase 必须落在 [0, period)`)
    }
  }
}

export interface Content {
  chars: Record<string, CharDef>
  stages: Record<string, StageDef>
  charList: CharDef[]
  stageList: StageDef[]
  /** 全部角色 + 场地的规则哈希（8 位十六进制） */
  rulesetHash: string
}

/**
 * 建立内容索引并算出规则哈希。
 *
 * **`rulesetHash` 覆盖范围**：角色的体重/击倒参数/招式覆盖/必杀定义/冲刺参数，
 * 场地的平台几何/出界区/事件定义。
 * **不覆盖**：显示名、颜色、立绘、音效、一句话介绍 —— 改这些不该让两个人连不上。
 */
export function loadContent(chars: CharDef[], stages: StageDef[]): Content {
  const byId: Record<string, CharDef> = {}
  for (const c of chars) {
    validateChar(c)
    if (byId[c.id]) throw new ContentError(`char[${c.id}]`, 'id 重复')
    byId[c.id] = c
  }
  const numIds = new Set<number>()
  for (const c of chars) {
    if (numIds.has(c.numId)) throw new ContentError('char', `numId 重复：${c.numId}（必须全局唯一且永不复用）`)
    numIds.add(c.numId)
  }
  const stById: Record<string, StageDef> = {}
  for (const s of stages) {
    validateStage(s)
    if (stById[s.id]) throw new ContentError(`stage[${s.id}]`, 'id 重复')
    stById[s.id] = s
  }

  let h = FNV_OFFSET
  for (const c of [...chars].sort((a, b) => a.numId - b.numId)) {
    h = hashStr(h, `C${c.id}|${c.weightClass}|${c.knockdownGate}|${c.knockdownFrames}|${c.getupInvincible}`)
    h = hashNum(h, c.dashSpeedMul)
    h = hashNum(h, c.dashFramesMul)
    h = hashNum(h, c.airDashes)
    h = hashNum(h, c.dashCooldown)
    h = hashNum(h, c.dashAttackMul)
    for (const [dir, patch] of Object.entries(c.moveOverrides ?? {})) {
      h = hashStr(h, `M${dir}`)
      for (const v of Object.values(patch ?? {})) {
        h = typeof v === 'boolean' ? hashStr(h, v ? '1' : '0') : hashNum(h, v)
      }
    }
    for (const [dir, patch] of Object.entries(c.moves ?? {})) {
      h = hashStr(h, `X${dir}`)
      for (const [key, v] of Object.entries(patch ?? {})) {
        h = hashStr(h, key)
        h = typeof v === 'boolean' ? hashStr(h, v ? '1' : '0') : typeof v === 'string' ? hashStr(h, v) : hashNum(h, v)
      }
    }
    for (const sp of c.specials) {
      h = hashStr(h, `S${sp.kind}|${sp.slot ?? 0}|${sp.dir ?? 'any'}`)
      h = hashNum(h, sp.cooldown)
      h = hashNum(h, sp.damage)
      h = hashNum(h, sp.angle)
      h = hashNum(h, sp.kbGrowth)
      h = hashNum(h, sp.baseKB)
      h = hashNum(h, sp.speedX)
      h = hashNum(h, sp.speedY)
      h = hashNum(h, sp.life)
      h = hashStr(h, sp.gravity ? '1' : '0')
    }
  }
  for (const s of [...stages].sort((a, b) => a.id.localeCompare(b.id))) {
    h = hashStr(h, `T${s.id}|${s.blastZone.x},${s.blastZone.y},${s.blastZone.w},${s.blastZone.h}`)
    for (const p of [...s.platforms].sort((a, b) => a.id - b.id)) {
      h = hashStr(h, `P${p.id},${p.type},${p.x},${p.y},${p.w},${p.h},${p.grabbable ? 1 : 0}`)
      h = hashNum(h, p.hp)
      h = hashNum(h, p.respawn)
      h = hashNum(h, p.moveAmp)
      h = hashNum(h, p.movePeriod)
      h = hashNum(h, p.movePhase)
    }
    for (const z of s.hazards) {
      h = hashStr(h, `Z${z.kind}|${z.period}|${z.phase}|${z.duration}|${z.damage}|${z.angle}|${z.baseKB}`)
      h = hashStr(h, `${z.x},${z.y},${z.w},${z.h}`)
    }
  }

  return {
    chars: byId,
    stages: stById,
    charList: [...chars].sort((a, b) => a.selectOrder - b.selectOrder),
    stageList: stages,
    rulesetHash: (h >>> 0).toString(16).padStart(8, '0'),
  }
}

/** 从内容里取角色 / 场地，取不到就抛（比返回 undefined 之后某帧算出 NaN 好定位） */
export function requireChar(content: Content, id: string): CharDef {
  const c = content.chars[id]
  if (!c) throw new ContentError(`char[${id}]`, '不存在')
  return c
}

export function requireStage(content: Content, id: string): StageDef {
  const s = content.stages[id]
  if (!s) throw new ContentError(`stage[${id}]`, '不存在')
  return s
}

/** 联机握手用：两边哈希不一致就拒绝开局，并给出人话提示 */
export function assertSameRuleset(mine: string, theirs: string): void {
  if (mine !== theirs) {
    throw new ContentError(
      'ruleset',
      `双方规则版本不一致（本地 ${mine} / 对方 ${theirs}）—— 检查是否有一方改了招式帧数据或场地定义`,
    )
  }
}
