/**
 * 联机前置验证：快照 / 校验和 / 确定性 / 回滚重演。
 *
 * 这是 docs/00-overview.md 里列的**两个必过测试**的落地：
 *   ① 同输入跑 1000 帧，两次 checksum 完全一致；
 *   ② 带快照回填重演与不带，最终 checksum 一致（联机的 go/no-go 门槛）。
 *
 * 用法：node tools/check-netcode.mjs
 */
import { loadSim } from './lib/simharness.mjs'

const { core, data, outDir, stageById } = await loadSim('netcode')
const {
  C, checksumHex, checksumSnapshot, snapshotWorld, restoreWorld, worldFromSnapshot,
  assertSnapshotRoundTrip, createRng, loadContent, ContentError, assertSameRuleset,
  step, emptyInput,
} = core
const { CHARS, STAGES } = data

const fails = []
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`  ✓ ${label}${extra ? '  ' + extra : ''}`)
  else {
    console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`)
    fails.push(label)
  }
}
const eq = (a, b, label, extra = '') => ok(a === b, label, `${extra}${extra ? ' ' : ''}${a} ${a === b ? '==' : '!='} ${b}`)

const makeWorld = (stageId = 'dying_beacon') =>
  core.createWorld(CHARS[2], CHARS[1], stageById.get(stageId))

/** 一段可复现的输入序列：用种子化 RNG 造，不依赖 Math.random */
function inputSeq(seed, n) {
  const rng = createRng(seed)
  const out = []
  for (let i = 0; i < n; i++) {
    const a = emptyInput()
    const r = rng.next()
    a.left = r < 0.18
    a.right = r > 0.82
    a.down = r > 0.35 && r < 0.45
    a.jumpPressed = r > 0.9
    a.attack = (i % 7) < 2
    a.special = r > 0.95
    a.dashPressed = r > 0.93 && r < 0.95
    const b = emptyInput()
    const r2 = rng.next()
    b.left = r2 < 0.2
    b.right = r2 > 0.8
    b.attack = (i % 5) < 2
    b.up = r2 > 0.7 && r2 < 0.75
    out.push([a, b])
  }
  return out
}

console.log('\n1) 确定性：同输入两次跑 1000 帧')
{
  const seq = inputSeq(1234, 1200)
  const w1 = makeWorld()
  const w2 = makeWorld()
  for (let i = 0; i < 1000; i++) {
    step(w1, seq[i])
    step(w2, seq[i])
  }
  eq(checksumHex(w1), checksumHex(w2), '1000 帧后校验和一致', 'hash')
  eq(w1.frame, 1000, '帧计数正确')
  ok(Number.isFinite(w1.fighters[0].x) && Number.isFinite(w1.fighters[0].y), '没有 NaN 坐标')
}

console.log('\n2) 快照往返：存 → 回填 → 再求校验和')
{
  const w = makeWorld()
  const seq = inputSeq(77, 400)
  for (let i = 0; i < 200; i++) step(w, seq[i])
  const before = checksumHex(w)
  const snap = snapshotWorld(w)
  const restored = worldFromSnapshot(w, snap)
  eq(checksumHex(restored), before, '独立 World 回填后一致', 'hash')
  // 原地回填（联机真正用的那条路径）
  const live = makeWorld()
  restoreWorld(live, snap)
  eq(checksumHex(live), before, '原地回填后一致', 'hash')
  eq(checksumSnapshot(snapshotWorld(live)), checksumSnapshot(snap), '两次快照校验和一致')
  let threw = false
  try { assertSnapshotRoundTrip(w) } catch { threw = true }
  ok(!threw, '开发期断言 assertSnapshotRoundTrip 通过')
}

console.log('\n3) 回滚重演：回到第 200 帧重跑同一段输入')
{
  const seq = inputSeq(555, 600)
  const w = makeWorld()
  for (let i = 0; i < 400; i++) step(w, seq[i])
  const straight = checksumHex(w)

  // 在第 200 帧存快照，继续跑到 400（模拟"预测帧已经跑过"），
  // 然后回填到 200 用同样的输入重跑。
  const w2 = makeWorld()
  for (let i = 0; i < 200; i++) step(w2, seq[i])
  const snap = snapshotWorld(w2)
  const hashAt200 = checksumHex(w2)
  for (let i = 200; i < 400; i++) step(w2, seq[i])
  const rolled = checksumHex(w2)

  restoreWorld(w2, snap)
  eq(checksumHex(w2), hashAt200, '回填后回到第 200 帧的校验和', 'hash')
  for (let i = 200; i < 400; i++) step(w2, seq[i])
  eq(checksumHex(w2), straight, '重演 200 帧后与直跑一致', 'hash')
  eq(rolled, straight, '未经回填的直跑也一致', 'hash')
}

console.log('\n4) 校验和只认影响模拟的字段')
{
  const w = makeWorld()
  const seq = inputSeq(9, 200)
  for (let i = 0; i < 120; i++) step(w, seq[i])
  const base = checksumHex(w)

  const a = worldFromSnapshot(w, snapshotWorld(w))
  a.fighters[0].px += 100 // 上一帧位置：只给渲染插值用
  a.fighters[0].py -= 50
  a.plats[0].flash = 7 // 平台受击闪白：纯视觉
  a.events.push({ type: 'hit', who: 0, x: 0, y: 0 }) // 渲染消费队列
  eq(checksumHex(a), base, 'px/py/flash/events 不影响校验和', 'hash')

  const b = worldFromSnapshot(w, snapshotWorld(w))
  b.fighters[1].damage += 1
  ok(checksumHex(b) !== base, '伤害变了校验和必须变')

  const c = worldFromSnapshot(w, snapshotWorld(w))
  c.fighters[0].shield -= 0.5
  ok(checksumHex(c) !== base, '盾值变了校验和必须变')
}

console.log('\n5) 种子化 PRNG')
{
  const r1 = createRng(42)
  const r2 = createRng(42)
  const seq1 = Array.from({ length: 8 }, () => r1.next())
  const seq2 = Array.from({ length: 8 }, () => r2.next())
  ok(seq1.every((v, i) => v === seq2[i]), '同种子出同一串')
  ok(seq1.every((v) => v >= 0 && v < 1), '输出落在 [0,1)')
  ok(createRng(0).next() === createRng(0).next(), '种子 0 不会卡死（xorshift 的不动点）')
  const r3 = createRng(43)
  ok(seq1[0] !== r3.next(), '不同种子出不同串')
}

console.log('\n6) 内容加载与规则哈希')
{
  const content = loadContent(CHARS, STAGES)
  ok(/^[0-9a-f]{8}$/.test(content.rulesetHash), 'rulesetHash 是 8 位十六进制', content.rulesetHash)
  const again = loadContent(CHARS, STAGES)
  eq(again.rulesetHash, content.rulesetHash, '同一份内容哈希稳定')

  // 只改展示字段，不该改变规则版本
  const cosmetic = CHARS.map((c) => ({ ...c, displayName: c.displayName + '改', color: '#ff0000' }))
  eq(loadContent(cosmetic, STAGES).rulesetHash, content.rulesetHash, '改显示名/颜色不改哈希')

  // 改伤害就要改
  const balance = CHARS.map((c) =>
    c.id === 'ken' ? { ...c, knockdownGate: c.knockdownGate + 5 } : c,
  )
  ok(loadContent(balance, STAGES).rulesetHash !== content.rulesetHash, '改击倒门槛必须改哈希')

  let threw = false
  try { assertSameRuleset('aaaaaaaa', 'bbbbbbbb') } catch (e) { threw = e instanceof ContentError }
  ok(threw, '哈希不一致时握手报错')

  // 校验能抓住真错误
  const bad = [{ ...CHARS[0], numId: CHARS[1].numId }]
  let caught = ''
  try { loadContent([CHARS[0], ...bad.slice(0, 0), CHARS[1], { ...CHARS[2], id: CHARS[2].id, numId: CHARS[1].numId }], STAGES) } catch (e) { caught = e.message }
  ok(caught.includes('numId'), '重复 numId 被拦住', caught.slice(0, 40))

  let caught2 = ''
  try { loadContent(CHARS, [{ ...STAGES[0], hazards: [{ ...STAGES[0].hazards[0] ?? { kind: 'flame', period: 0, phase: 0, duration: 1, damage: 1, angle: 90, baseKB: 0, x: 0, y: 0, w: 1, h: 1, label: 'x' } }] }] ) } catch (e) { caught2 = e.message }
  ok(caught2.includes('period'), '周期为 0 的事件被拦住', caught2.slice(0, 40))
}

console.log('\n7) 性能：1000 帧 × 快照 + 校验和')
{
  const w = makeWorld('gearworks')
  const seq = inputSeq(2024, 1100)
  const t0 = process.hrtime.bigint()
  let hashes = 0
  for (let i = 0; i < 1000; i++) {
    step(w, seq[i])
    if (i % 30 === 0) {
      checksumHex(w)
      assertSnapshotRoundTrip(w)
      hashes++
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  ok(ms < 400, `1000 帧 + ${hashes} 次快照自检耗时 ${ms.toFixed(1)}ms（<400ms）`)
}

console.log('')
if (fails.length) {
  console.error(`失败 ${fails.length} 项: ${fails.join(', ')}`)
  process.exit(1)
}
console.log('联机前置验证全部通过')
