/**
 * 手感断言：这些是"玩家能感觉到、但看代码看不出来"的规则。
 *
 * 为什么单独一套：手感参数最容易在重构里被静默改坏 ——
 * 逻辑测试只验伤害与状态，验不了"落地前按跳有没有效"。
 */
import { loadSim } from './lib/simharness.mjs'

const { core, makeWorld } = await loadSim('feel')
const { step, emptyInput, C } = core

let pass = 0
let fail = 0
const ok = (cond, name, detail) => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`)
  }
}

const hold = (o = {}) => ({ ...emptyInput(), ...o })

/* ── 1. 跳跃缓冲：落地前按跳，落地当帧就起跳 ─────────────── */
{
  const w = makeWorld('li', 'aoi', 'dying_beacon')
  const a = w.fighters[0]
  a.invincible = 0
  a.x = 0
  a.y = -120
  a.vy = 0
  a.onGround = false

  // 悬在半空、离地还有几帧的地方按跳（必须确认此刻确实没站在地上，
  // 否则按下去就是即时起跳，测不到缓冲）
  a.y = -30
  a.vy = 3
  a.onGround = false
  // 空中跳跃次数用光：否则按跳会直接变成二段跳，测不到"落地缓冲"
  a.jumpsLeft = 0
  for (let i = 0; i < 40 && a.onGround; i++) step(w, [hold(), hold()])
  const yBefore = a.y
  step(w, [hold({ jumpPressed: true, jumpHeld: true }), hold()])
  const buffered = a.jumpBuffer
  let jumped = false
  // 需要给足帧数：落地 → 落地硬直 3 帧 → 起跳蹲 4 帧，才轮到 vy 变负
  for (let i = 0; i < 24; i++) {
    step(w, [hold(), hold()])
    if (a.vy < 0) {
      jumped = true
      break
    }
  }
  ok(buffered > 0, '跳跃被记入缓冲', `jumpBuffer=${buffered}`)
  ok(jumped, '落地前按跳能在落地后立刻起跳', `y ${yBefore.toFixed(1)} → ${a.y.toFixed(1)}`)
}

/* ── 2. 郊狼时间：走出边缘 3 帧内还能跳 ─────────────────── */
{
  const w = makeWorld('li', 'aoi', 'sky_bridge')
  const a = w.fighters[0]
  a.invincible = 0
  // 天穹回廊是两条窄桥，把它放在桥的右端外侧一点，先站住再走出去
  const bridge = w.plats.find((p) => p.type === 'solid' && p.w <= 400)
  a.x = bridge ? bridge.x + bridge.w - 4 : 0
  a.y = bridge ? bridge.y : 0
  a.vx = 0
  a.vy = 0
  a.onGround = true
  step(w, [hold({ right: true }), hold()])
  // 走出边缘（可能已经在边缘外了，多跑几帧直到 onGround 变 false）
  let leftGround = 0
  for (let i = 0; i < 30 && a.onGround; i++) {
    step(w, [hold({ right: true }), hold()])
    leftGround = i
  }
  const off = !a.onGround
  const coy = a.coyote
  step(w, [hold({ jumpPressed: true, jumpHeld: true }), hold()])
  step(w, [hold({ jumpHeld: true }), hold()])
  const wentUp = a.vy < 0 || a.jumpSquat > 0
  ok(off && coy > 0, '离开地面后仍有郊狼时间', `frames=${leftGround} coyote=${coy}`)
  ok(wentUp, '离地后仍能起跳', `vy=${a.vy.toFixed(2)} squat=${a.jumpSquat}`)
}

/* ── 3. 短跳 vs 全跳：高度必须明显不同 ──────────────────── */
{
  const apexOf = (holdJump) => {
    const w = makeWorld('li', 'aoi', 'dying_beacon')
    const a = w.fighters[0]
    a.invincible = 0
    a.x = 0
    a.y = 0
    a.vx = 0
    a.vy = 0
    a.onGround = true
    step(w, [hold({ jumpPressed: true, jumpHeld: true }), hold()])
    let apex = a.y
    for (let i = 0; i < 120; i++) {
      step(w, [hold({ jumpHeld: holdJump }), hold()])
      if (a.y < apex) apex = a.y
      if (a.onGround && i > 4) break
    }
    return -apex
  }
  const full = apexOf(true)
  const short = apexOf(false)
  ok(full > short * 1.25, '短跳明显比全跳矮', `全跳 ${full.toFixed(0)}px / 短跳 ${short.toFixed(0)}px`)
}

/* ── 4. 落地硬直随落地速度 ─────────────────────────────── */
{
  const lagOf = (startY) => {
    const w = makeWorld('li', 'aoi', 'dying_beacon')
    const a = w.fighters[0]
    a.invincible = 0
    a.x = 0
    a.y = startY
    a.vy = 0
    a.onGround = false
    let guard = 0
    while (!a.onGround && guard++ < 300) step(w, [hold(), hold()])
    return a.landLag
  }
  const low = lagOf(-40)
  const high = lagOf(-420)
  ok(high > low, '从更高处落地硬直更长', `低 ${low} 帧 / 高 ${high} 帧`)
  ok(low >= C.LAND_LAG_MIN && high <= C.LAND_LAG_MAX, '硬直落在 [2,6] 区间', `${low}..${high}`)
}

/* ── 5. 顿帧随伤害 ─────────────────────────────────────── */
{
  const lagAt = (damage, dir) => {
    const w = makeWorld('li', 'aoi', 'dying_beacon')
    const [a, b] = w.fighters
    a.invincible = 0
    b.invincible = 0
    a.x = 0
    a.y = 0
    b.x = 40
    b.y = 0
    b.damage = damage
    a.facing = 1
    step(w, [hold({ attack: true, ...(dir === 'forward' ? { right: true } : {}) }), hold()])
    for (let i = 0; i < 20; i++) {
      step(w, [hold({ ...(dir === 'forward' ? { right: true } : {}) }), hold()])
      if (b.hitlag > 0) return b.hitlag
    }
    return 0
  }
  const light = lagAt(0, 'neutral')
  const heavy = lagAt(180, 'forward')
  ok(light > 0 && heavy > light, '重击的顿帧比轻击长', `轻 ${light} 帧 / 重 ${heavy} 帧`)
  ok(heavy <= C.HITLAG_MAX, '顿帧不超过上限', `${heavy} <= ${C.HITLAG_MAX}`)
}

/* ── 6. 主动下穿不能被郊狼时间/跳跃缓冲"托回去" ──────────── */
{
  const w = makeWorld('li', 'aoi', 'dying_beacon')
  const a = w.fighters[0]
  a.invincible = 0
  const side = w.plats.find((p) => p.type === 'passthrough')
  a.x = side ? side.x + side.w / 2 : -490
  a.y = side ? side.y : -75
  a.vx = 0
  a.vy = 0
  a.onGround = true
  a.crouching = true
  for (let i = 0; i < 3; i++) step(w, [hold({ down: true, shield: true }), hold()])
  step(w, [hold({ down: true, shield: true, jumpPressed: true, jumpHeld: true }), hold()])
  ok(a.coyote === 0 && a.jumpBuffer === 0, '下穿后郊狼时间与跳跃缓冲被清零', `coy=${a.coyote} buf=${a.jumpBuffer}`)
  for (let i = 0; i < 40; i++) step(w, [hold(), hold()])
  ok(a.y > -60, '确实落到了平台下方', `y=${a.y.toFixed(1)}`)
}

console.log(`\n手感断言：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
