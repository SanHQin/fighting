/**
 * 战斗链路验证：确认「出招 → 命中 → 伤害累加 → 击飞变远 → 出界扣命 → 结算」全部连通。
 *
 * 用法：node tools/check-combat.mjs
 *
 * 和 smoke-sim.mjs 的区别：那个是"跑起来不崩"，这个是"打起来有反应"。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSim } from './lib/simharness.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

const { core, data, outDir, stageById } = await loadSim('combat')
const { step, emptyInput, C } = core
const { CHARS, STAGES } = data

/** 内核只接收已解析的定义；按 id 查表在 harness 里做 */
const createWorld = (a, b, stageLike) =>
  core.createWorld(a, b, typeof stageLike === 'string' ? stageById.get(stageLike) : stageLike)



const fails = []
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`  ✓ ${label}${extra ? '  ' + extra : ''}`)
  else {
    console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`)
    fails.push(label)
  }
}

const li = CHARS.find((c) => c.id === 'li') ?? CHARS[0]
const aoi = CHARS.find((c) => c.id === 'aoi') ?? CHARS[1]
const stage = STAGES[0]

/* ---------- 1. 出招会命中并造成伤害 ---------- */
console.log('\n1) 攻击 → 命中 → 伤害累加')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  // 面对面贴住：清掉无敌，放到主台上
  a.x = -30
  a.y = 0
  a.facing = 1
  b.x = 30
  b.y = 0
  b.facing = -1
  a.invincible = 0
  b.invincible = 0
  a.onGround = true
  b.onGround = true

  const attackInput = { ...emptyInput(), attack: true }
  const idle = emptyInput()
  let hitCount = 0
  for (let i = 0; i < 200; i++) {
    // 每 60 帧敲一下，避免一直在起手
    const inp = i % 60 < 2 ? attackInput : idle
    step(w, [inp, idle])
    hitCount += w.events.filter((e) => e.type === 'hit').length
  }
  ok(hitCount > 0, '命中事件确实产生了', `hit=${hitCount}`)
  ok(b.damage > 0, '受害者伤害百分比上升', `damage=${b.damage.toFixed(1)}%`)
  ok(a.dealt > 0, '攻击者累计伤害记账', `dealt=${a.dealt}`)
}

/* ---------- 2. 击飞随伤害变远 ---------- */
console.log('\n2) 伤害越高击飞越远')
{
  const measure = (preDamage) => {
    const w = createWorld(li, aoi, stage.id)
    const [a, b] = w.fighters
    a.x = -30
    a.y = 0
    a.facing = 1
    b.x = 30
    b.y = 0
    b.facing = -1
    a.invincible = 0
    b.invincible = 0
    a.onGround = true
    b.onGround = true
    b.damage = preDamage

    const attackInput = { ...emptyInput(), attack: true }
    const idle = emptyInput()
    const startX = b.x
    for (let i = 0; i < 8; i++) step(w, [attackInput, idle])
    // 命中后让击飞跑完
    for (let i = 0; i < 40; i++) step(w, [idle, idle])
    return Math.abs(b.x - startX)
  }
  const d0 = measure(0)
  const d100 = measure(100)
  const d200 = measure(200)
  console.log(`     0% → ${d0.toFixed(1)}px, 100% → ${d100.toFixed(1)}px, 200% → ${d200.toFixed(1)}px`)
  ok(d0 > 0, '0% 伤害也有击飞')
  ok(d100 > d0, '100% 比 0% 推得更远')
  ok(d200 > d100, '200% 比 100% 推得更远')
}

/* ---------- 3. 出界扣命 + 复活 ---------- */
console.log('\n3) 出界扣命与复活')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.invincible = 0
  a.x = 5000 // 直接扔出界
  step(w, [emptyInput(), emptyInput()])
  ok(a.stocks === C.STOCKS - 1, '出界后扣一条命', `stocks=${a.stocks}`)
  ok(a.respawnTimer === C.RESPAWN_DELAY_FRAMES, '进入复活倒计时', `timer=${a.respawnTimer}`)

  for (let i = 0; i < C.RESPAWN_DELAY_FRAMES + 2; i++) step(w, [emptyInput(), emptyInput()])
  ok(a.respawnTimer === 0, '倒计时归零')
  ok(a.invincible > 0, '复活后有无敌帧', `inv=${a.invincible}`)
  ok(Math.abs(a.x) < 400 && a.y < 0, '回到出生点上方', `x=${a.x.toFixed(0)} y=${a.y.toFixed(0)}`)
  ok(a.damage === 0, '复活清空伤害')
}

/* ---------- 4. 命数耗尽判定胜负 ---------- */
console.log('\n4) 三条命耗尽即判负')
{
  const w = createWorld(li, aoi, stage.id)
  const [a] = w.fighters
  a.stocks = 1
  a.invincible = 0
  a.x = 5000
  step(w, [emptyInput(), emptyInput()])
  ok(w.over === true, '对局结束')
  ok(w.winner === 1, '另一方获胜', `winner=${w.winner}`)
}

/* ---------- 5. 一次挥击只打一下 ---------- */
console.log('\n5) 一次挥击只命中一次')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.x = -30
  a.y = 0
  a.facing = 1
  b.x = 30
  b.y = 0
  a.invincible = 0
  b.invincible = 0
  a.onGround = true
  b.onGround = true
  // 让双方都被钉在原地（受击会飞出去，这里只看判定期内的重复命中）
  let hits = 0
  const attackInput = { ...emptyInput(), attack: true }
  for (let i = 0; i < 20; i++) {
    step(w, [attackInput, emptyInput()])
    hits += w.events.filter((e) => e.type === 'hit').length
    b.x = 30 // 钉住，不让击飞拉开距离
    b.y = 0
    b.vx = 0
    b.vy = 0
  }
  ok(hits === 1, '一次出招只结算一次命中', `hits=${hits}`)
}

/* ---------- 6. 防御：扣盾不扣血 ---------- */
console.log('\n6) 防御挡下攻击：扣盾值、不扣血')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.x = -30
  a.y = 0
  a.facing = 1
  b.x = 30
  b.y = 0
  b.facing = -1
  a.invincible = 0
  b.invincible = 0
  a.onGround = true
  b.onGround = true
  const shieldBefore = b.shield
  const dmgBefore = b.damage
  const attackInput = { ...emptyInput(), attack: true }
  const holdShield = { ...emptyInput(), shield: true }
  let blocks = 0
  for (let i = 0; i < 30; i++) {
    step(w, [attackInput, holdShield])
    blocks += w.events.filter((e) => e.type === 'block').length
    b.x = 30
    a.x = -30
    b.vx = 0
    a.vx = 0
  }
  ok(blocks > 0, '产生了格挡事件', `block=${blocks}`)
  ok(b.damage === dmgBefore, '举盾时伤害百分比不变', `damage=${b.damage}`)
  ok(b.shield < shieldBefore, '盾值被扣除', `${shieldBefore} → ${b.shield.toFixed(1)}`)
}

/* ---------- 7. 破盾后不能防御 ---------- */
console.log('\n7) 盾值归零 → 破盾 → 眩晕期间不能防御')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.x = -30
  a.y = 0
  a.facing = 1
  b.x = 30
  b.y = 0
  b.facing = -1
  a.invincible = 0
  b.invincible = 0
  a.onGround = true
  b.onGround = true
  b.shield = 5

  let broke = false
  const attackInput = { ...emptyInput(), attack: true }
  const holdShield = { ...emptyInput(), shield: true }
  for (let i = 0; i < 200 && !broke; i++) {
    step(w, [attackInput, holdShield])
    if (w.events.some((e) => e.type === 'shieldbreak')) broke = true
    b.x = 30
    a.x = -30
    b.vx = 0
    a.vx = 0
  }
  ok(broke, '盾值耗尽触发破盾')
  ok(b.shieldBreakStun > 0, '进入破盾眩晕', `stun=${b.shieldBreakStun}`)
  ok(b.crouching === false, '眩晕期间不能下蹲防御')

  const dmgBefore = b.damage
  for (let i = 0; i < 60; i++) {
    step(w, [attackInput, holdShield])
    b.x = 30
    a.x = -30
    b.vx = 0
    a.vx = 0
  }
  ok(b.damage > dmgBefore, '破盾后挨打会掉血', `damage=${b.damage.toFixed(1)}%`)
}

/* ---------- 8. 五个攻击方向都能命中 ---------- */
console.log('\n8) 五方向攻击：每个方向都能出判定')
{
  const dirs = [
    ['neutral', {}],
    ['forward', { right: true }],
    ['back', { left: true }],
    ['up', { up: true }],
    ['down', { down: true }],
  ]
  for (const [name, keys] of dirs) {
    const w = createWorld(li, aoi, stage.id)
    const [a, b] = w.fighters
    a.x = 0
    a.y = 0
    a.facing = 1
    if (name === 'up') {
      b.x = 12
      b.y = -34
    } else if (name === 'down') {
      b.x = 18
      b.y = 10
    } else if (name === 'back') {
      b.x = -36
      b.y = 0
    } else {
      b.x = 30
      b.y = 0
    }
    a.invincible = 0
    b.invincible = 0
    a.onGround = true
    b.onGround = true

    const inp = { ...emptyInput(), attack: true, ...keys }
    let hit = 0
    for (let i = 0; i < 20; i++) {
      step(w, [inp, emptyInput()])
      hit += w.events.filter((e) => e.type === 'hit').length
      b.vx = 0
      b.vy = 0
      b.x = name === 'back' ? -36 : name === 'up' ? 12 : name === 'down' ? 18 : 30
      b.y = name === 'up' ? -34 : name === 'down' ? 10 : 0
    }
    ok(hit === 1, `${name} 方向命中一次`, `hit=${hit} dir=${a.attackDir}`)
    ok(a.attackDir === name, `${name} 方向解析正确`, `got=${a.attackDir}`)
  }
}

/* ---------- 9. 200% 以上 + 连击 → 被击飞到场外 ---------- */
console.log('\n9) 高伤害 + 多段连击 → 直接击飞出界')
{
  // 先证明连击确实会放大击飞：同样 230% 伤害，第 2 段只要叠上连击就飞得更远。
  // 注意不能量位移——受害者会被打出界然后复活，位移会被"传送到出生点"污染。
  // 改为量命中瞬间的击飞速度（vx/vy 的模）。
  const kbSpeed = (combo) => {
    const w = createWorld(li, aoi, stage.id)
    const [a, b] = w.fighters
    a.x = 0
    a.y = 0
    a.facing = 1
    b.x = 34
    b.y = 0
    b.damage = 230
    a.invincible = 0
    b.invincible = 0
    a.onGround = true
    b.onGround = true
    // 直接注入连击数，绕开"能不能连上"的人为节奏问题
    a.combo = combo
    a.comboExpire = C.COMBO_EXPIRE
    const attackInput = { ...emptyInput(), attack: true }
    let best = 0
    for (let i = 0; i < 40; i++) {
      step(w, [attackInput, emptyInput()])
      best = Math.max(best, Math.hypot(b.vx, b.vy))
    }
    return best
  }
  const solo = kbSpeed(0) // 命中后 combo 变 1 → 倍率 1.00
  const chained = kbSpeed(5) // 命中后 combo 变 6 → 倍率 1.20（封顶）
  console.log(`     连击 1 段 → 速度 ${solo.toFixed(2)}, 连击 6 段 → 速度 ${chained.toFixed(2)}`)
  ok(chained > solo * 1.15, '连击段数放大击飞速度', `${solo.toFixed(2)} → ${chained.toFixed(2)}`)

  // 再证明高伤害真的能被连击打出界：贴住台边反复连打
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.x = 620
  a.y = 0
  a.facing = 1
  b.x = 664
  b.y = 0
  b.damage = 230
  a.invincible = 0
  b.invincible = 0
  a.onGround = true
  b.onGround = true

  const attackInput = { ...emptyInput(), attack: true }
  const idle = emptyInput()
  let koed = false
  let maxCombo = 0
  for (let i = 0; i < 600; i++) {
    step(w, [i % 14 < 3 ? attackInput : idle, idle])
    maxCombo = Math.max(maxCombo, a.combo)
    if (b.stocks < 3 || w.events.some((e) => e.type === 'ko')) {
      koed = true
      break
    }
    // 前 3 段人为钉住受害者，模拟"被连段抓住出不去"
    if (a.combo < 3) {
      b.x = 664
      b.y = 0
      b.vx = 0
      b.vy = 0
    }
  }
  ok(maxCombo >= 3, '连段累积起来了', `maxCombo=${maxCombo}`)
  ok(koed && b.stocks < 3, '230% 被连段击飞出界', `stocks=${b.stocks}`)
}

/* ---------- 10. 低伤害不会一击致命 ---------- */
console.log('\n10) 0% 伤害挨打不会直接出界')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.x = 620
  a.y = 0
  a.facing = 1
  b.x = 660
  b.y = 0
  b.damage = 0
  a.invincible = 0
  b.invincible = 0
  a.onGround = true
  b.onGround = true
  const attackInput = { ...emptyInput(), attack: true }
  for (let i = 0; i < 26; i++) step(w, [attackInput, emptyInput()])
  ok(b.stocks === C.STOCKS, '0% 时一击不会出界', `stocks=${b.stocks} x=${b.x.toFixed(0)}`)
}

/* ---------- 11. 下蹲 = 防御 ---------- */
console.log('\n11) 按 S 下蹲即防御')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.x = -30
  a.y = 0
  a.facing = 1
  b.x = 30
  b.y = 0
  b.facing = -1
  a.invincible = 0
  b.invincible = 0
  a.onGround = true
  b.onGround = true

  const crouch = { ...emptyInput(), down: true, shield: true }
  for (let i = 0; i < 3; i++) step(w, [emptyInput(), crouch])
  ok(b.crouching === true, '按住 S 进入下蹲', `crouching=${b.crouching}`)
  ok(b.state === 'crouch', '状态名是 crouch', `state=${b.state}`)

  // 蹲着不动也不该漂移
  const xBefore = b.x
  for (let i = 0; i < 20; i++) step(w, [emptyInput(), { ...crouch, left: true }])
  ok(Math.abs(b.x - xBefore) < 0.01, '下蹲时不能移动', `dx=${(b.x - xBefore).toFixed(3)}`)
}

/* ---------- 12. 变形盾：盾值越小越小，漏招 ---------- */
console.log('\n12) 变形盾：盾体随盾值缩小，太小会漏招')
{
  // 同一次攻击，盾满时挡住、盾空时漏过去
  const attempt = (shieldValue) => {
    const w = createWorld(li, aoi, stage.id)
    const [a, b] = w.fighters
    a.x = -30
    a.y = 0
    a.facing = 1
    b.x = 30
    b.y = 0
    b.facing = -1
    a.invincible = 0
    b.invincible = 0
    a.onGround = true
    b.onGround = true
    b.shield = shieldValue
    let blocks = 0
    let hits = 0
    const attackInput = { ...emptyInput(), attack: true }
    const crouch = { ...emptyInput(), down: true, shield: true }
    for (let i = 0; i < 20; i++) {
      step(w, [attackInput, crouch])
      blocks += w.events.filter((e) => e.type === 'block').length
      hits += w.events.filter((e) => e.type === 'hit').length
      b.x = 30
      a.x = -30
      b.vx = 0
      a.vx = 0
    }
    return { blocks, hits, damage: b.damage }
  }
  const full = attempt(C.SHIELD_MAX)
  const low = attempt(6)
  console.log(
    `     满盾：block=${full.blocks} hit=${full.hits} 血=${full.damage} ／ 残盾(6)：block=${low.blocks} hit=${low.hits} 血=${low.damage}`,
  )
  ok(full.blocks > 0 && full.damage === 0, '满盾完全挡下', `block=${full.blocks} dmg=${full.damage}`)
  ok(low.hits > 0, '盾太小时攻击从盾边漏过去', `hit=${low.hits}`)
  ok(low.damage > 0, '漏招会真的掉血', `dmg=${low.damage}%`)
}

/* ---------- 13. 盾值恢复速度 ---------- */
console.log('\n13) 收盾后盾值快速恢复')
{
  const w = createWorld(li, aoi, stage.id)
  const [a] = w.fighters
  a.invincible = 0
  a.onGround = true
  a.shield = 10
  // 不按任何键，等回盾
  let framesToFull = 0
  for (let i = 0; i < 200; i++) {
    step(w, [emptyInput(), emptyInput()])
    framesToFull++
    if (a.shield >= C.SHIELD_MAX) break
  }
  console.log(`     从 10 回满用了 ${framesToFull} 帧（${(framesToFull / 60).toFixed(2)}s）`)
  ok(a.shield >= C.SHIELD_MAX, '盾值能回满')
  ok(framesToFull < 120, '2 秒内回满（旧版是 40 帧延迟 + 0.18/帧）', `${framesToFull} 帧`)
}

/* ---------- 14. 蹲 + 跳 = 穿下平台 ---------- */
console.log('\n14) 蹲下按跳可以穿下单向平台')
{
  const w = createWorld(li, aoi, stage.id)
  const [a] = w.fighters
  a.invincible = 0
  // 站到侧副台（id=1，passthrough，y=-75，x -655..-335）
  a.x = -500
  a.y = -75
  a.vx = 0
  a.vy = 0
  a.onGround = true
  a.crouching = true

  // 先确认站在平台上不会自己掉下去
  for (let i = 0; i < 5; i++) step(w, [emptyInput(), emptyInput()])
  ok(Math.abs(a.y - -75) < 0.6, '站在单向平台上不会自己掉', `y=${a.y.toFixed(1)}`)

  // 蹲 + 跳
  let dropped = false
  for (let i = 0; i < 20 && !dropped; i++) {
    step(w, [{ ...emptyInput(), down: true, shield: true, jumpPressed: true }, emptyInput()])
    if (w.events.some((e) => e.type === 'dropthrough')) dropped = true
  }
  ok(dropped, '触发了 dropthrough 事件')
  // 再跑 40 帧，应该已经掉到台下方
  for (let i = 0; i < 40; i++) step(w, [emptyInput(), emptyInput()])
  ok(a.y > -60, '落到了侧副台下方', `y=${a.y.toFixed(1)}`)

  // 对照：在实心主台上蹲跳只是普通跳，不会穿下去
  const w2 = createWorld(li, aoi, stage.id)
  const [c] = w2.fighters
  c.invincible = 0
  c.x = 0
  c.y = 0
  c.onGround = true
  c.crouching = true
  let through = false
  for (let i = 0; i < 20; i++) {
    step(w2, [{ ...emptyInput(), down: true, shield: true, jumpPressed: true }, emptyInput()])
    if (w2.events.some((e) => e.type === 'dropthrough')) through = true
  }
  ok(!through, '实心主台上蹲跳不会穿下去')
}

/* ---------- 15. 八方向：斜向两个方向也能命中 ---------- */
console.log('\n15) 八方向攻击：斜向 upForward / downBack 也能出判定')
{
  const cases = [
    ['upForward', { up: true, right: true }, { x: 34, y: -40 }],
    ['upBack', { up: true, left: true }, { x: -34, y: -40 }],
    ['downForward', { down: true, right: true }, { x: 26, y: 14 }],
    ['downBack', { down: true, left: true }, { x: -26, y: 14 }],
  ]
  for (const [name, keys, pos] of cases) {
    const w = createWorld(li, aoi, stage.id)
    const [a, b] = w.fighters
    a.x = 0
    a.y = 0
    a.facing = 1
    b.x = pos.x
    b.y = pos.y
    a.invincible = 0
    b.invincible = 0
    a.onGround = true
    b.onGround = true
    const inp = { ...emptyInput(), attack: true, ...keys }
    let hit = 0
    for (let i = 0; i < 20; i++) {
      step(w, [inp, emptyInput()])
      hit += w.events.filter((e) => e.type === 'hit').length
      b.vx = 0
      b.vy = 0
      b.x = pos.x
      b.y = pos.y
    }
    ok(a.attackDir === name, `${name} 方向解析正确`, `got=${a.attackDir}`)
    ok(hit >= 1, `${name} 方向命中`, `hit=${hit}`)
  }
}

/* ---------- 16. 角色独有必杀：投射物真的飞出去、真的造成伤害 ---------- */
console.log('\n16) 角色独有必杀：投射物/陷阱/投技')
{
  const kindOf = (id) => CHARS.find((c) => c.id === id).specials.map((s) => s.kind)
  ok(kindOf('aoi').includes('arrow'), '葵有弓箭', kindOf('aoi').join(','))
  ok(kindOf('li').includes('bottle'), '砺有酒瓶', kindOf('li').join(','))
  ok(kindOf('li').includes('trap'), '砺有陷阱', kindOf('li').join(','))
  ok(kindOf('ken').includes('bomb'), '肯有炸弹', kindOf('ken').join(','))
  ok(kindOf('ken').includes('grab'), '肯有投技', kindOf('ken').join(','))

  // 葵放箭：应该产生投射物，并打到对面
  const w = createWorld(aoi, li, stage.id)
  const [a, b] = w.fighters
  a.x = -200
  a.y = 0
  a.facing = 1
  b.x = 200
  b.y = 0
  b.facing = -1
  a.invincible = 0
  b.invincible = 0
  a.onGround = true
  b.onGround = true
  const fire = { ...emptyInput(), special: true }
  let sawProj = false
  let hurt = 0
  for (let i = 0; i < 90; i++) {
    step(w, [fire, emptyInput()])
    if (w.projectiles.length > 0) sawProj = true
    hurt += w.events.filter((e) => e.type === 'hit').length
    b.x = 200
    b.y = 0
    b.vx = 0
    b.vy = 0
  }
  ok(sawProj, '箭作为投射物存在于场上')
  ok(b.damage > 0, '箭命中了对手', `damage=${b.damage.toFixed(1)}% hurtEvents=${hurt}`)

  // 肯的投技：贴身应该直接命中
  const w2 = createWorld(CHARS.find((c) => c.id === 'ken'), aoi, stage.id)
  const [k, v] = w2.fighters
  k.x = 0
  k.y = 0
  k.facing = 1
  v.x = 40
  v.y = 0
  k.invincible = 0
  v.invincible = 0
  k.onGround = true
  v.onGround = true
  for (let i = 0; i < 30; i++) {
    step(w2, [fire, emptyInput()])
    v.x = 40
    v.vx = 0
    v.vy = 0
  }
  ok(v.damage > 0, '投技贴身命中', `damage=${v.damage.toFixed(1)}%`)
}

/* ---------- 17. 击倒：高伤 + 连击 → 倒地、闪烁无敌 ---------- */
console.log('\n17) 击倒：伤害过门槛 + 被连击 → 倒地并进入无敌虚无')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.x = 0
  a.y = 0
  a.facing = 1
  b.x = 34
  b.y = 0
  b.facing = -1
  a.invincible = 0
  b.invincible = 0
  a.onGround = true
  b.onGround = true
  b.damage = 150
  a.combo = 2
  a.comboExpire = C.COMBO_EXPIRE

  const attackInput = { ...emptyInput(), attack: true }
  let knocked = false
  let sawEvent = false
  for (let i = 0; i < 40 && !knocked; i++) {
    step(w, [attackInput, emptyInput()])
    if (w.events.some((e) => e.type === 'knockdown')) sawEvent = true
    if (b.knockedDown) knocked = true
    b.x = 34
    b.vx = 0
  }
  ok(sawEvent, '产生 knockdown 事件')
  ok(knocked, '进入击倒状态', `knockedDown=${b.knockedDown}`)
  ok(b.invincible > 0, '击倒期间无敌', `inv=${b.invincible}`)
  ok(a.knockdowns === 0 && b.knockdowns === 1, '击倒记在受害者账上', `b.knockdowns=${b.knockdowns}`)

  const dmgBefore = b.damage
  for (let i = 0; i < 20; i++) {
    step(w, [attackInput, emptyInput()])
    b.x = 34
    b.vx = 0
    b.vy = 0
  }
  ok(b.damage === dmgBefore, '无敌虚无期间打不掉血', `damage=${b.damage}%`)
}

/* ---------- 18. 可破坏地形 ---------- */
console.log('\n18) 可破坏平台：打碎了会掉下去，过一会儿会回来')
{
  const w = createWorld(li, aoi, stage.id)
  const pl = w.plats.find((p) => p.maxHp > 0)
  ok(!!pl, '场地里存在可破坏平台', pl ? `id=${pl.id} hp=${pl.maxHp}` : '')
  if (pl) {
    const hpBefore = pl.hp
    const mod = core
    const dmgFn = mod.damagePlatform ?? mod.damagePlat
    for (let i = 0; i < 20; i++) dmgFn(w, pl, 10)
    ok(pl.broken, '打够伤害后平台碎裂', `hp ${hpBefore} → ${pl.hp}`)
    // 重生计时在 step() 里推进，先走一帧
    step(w, [emptyInput(), emptyInput()])
    ok(pl.respawnTimer > 0, '进入重生倒计时', `timer=${pl.respawnTimer}`)
    for (let i = 0; i < pl.respawnTimer + 3; i++) step(w, [emptyInput(), emptyInput()])
    ok(!pl.broken && pl.hp === pl.maxHp, '倒计时结束后平台恢复', `broken=${pl.broken} hp=${pl.hp}`)
  }
}

/* ---------- 19. 场地事件 ---------- */
console.log('\n19) 场地事件会伤到站在里面的人')
{
  const gearStage = STAGES.find((s) => s.hazards.some((h) => h.kind === 'gear'))
  if (!gearStage) {
    ok(false, '找到带齿轮的场地')
  } else {
    const w = createWorld(li, aoi, gearStage.id)
    const [a] = w.fighters
    a.invincible = 0
    const hz = gearStage.hazards.find((h) => h.kind === 'gear')
    a.x = hz.x + hz.w / 2
    a.y = hz.y + hz.h
    a.onGround = true
    let hurt = false
    for (let i = 0; i < 400 && !hurt; i++) {
      step(w, [emptyInput(), emptyInput()])
      if (w.events.some((e) => e.type === 'hazard')) hurt = true
    }
    ok(hurt, '站在齿轮里被伤到', `damage=${a.damage.toFixed(1)}%`)
    ok(a.damage > 0 || a.stocks < C.STOCKS, '伤害或命数有变化')
  }
}

/* ---------- 21. 冲刺：有位移、有冷却 ---------- */
console.log('\n21) 冲刺：按 L 会冲出去，冲完进入冷却')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.x = -200
  a.y = 0
  a.facing = 1
  a.invincible = 0
  a.onGround = true
  b.x = 600
  b.y = 0
  a.dashCd = 0
  const x0 = a.x

  // 起手那一帧必须立刻上冷却，否则会出现"连按连冲"
  step(w, [{ ...emptyInput(), right: true, dashPressed: true, dash: true }, emptyInput()])
  const cdAfterStart = a.dashCd
  ok(cdAfterStart > 0, '冲刺起手立刻进入冷却', `dashCd=${cdAfterStart}f`)

  // 冷却还没过完时再按：不能重新起冲
  const beforeTimer = a.dashTimer
  step(w, [{ ...emptyInput(), right: true, dashPressed: true, dash: true }, emptyInput()])
  ok(a.dashCd > 0 && a.dashTimer < beforeTimer, '冷却期间再按不会重置冲刺', `dashCd=${a.dashCd}f`)

  for (let i = 0; i < 30; i++) step(w, [emptyInput(), emptyInput()])
  const moved = a.x - x0
  ok(moved > 100, '冲刺产生了明显位移', `Δx=${moved.toFixed(0)}px`)

  // 冷却走完后可以再冲
  ok(a.dashCd <= 0, '冷却会走完', `dashCd=${a.dashCd}f`)
  const x2 = a.x
  step(w, [{ ...emptyInput(), right: true, dashPressed: true, dash: true }, emptyInput()])
  ok(a.dashTimer > 0 && a.x > x2, '冷却结束后可以再冲', `dashTimer=${a.dashTimer}`)
}

/* ---------- 22. 角色冲刺差异 ---------- */
console.log('\n22) 不同角色的冲刺手感不同（葵快而短，肯慢而远）')
{
  const aoiChar = CHARS.find((c) => c.id === 'aoi')
  const kenChar = CHARS.find((c) => c.id === 'ken')
  const run = (ch) => {
    const w = createWorld(ch, ch, stage.id)
    const [a] = w.fighters
    a.x = -400
    a.y = 0
    a.facing = 1
    a.onGround = true
    a.invincible = 0
    a.dashCd = 0
    const x0 = a.x
    let frames = 0
    for (let i = 0; i < 40; i++) {
      const inp = i === 0 ? { ...emptyInput(), right: true, dashPressed: true, dash: true } : emptyInput()
      step(w, [inp, emptyInput()])
      if (a.dashTimer > 0) frames++
    }
    return { dist: a.x - x0, frames }
  }
  const r1 = run(aoiChar)
  const r2 = run(kenChar)
  ok(r1.dist !== r2.dist, '两个角色冲刺距离不同', `葵 ${r1.dist.toFixed(0)}px / 肯 ${r2.dist.toFixed(0)}px`)
  ok(r1.frames !== r2.frames, '两个角色冲刺帧数不同', `葵 ${r1.frames}f / 肯 ${r2.frames}f`)
}

/* ---------- 23. 空中冲刺：次数有限，落地重置 ---------- */
console.log('\n23) 空中冲刺：次数有限，落地后恢复')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  a.x = 0
  a.y = -300
  a.vy = 0
  a.facing = 1
  a.onGround = false
  a.invincible = 0
  a.dashCd = 0
  b.x = 500
  b.y = 0
  const before = a.airDashes
  step(w, [{ ...emptyInput(), right: true, dashPressed: true, dash: true }, emptyInput()])
  ok(a.airDashes === before - 1, '空中冲刺消耗一次', `${before} → ${a.airDashes}`)
  ok(a.y < 0 && a.onGround === false, '空中冲刺不贴地')
}

/* ---------- 24. 冲刺攻击：帧数据更强、能触发 ---------- */
console.log('\n24) 冲刺攻击：方向 + 攻击 + 冲刺')
{
  const mod = core
  const { moveOf } = mod

  const w = createWorld(li, aoi, stage.id)
  const a = w.fighters[0]
  const normal = moveOf(a, 'neutral', false)
  const dashed = moveOf(a, 'neutral', true)
  ok(
    dashed.damage > normal.damage,
    '冲刺攻击伤害高于普通攻击',
    `${normal.damage} → ${dashed.damage}`,
  )
  ok(
    dashed.boxW > normal.boxW && dashed.fwd > normal.fwd,
    '冲刺攻击判定更大更远',
    `boxW ${normal.boxW}→${dashed.boxW} fwd ${normal.fwd}→${dashed.fwd}`,
  )

  // 冲刺中按攻击必须真的触发 dashattack
  const w2 = createWorld(li, aoi, stage.id)
  const [p, q] = w2.fighters
  p.x = -260
  p.y = 0
  p.facing = 1
  p.onGround = true
  p.invincible = 0
  p.dashCd = 0
  q.x = 600
  q.y = 0
  let triggered = false
  for (let i = 0; i < 8 && !triggered; i++) {
    let inp = emptyInput()
    if (i === 0) inp = { ...emptyInput(), right: true, dashPressed: true, dash: true }
    if (i === 2) inp = { ...emptyInput(), attack: true }
    step(w2, [inp, emptyInput()])
    if (p.dashAttack) triggered = true
  }
  ok(triggered, '冲刺中按攻击 = 冲刺攻击', `dashAttack=${p.dashAttack}`)
  ok(p.state === 'dashattack' || p.attackFrame >= 0, '进入冲刺攻击状态', `state=${p.state}`)
}

/* ---------- 25. 抓边 + 攀爬 ---------- */
console.log('\n25) 抓边：掉出去能抓住台边，按跳上爬回场')
{
  const w = createWorld(li, aoi, stage.id)
  const [a, b] = w.fighters
  // 主台左边 x=-750，把角色放在台边外侧、稍低于台面
  a.x = -745
  a.y = 30
  a.vx = -1
  a.vy = 2
  a.onGround = false
  a.invincible = 0
  a.ledgeCd = 0
  a.ledgeLock = 0
  b.x = 400
  b.y = 0
  let grabbed = false
  for (let i = 0; i < 30 && !grabbed; i++) {
    step(w, [emptyInput(), emptyInput()])
    if (a.ledge) grabbed = true
  }
  ok(grabbed, '落到台边外侧时自动抓住', a.ledge ? `x=${a.x.toFixed(0)} y=${a.y.toFixed(0)}` : '')

  if (a.ledge) {
    // 悬挂期间不掉下去
    const yHold = a.y
    for (let i = 0; i < 20; i++) step(w, [emptyInput(), emptyInput()])
    ok(Math.abs(a.y - yHold) < 2, '悬挂期间不下坠', `y=${a.y.toFixed(1)}`)

    // 按跳 → 上爬 → 回到台面
    let climbed = false
    for (let i = 0; i < 40 && !climbed; i++) {
      const inp = i === 0 ? { ...emptyInput(), jumpPressed: true } : emptyInput()
      step(w, [inp, emptyInput()])
      if (w.events.some((ev) => ev.type === 'climb')) climbed = true
    }
    ok(climbed, '按跳触发上爬')
    for (let i = 0; i < 30; i++) step(w, [emptyInput(), emptyInput()])
    ok(a.onGround && !a.ledge, '上爬后回到台面', `onGround=${a.onGround} y=${a.y.toFixed(0)}`)
  }
}

/* ---------- 26. 方向 + 技能键选出不同变体 ---------- */
console.log('\n26) 方向 + 技能键 = 不同的必杀')
{
  const mod = core
  const pick = mod.pickSpecial
  if (!pick) {
    ok(false, '导出 pickSpecial')
  } else {
    const w = createWorld(li, aoi, stage.id)
    const a = w.fighters[0]
    const plain = pick(a, 0, { ...emptyInput(), special: true })
    const upIn = pick(a, 0, { ...emptyInput(), special: true, up: true })
    const downIn = pick(a, 1, { ...emptyInput(), special2: true, down: true })
    ok(!!plain, '无方向时能选到必杀', plain ? plain.name : '')
    ok(plain?.name !== upIn?.name, '加方向后选中不同变体', `${plain?.name} vs ${upIn?.name}`)
    ok(!!downIn, '槽 2 的方向变体可用', downIn ? downIn.name : '')
  }
}

/* ---------- 27. 多场地跑通 ---------- */
console.log('\n27) 四张场地都能跑满 600 帧不崩')
{
  for (const st of STAGES) {
    const w = createWorld(CHARS[0], CHARS[1], st.id)
    let bad = ''
    for (let i = 0; i < 600; i++) {
      step(w, [
        { ...emptyInput(), right: i % 40 < 20, attack: i % 30 < 3, special: i % 90 < 3 },
        { ...emptyInput(), left: i % 50 < 20, down: i % 70 < 10, shield: i % 70 < 10 },
      ])
      for (const f of w.fighters) {
        if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) bad = `NaN @${i}`
      }
    }
    ok(!bad, `${st.displayName} 跑通了`, bad)
  }
}


/* ---------- 28. 八方向冲刺 ---------- */
console.log('\n28) 方向 + 冲刺键 = 八方向冲刺')
{
  const dirs = [
    ['右', { right: true }, 1, 0],
    ['左', { left: true }, -1, 0],
    ['上', { up: true }, 0, -1],
    ['下', { down: true }, 0, 1],
    ['右上', { up: true, right: true }, 1, -1],
    ['左上', { up: true, left: true }, -1, -1],
    ['右下', { down: true, right: true }, 1, 1],
    ['左下', { down: true, left: true }, -1, 1],
  ]
  const bad = []
  for (const [name, held, sx, sy] of dirs) {
    const w = createWorld(li, aoi, stage.id)
    const a = w.fighters[0]
    a.x = 0
    a.y = -300
    a.onGround = false
    a.airDashes = 3
    a.dashCd = 0
    a.vx = 0
    a.vy = 0
    // 空冲有 AIR_DASH_MUL，这里直接看速度向量的方向对不对
    step(w, [{ ...emptyInput(), ...held, dashPressed: true }, emptyInput()])
    const vx = a.vx
    const vy = a.vy
    const gotX = Math.abs(vx) < 0.01 ? 0 : vx > 0 ? 1 : -1
    const gotY = Math.abs(vy) < 0.01 ? 0 : vy > 0 ? 1 : -1
    if (gotX !== sx || gotY !== sy) bad.push(`${name}(vx=${vx.toFixed(1)},vy=${vy.toFixed(1)})`)
  }
  ok(bad.length === 0, '八个方向都冲对了', bad.join(' '))

  // 无方向时按朝向冲
  const w2 = createWorld(li, aoi, stage.id)
  const f2 = w2.fighters[0]
  f2.x = 0
  f2.y = 0
  f2.onGround = true
  f2.facing = -1
  f2.dashCd = 0
  step(w2, [{ ...emptyInput(), dashPressed: true }, emptyInput()])
  ok(f2.vx < 0, '没按方向时按朝向冲', `facing=-1 vx=${f2.vx.toFixed(1)}`)

  // 上冲必须真的上升：重力在冲刺期间不生效
  const w3 = createWorld(li, aoi, stage.id)
  const f3 = w3.fighters[0]
  f3.x = 0
  f3.y = -260
  f3.onGround = false
  f3.airDashes = 3
  f3.dashCd = 0
  f3.vy = 0
  const y0 = f3.y
  step(w3, [{ ...emptyInput(), up: true, dashPressed: true }, emptyInput()])
  for (let i = 0; i < 6; i++) step(w3, [emptyInput(), emptyInput()])
  ok(f3.y < y0 - 60, '上冲真的往上走（重力没吃掉）', `${y0.toFixed(0)} → ${f3.y.toFixed(0)}`)
}

/* ---------- 29. 场外复归冲刺 ---------- */
console.log('\n29) 被打出场外：方向 + 冲刺 = 快速飞回来（只给 1 次，回到场地才补满）')
{
  const main = stage.platforms.find((pl) => pl.type === 'solid')
  const rightEdge = main.x + main.w
  // 放到"一冲回不来"的距离：整段测试必须留在场外，否则角色一冲进场就会补满，
  // 后面"用完不能再冲"的断言会变成假绿。
  const outX = rightEdge + 640

  const mk = () => {
    const w = createWorld(li, aoi, stage.id)
    const f = w.fighters[0]
    f.x = outX
    f.y = -120
    f.onGround = false
    // airDashes 留 1 是真实玩家刚被打飞时的状态；旧版写成 0，正好掩盖了
    // "残留空冲次数当场外第二发"这个 bug。
    f.airDashes = 1
    f.recoveryDashes = 1
    f.dashCd = 0
    f.vx = 0
    f.vy = 0
    return { w, f }
  }

  const { w, f } = mk()
  ok(core.isOffstage(w, f), '被判定为场外', `x=${f.x.toFixed(0)} 台右沿=${rightEdge.toFixed(0)}`)

  const x0 = f.x
  step(w, [{ ...emptyInput(), left: true, dashPressed: true }, emptyInput()])
  ok(f.dashTimer > 0, '场外能冲（容错）', `dashTimer=${f.dashTimer}`)
  ok(f.airDashes === 1, '场外冲刺不消耗空中冲刺次数（留着回场地后用）', `airDashes=${f.airDashes}`)
  ok(f.recoveryDashes === 0, '复归冲刺只有 1 次', `还剩 ${f.recoveryDashes} 次`)
  ok(f.dashSpeedTotal > C.DASH_SPEED * 1.2, '场外冲刺速度更快', `speed=${f.dashSpeedTotal.toFixed(1)} 基准=${C.DASH_SPEED}`)
  ok(f.dashCd <= 12, '场外冲刺冷却更短', `cd=${f.dashCd}`)

  for (let i = 0; i < 14; i++) step(w, [{ ...emptyInput(), left: true }, emptyInput()])
  const moved = x0 - f.x
  ok(moved > 150, '确实朝场地快速位移', `飞回 ${moved.toFixed(0)}px`)
  ok(core.isOffstage(w, f), '冲完一次仍在场外（距离还不够）', `x=${f.x.toFixed(0)}`)

  // 一次性：复归用完、人还在场外，即使 airDashes 还有 1 也不能再冲
  f.dashCd = 0
  f.dashTimer = 0
  f.landLag = 0
  f.hitstun = 0
  const xBefore = f.x
  step(w, [{ ...emptyInput(), left: true, dashPressed: true }, emptyInput()])
  ok(f.dashTimer === 0, '复归用完之后不能再冲（不会一路飘回台面）',
    `dashTimer=${f.dashTimer} x=${f.x.toFixed(0)} dx=${(xBefore - f.x).toFixed(1)}`)
  ok(core.dashFuelOf(w, f) === null && f.airDashes === 1,
    '场外即使还有空冲次数也换不来冲刺（两种燃料互斥）',
    `airDashes=${f.airDashes} 燃料=${core.dashFuelOf(w, f)}`)

  // 回到场地就补满 —— 不需要等落地
  {
    const w3 = createWorld(li, aoi, stage.id)
    const c = w3.fighters[0]
    c.recoveryDashes = 0
    c.x = 0
    c.y = -200
    c.onGround = false
    c.hitstun = 0
    step(w3, [emptyInput(), emptyInput()])
    ok(!c.onGround && c.recoveryDashes === 1, '回到场地范围内就补满（不必等落地）',
      `onGround=${c.onGround} y=${c.y.toFixed(0)} 次数=${c.recoveryDashes}`)
  }

  // 反向：被击飞横穿场地上空时不能补 —— 否则被打过场就白拿一发
  {
    const w4 = createWorld(li, aoi, stage.id)
    const d = w4.fighters[0]
    d.recoveryDashes = 0
    d.x = 0
    d.y = -300
    d.onGround = false
    d.hitstun = 20
    step(w4, [emptyInput(), emptyInput()])
    ok(d.recoveryDashes === 0, '击飞途中不算回到场地（不能白拿复归）',
      `hitstun=${d.hitstun} 次数=${d.recoveryDashes}`)
  }

  // 落地补满（最常见的路径）
  {
    const w5 = createWorld(li, aoi, stage.id)
    const e = w5.fighters[0]
    e.recoveryDashes = 0
    e.x = 0
    e.y = -120
    e.vy = 6
    e.onGround = false
    for (let i = 0; i < 30; i++) step(w5, [emptyInput(), emptyInput()])
    ok(e.onGround && e.recoveryDashes === 1, '落地后复归次数是满的', `onGround=${e.onGround} 次数=${e.recoveryDashes}`)
  }

  // 对照：场内空中冲刺更慢
  {
    const w2 = createWorld(li, aoi, stage.id)
    const b = w2.fighters[0]
    b.x = 0
    b.y = -300
    b.onGround = false
    b.airDashes = 2
    b.dashCd = 0
    step(w2, [{ ...emptyInput(), left: true, dashPressed: true }, emptyInput()])
    ok(b.dashSpeedTotal < C.DASH_SPEED * 1.2, '场内空中冲刺明显慢于场外复归冲刺',
      `场内 ${b.dashSpeedTotal.toFixed(1)} vs 场外 ${C.DASH_SPEED * 1.9 * 0.82}`)
  }

  // 距离：场外复归冲刺必须明显比场内空冲远
  const dist = (startX, y, presses) => {
    const ww = createWorld(li, aoi, stage.id)
    const ff = ww.fighters[0]
    ff.x = startX
    ff.y = y
    ff.onGround = false
    ff.airDashes = 2
    ff.recoveryDashes = 1
    ff.dashCd = 0
    ff.vx = 0
    ff.vy = 0
    const xx = ff.x
    // 第一帧必须带 dashPressed，否则根本没起冲，两边比的都是普通空中移动
    step(ww, [{ ...presses, dashPressed: true }, emptyInput()])
    for (let i = 0; i < 22; i++) step(ww, [presses, emptyInput()])
    return Math.abs(ff.x - xx)
  }
  const dAir = dist(0, -300, { ...emptyInput(), left: true })
  const dRec = dist(outX, -120, { ...emptyInput(), left: true })
  ok(dRec > dAir * 1.3, '场外复归冲刺明显更远', `场内 ${dAir.toFixed(0)}px vs 场外 ${dRec.toFixed(0)}px`)
}

console.log('\n30) 攀爬上台：落点必须在平台范围内')
{
  const w = createWorld(li, aoi, stage.id)
  const a = w.fighters[0]
  const b = w.fighters[1]
  const main = stage.platforms.find((pl) => pl.type === 'solid')
  const top = main.y
  // 贴左沿挂上去
  a.x = main.x - 18
  a.y = top + 30
  a.vx = 0
  a.vy = 0
  a.onGround = false
  a.ledge = null
  a.ledgeCd = 0
  a.ledgeLock = 0
  a.invincible = 0
  b.x = 400
  b.y = top

  let grabbed = false
  for (let i = 0; i < 20 && !grabbed; i++) {
    step(w, [emptyInput(), emptyInput()])
    if (a.ledge) grabbed = true
  }
  ok(grabbed, '先抓住左沿', a.ledge ? `x=${a.x.toFixed(0)}` : '没抓住')

  if (a.ledge) {
    for (let i = 0; i < 40; i++) {
      const inp = i === 0 ? { ...emptyInput(), jumpPressed: true } : emptyInput()
      step(w, [inp, emptyInput()])
      if (!a.ledge) break
    }
    const inPlat = a.x >= main.x && a.x <= main.x + main.w
    ok(inPlat, '上爬后 x 落在平台范围内（不是台外 18px）',
      `x=${a.x.toFixed(1)} 台面=${main.x}..${main.x + main.w}`)
    ok(Math.abs(a.y - top) < 1.5, '上爬后 y 在台面上', `y=${a.y.toFixed(1)} top=${top}`)

    // 关键回归：再跑 30 帧不许掉下去 —— 这就是"站到空中"的判定
    const yAfterClimb = a.y
    for (let i = 0; i < 30; i++) step(w, [emptyInput(), emptyInput()])
    ok(Math.abs(a.y - yAfterClimb) < 2 && a.onGround,
      '站住不掉（没有悬在空中）', `y=${a.y.toFixed(1)} onGround=${a.onGround}`)
  }
}


console.log('\n31) 对局结束后时钟冻结（用时不能一直涨）')
{
  const w = createWorld(li, aoi, stage.id)
  const b = w.fighters[1]
  // 打光 P2 的命数，制造真的结束（走 KO 分支，不是手动置 over）
  b.stocks = 1
  b.damage = 300
  b.invincible = 0
  b.hitstun = 0
  // 必须严格越出 blastZone 右界（相等不算出界），否则 KO 分支根本不会进
  b.x = stage.blastZone.x + stage.blastZone.w + 80
  b.y = 0
  b.onGround = true
  let guard = 0
  while (!w.over && guard++ < 30) step(w, [emptyInput(), emptyInput()])
  ok(w.over, '对局确实结束了', `over=${w.over} winner=${w.winner}`)
  ok(w.endFrame > 0, '结束帧被记下来了', `endFrame=${w.endFrame}`)

  const endFrame = w.endFrame
  const timeLeft = w.timeLeft
  const elapsed = endFrame / 60
  for (let i = 0; i < 240; i++) step(w, [{ ...emptyInput(), right: true, attack: true }, emptyInput()])

  ok(w.endFrame === endFrame, '结束帧不再变化（用时冻结）',
    `endFrame=${w.endFrame} 用时=${(w.endFrame / 60).toFixed(1)}s`)
  ok(w.timeLeft === timeLeft, '倒计时不再减少', `${w.timeLeft} vs ${timeLeft}`)
  ok(w.endFrame / 60 === elapsed, '结算用时 = 结束那一刻', `${elapsed.toFixed(1)}s`)
  ok(w.frame > endFrame, 'frame 仍在前进（背景动画要用）', `frame=${w.frame} endFrame=${endFrame}`)

  // 结束后世界真的冻住了：开火也不会命中、也不会再生事件
  const dmg = w.fighters[1].damage
  const stocksB = w.fighters[1].stocks
  step(w, [{ ...emptyInput(), attack: true }, { ...emptyInput(), attack: true }])
  ok(w.fighters[1].damage === dmg && w.fighters[1].stocks === stocksB && w.events.length === 0,
    '结束后攻击不再结算（世界已冻结）', `damage=${w.fighters[1].damage} events=${w.events.length}`)
}


/* ---------- 32. 走出台边必须掉落（"空中行走"回归） ---------- */
console.log('\n32) 走出台边必须掉落')
{
  const w = createWorld(li, aoi, stage.id)
  const a = w.fighters[0]
  const plat = w.plats.find((p) => p.type === 'solid')
  a.x = plat.x + plat.w - 6
  a.y = plat.y
  a.vx = 0
  a.vy = 0
  a.onGround = true
  a.facing = 1
  a.invincible = 999
  a.ledgeCd = 999  // 关掉自动抓边，单独验"会不会掉"
  let airFrames = 0
  let maxY = a.y
  for (let i = 0; i < 30; i++) {
    step(w, [{ ...emptyInput(), right: true }, emptyInput()])
    if (!a.onGround) airFrames++
    if (a.y > maxY) maxY = a.y
  }
  ok(airFrames > 0, '走出台边后离地', `离地帧数=${airFrames}`)
  ok(maxY > plat.y + 7, '离地后确实在下坠', `y=${maxY.toFixed(1)}`)
}

/* ---------- 33. 按着"下"不会被台沿粘住 ---------- */
console.log('\n33) 按着"下"时不会被台沿粘住')
{
  const setup = () => {
    const w = createWorld(li, aoi, stage.id)
    const a = w.fighters[0]
    const p = w.plats.find((q) => q.grabbable) ?? w.plats[0]
    a.x = p.x + p.w + 10
    a.y = p.y + 20
    a.vx = 0
    a.vy = 3
    a.onGround = false
    a.ledgeCd = 0
    a.ledgeLock = 0
    a.hitstun = 0
    return { w, a, p }
  }
  const r1 = setup()
  step(r1.w, [{ ...emptyInput(), down: true }, emptyInput()])
  ok(r1.a.ledge === null, '按着下不会抓边', `ledge=${r1.a.ledge ? 'yes' : 'null'}`)

  const r2 = setup()
  step(r2.w, [emptyInput(), emptyInput()])
  ok(r2.a.ledge !== null, '不按下时仍会自动抓边', `ledge=${r2.a.ledge ? 'ok' : 'null'}`)
}

/* ---------- 34. 攀爬上台后站在台面上，不会飘 ---------- */
console.log('\n34) 攀爬落点在台面内且站得住')
{
  const w = createWorld(li, aoi, stage.id)
  const a = w.fighters[0]
  const p = w.plats.find((q) => q.grabbable) ?? w.plats[0]
  a.x = p.x + p.w + 10
  a.y = p.y + 20
  a.vy = 3
  a.onGround = false
  a.ledgeCd = 0
  step(w, [emptyInput(), emptyInput()])
  ok(!!a.ledge, '先抓住台沿', `ledge=${!!a.ledge}`)
  step(w, [{ ...emptyInput(), jumpPressed: true }, emptyInput()])
  for (let i = 0; i < 24; i++) step(w, [emptyInput(), emptyInput()])
  ok(a.onGround === true, '攀爬结束站在台面上', `onGround=${a.onGround}`)
  ok(Math.abs(a.y - p.y) < 0.001, '脚底落在台面高度', `y=${a.y} top=${p.y}`)
  ok(a.x > p.x && a.x < p.x + p.w, '落在台面横向范围内', `x=${a.x.toFixed(1)}`)
  for (let i = 0; i < 40; i++) step(w, [emptyInput(), emptyInput()])
  ok(a.onGround === true && Math.abs(a.y - p.y) < 0.001, '站得住（不飘在空中）', `y=${a.y.toFixed(1)}`)
}

/* ---------- 35. 顿帧期间按下的输入仍被记住 ---------- */
console.log('\n35) 顿帧期间按跳仍被记账')
{
  const w = createWorld(li, aoi, stage.id)
  const a = w.fighters[0]
  a.hitlag = C.HITLAG_FRAMES
  a.jumpBuffer = 0
  step(w, [{ ...emptyInput(), jumpPressed: true }, emptyInput()])
  ok(a.jumpBuffer > 0, '顿帧里按跳写入了缓冲', `jumpBuffer=${a.jumpBuffer}`)
}

/* ---------- 36. 手感：缓冲补发与硬直上限 ---------- */
console.log('\n36) 手感常量与缓冲补发')
{
  ok(C.ATTACK_BUFFER_FRAMES === 5, '攻击缓冲 5 帧', `${C.ATTACK_BUFFER_FRAMES}`)
  ok(C.LAND_LAG_MAX === 4, '落地硬直上限 4 帧', `${C.LAND_LAG_MAX}`)
  ok(C.AIR_ACCEL === 0.42, '空中加速 0.42', `${C.AIR_ACCEL}`)

  const w = createWorld(li, aoi, stage.id)
  const a = w.fighters[0]
  const b = w.fighters[1]
  b.x = a.x + 240
  a.landLag = 3
  step(w, [{ ...emptyInput(), attack: true }, emptyInput()])
  let fired = false
  for (let i = 0; i < 8; i++) {
    step(w, [emptyInput(), emptyInput()])
    if (a.attackFrame >= 0) {
      fired = true
      break
    }
  }
  ok(fired, '落地硬直里按攻击会在恢复后补发', `attackFrame=${a.attackFrame}`)
}

console.log('')
if (fails.length) {
  console.error(`失败 ${fails.length} 项: ${fails.join(', ')}`)
  process.exit(1)
}
console.log('战斗链路验证全部通过')
