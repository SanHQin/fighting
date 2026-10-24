/**
 * 无头冒烟测试：把 protoRuntime 的模拟循环在 Node 里跑起来，
 * 验证物理、AI、出界/复活、结算都不崩，并打印关键指标。
 *
 * 用法：node tools/smoke-sim.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSim, root } from './lib/simharness.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

const { core, data, outDir, stageById } = await loadSim('smoke')
const { step, SimpleAI, emptyInput, C } = core
const { CHARS, STAGES } = data

/** 内核只接收已解析的定义；按 id 查表在 harness 里做 */
const createWorld = (a, b, stageLike) =>
  core.createWorld(a, b, typeof stageLike === 'string' ? stageById.get(stageLike) : stageLike)

console.log('  角色数 =', CHARS.length, ' 场地数 =', STAGES.length)

for (const mode of ['idle', 'ai', 'random']) {
  const w = createWorld(CHARS[0], CHARS[1], STAGES[0].id)
  const ai0 = new SimpleAI(10)
  const ai1 = new SimpleAI(16)
  let seed = 12345
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const randomInput = () => ({
    left: rand() < 0.3,
    right: rand() < 0.3,
    up: rand() < 0.1,
    down: rand() < 0.1,
    jumpPressed: rand() < 0.05,
    attack: rand() < 0.1,
    special: rand() < 0.04,
    special2: rand() < 0.02,
  })

  let frames = 0
  const t0 = performance.now()
  while (!w.over && frames < 60 * 60 * 6) {
    let inputs
    if (mode === 'idle') inputs = [emptyInput(), emptyInput()]
    else if (mode === 'ai') inputs = [ai0.think(w.fighters[0], w.fighters[1]), ai1.think(w.fighters[1], w.fighters[0])]
    else inputs = [randomInput(), randomInput()]
    step(w, inputs)
    frames++
    for (const f of w.fighters) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.vx) || !Number.isFinite(f.vy)) {
        throw new Error(`[${mode}] 第 ${frames} 帧出现 NaN/Infinity: ${JSON.stringify(f)}`)
      }
    }
  }
  const ms = performance.now() - t0
  const [a, b] = w.fighters
  console.log(
    `\n模式 ${mode}: ${frames} 帧 (${(frames / 60).toFixed(1)}s 游戏内), 计算 ${ms.toFixed(1)}ms, ${((frames / ms) * 1000).toFixed(0)} 帧/秒`
  )
  console.log(`  P1 stocks=${a.stocks} damage=${a.damage.toFixed(1)}%, P2 stocks=${b.stocks} damage=${b.damage.toFixed(1)}%`)
  console.log(`  over=${w.over} winner=${w.winner} timeLeft=${w.timeLeft}`)
}

// 固定步长确定性：同输入两次结果必须一致
const run = (seed0) => {
  const w = createWorld(CHARS[0], CHARS[1], STAGES[0].id)
  let seed = seed0
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < 600; i++) {
    step(w, [
      { left: rand() < 0.3, right: rand() < 0.3, up: rand() < 0.1, down: rand() < 0.1, jumpPressed: rand() < 0.05, attack: rand() < 0.1, special: rand() < 0.04, special2: rand() < 0.02 },
      { left: rand() < 0.3, right: rand() < 0.3, up: rand() < 0.1, down: rand() < 0.1, jumpPressed: rand() < 0.05, attack: rand() < 0.1, special: rand() < 0.04, special2: rand() < 0.02 },
    ])
  }
  return w.fighters.map((f) => `${f.x.toFixed(6)},${f.y.toFixed(6)},${f.vx.toFixed(6)},${f.vy.toFixed(6)}`).join('|')
}
const r1 = run(999)
const r2 = run(999)
console.log('\n确定性（同种子同输入 600 帧）:', r1 === r2 ? 'PASS 完全一致' : 'FAIL 不一致')
if (r1 !== r2) {
  console.log('  r1 =', r1)
  console.log('  r2 =', r2)
}

fs.rmSync(outDir, { recursive: true, force: true })
