#!/usr/bin/env node
/**
 * 相机断言
 *
 * 镜头是"看着对不对"最容易骗人的东西：静止时永远是对的，
 * 一跑起来才会出现"人出画了""场地被裁了""贴着边界还露虚空""高刷屏上镜头快一倍"。
 * 这些都能用数字验证，前提是相机是纯函数 —— 所以它在 game/cameraRig.ts 里。
 *
 * 取景模型（`cameraRig.ts` 头部有完整推导）：
 *
 *   blast 边缘 │  空白  │  战斗场地  │  空白  │ blast 边缘
 *
 * 两条硬约束：场地始终完整可见、视口不越出 blast。
 * 十组断言：
 *   1. 常量同步：身高/视口与 battle-core 的 C 一致（防两处漂移）
 *   2. 场地始终完整可见（四张真实场地 × 多种站位 × 长跑）
 *   3. 视口始终不越出 blast 边界
 *   4. 缩放始终落在 [边界铺满, 场地铺满] 推导出的区间内
 *   5. 空白占比：两人都在场地上时留白最小；有人出界后视口变宽
 *   6. 镜头中心落在两条约束的交集里（场地右边缘不出画 + 视口不出界）
 *   7. 帧率无关：60Hz 与 144Hz 跑同一段时间结果一致
 *   8. 平滑：单帧位移有上限，不会瞬移
 *   9. 死区：目标只有微小变化时相机不动
 *  10. 出界指示：四向与角落都能判出来，近距离不误报
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { loadSim } from './lib/simharness.mjs'

const root = path.resolve(import.meta.dirname, '..')
const srcDir = path.join(root, 'packages/client/src')
const { core, stageById } = await loadSim('camera-rig')
const outDir = path.join(root, '.tmp-camera')

function transpile(rel, rewrites = []) {
  const file = path.join(srcDir, rel)
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: false,
    },
    fileName: file,
  }).outputText
  let js = out
  for (const [from, to] of rewrites) js = js.split(`from '${from}'`).join(`from '${to}'`)
  const name = path.basename(rel).replace(/\.ts$/, '.mjs')
  writeFileSync(path.join(outDir, name), js, 'utf8')
  return name
}

let fails = 0
function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`)
  } else {
    console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`)
    fails++
  }
}

const STAGES = [...stageById.values()]

/** 造一个只带相机需要字段的世界 */
function mkWorld(stage, ax, ay, bx, by, opts = {}) {
  return {
    stage,
    fighters: [
      { x: ax, y: ay, vx: opts.avx ?? 0, vy: opts.avy ?? 0, crouching: false, respawnTimer: 0 },
      { x: bx, y: by, vx: opts.bvx ?? 0, vy: opts.bvy ?? 0, crouching: false, respawnTimer: 0 },
    ],
  }
}

/** 每种站位的采样点：场地内 / 贴边 / 场外 / 极远 / 一上一下 */
function placements(st) {
  const b = st.blastZone
  const sb = stageBoxLoose(st)
  const cx = sb.x + sb.w / 2
  return [
    [sb.x + 40, sb.y + sb.h, sb.x + sb.w - 40, sb.y + sb.h],
    [cx - 120, sb.y + sb.h, cx + 120, sb.y + sb.h],
    [cx, sb.y + sb.h, cx, sb.y + sb.h],
    [sb.x - 260, sb.y + sb.h, sb.x + 200, sb.y + sb.h],
    [sb.x + sb.w + 320, sb.y + sb.h, sb.x + sb.w - 300, sb.y + sb.h],
    [b.x + 40, sb.y + sb.h, b.x + b.w - 40, sb.y + sb.h],
    [b.x + 40, b.y + 60, b.x + b.w - 40, b.y + 60],
    [cx, b.y + 40, cx, b.y + b.h + 200],
  ]
}

function stageBoxLoose(st) {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const p of st.platforms) {
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x + p.w)
    y0 = Math.min(y0, p.y)
    y1 = Math.max(y1, p.y + p.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

async function main() {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  transpile('game/cameraRig.ts')

  const rig = await import(pathToFileURL(path.join(outDir, 'cameraRig.mjs')).href)
  const { C } = core
  const {
    CAM_DEFAULTS,
    camBounds,
    computeCameraTarget,
    createCam,
    offscreenOf,
    screenOf,
    stepCamera,
    viewportOf,
    zoomRangeOf,
  } = rig

  const { viewW, viewH } = CAM_DEFAULTS

  // ---- 1. 常量同步
  ok('crouchH 与 C.CROUCH_HEIGHT 一致', CAM_DEFAULTS.crouchH === C.CROUCH_HEIGHT, `${CAM_DEFAULTS.crouchH} vs ${C.CROUCH_HEIGHT}`)
  ok('视口为 1280 × 720', viewW === 1280 && viewH === 720)
  ok('standH 为 64（受击框标准身高）', CAM_DEFAULTS.standH === 64)

  // ---- 2. 场地始终完整可见
  {
    let bad = 0
    let worst = ''
    for (const st of STAGES) {
      const sb = stageBoxLoose(st)
      const corners = [
        [sb.x, sb.y],
        [sb.x + sb.w, sb.y],
        [sb.x, sb.y + sb.h],
        [sb.x + sb.w, sb.y + sb.h],
      ]
      for (const pl of placements(st)) {
        const cam = createCam()
        const w = mkWorld(st, ...pl)
        for (let i = 0; i < 120; i++) {
          stepCamera(cam, w, 1000 / 60)
          for (const [wx, wy] of corners) {
            const p = screenOf(cam, wx, wy)
            if (p.x < -1 || p.x > viewW + 1 || p.y < -1 || p.y > viewH + 1) {
              bad++
              if (!worst) worst = `${st.id} 角(${wx},${wy}) → 屏(${p.x.toFixed(0)},${p.y.toFixed(0)}) @zoom ${cam.zoom.toFixed(3)}`
            }
          }
        }
      }
    }
    ok('场地四角始终在画面内', bad === 0, bad ? `${bad} 次越界 · ${worst}` : '4 张场地 × 8 种站位 × 120 帧')
  }

  // ---- 3. 视口不越出 blast
  {
    let bad = 0
    let worst = ''
    for (const st of STAGES) {
      const b = st.blastZone
      for (const pl of placements(st)) {
        const cam = createCam()
        const w = mkWorld(st, ...pl)
        for (let i = 0; i < 120; i++) {
          stepCamera(cam, w, 1000 / 60)
          const v = viewportOf(cam)
          if (v.x < b.x - 1 || v.y < b.y - 1 || v.x + v.w > b.x + b.w + 1 || v.y + v.h > b.y + b.h + 1) {
            bad++
            if (!worst) worst = `${st.id} 视口(${v.x.toFixed(0)},${v.y.toFixed(0)},${v.w.toFixed(0)}×${v.h.toFixed(0)}) 边界(${b.x},${b.y},${b.w}×${b.h})`
          }
        }
      }
    }
    ok('视口不越出 blast 边界', bad === 0, bad ? `${bad} 次 · ${worst}` : '')
  }

  // ---- 4. 缩放在推导区间内
  {
    let bad = 0
    let detail = ''
    for (const st of STAGES) {
      const r = zoomRangeOf({ stage: st })
      for (const pl of placements(st)) {
        const cam = createCam()
        const w = mkWorld(st, ...pl)
        for (let i = 0; i < 120; i++) {
          stepCamera(cam, w, 1000 / 60)
          if (!Number.isFinite(cam.x) || !Number.isFinite(cam.zoom) || cam.zoom < r.min - 1e-6 || cam.zoom > r.max + 1e-6) {
            bad++
            if (!detail) detail = `${st.id} zoom ${cam.zoom.toFixed(4)} ∉ [${r.min.toFixed(4)}, ${r.max.toFixed(4)}]`
          }
        }
      }
    }
    ok('缩放始终在 [边界铺满, 场地铺满] 内', bad === 0, bad ? detail : '')
    const r = zoomRangeOf({ stage: STAGES[0] })
    ok('区间有正确含义（min<max）', r.min < r.max, `[${r.min.toFixed(3)}, ${r.max.toFixed(3)}] @ ${STAGES[0].id}`)
  }

  // ---- 5. 空白占比：都在场地上时留白最小，有人出界后视口变宽
  {
    const st = STAGES[0]
    const sb = stageBoxLoose(st)
    const cx = sb.x + sb.w / 2

    const camIn = createCam()
    const wIn = mkWorld(st, cx - 200, sb.y + sb.h, cx + 200, sb.y + sb.h)
    let vIn = null
    for (let i = 0; i < 180; i++) vIn = viewportOf((stepCamera(camIn, wIn, 1000 / 60), camIn))

    const camOut = createCam()
    const wOut = mkWorld(st, cx - 200, sb.y + sb.h, sb.x + sb.w + 300, sb.y + sb.h)
    let vOut = null
    for (let i = 0; i < 180; i++) vOut = viewportOf((stepCamera(camOut, wOut, 1000 / 60), camOut))

    const blankIn = vIn.w - sb.w
    const blankOut = vOut.w - sb.w
    ok('两人都在场地上 → 空白小', blankIn < 160, `视口 ${vIn.w.toFixed(0)} · 场地 ${sb.w} · 空白 ${blankIn.toFixed(0)}`)
    ok('有人出界 → 空白变大', blankOut > blankIn + 40, `场内空白 ${blankIn.toFixed(0)} → 场外 ${blankOut.toFixed(0)}`)
  }

  // ---- 6. camBounds 是两条约束的交集
  {
    const st = STAGES[0]
    const sb = stageBoxLoose(st)
    const b = st.blastZone
    let bad = 0
    const rng = zoomRangeOf({ stage: st })
    // 只在合法缩放区间内检查：区间外两条约束本身矛盾，要求它们同时成立是错的
    for (let k = 0; k <= 4; k++) {
      const z = rng.min + ((rng.max - rng.min) * k) / 4
      const r = camBounds({ stage: st }, z)
      const half = viewW / 2 / z
      const halfH = viewH / 2 / z
      // 场地四边都必须在画面内（取景框 ⊇ 场地）
      if (r.maxX < sb.x + sb.w - half - 1e-6) bad++
      if (r.minX > sb.x + half + 1e-6) bad++
      // 视口不能越过 blast
      if (r.minX < b.x + half - 1e-6) bad++
      if (r.maxX > b.x + b.w - half + 1e-6) bad++
      if (r.maxY < sb.y + sb.h - halfH - 1e-6) bad++
      if (r.minY > sb.y + halfH + 1e-6) bad++
      if (r.minY < b.y + halfH - 1e-6) bad++
      if (r.maxY > b.y + b.h - halfH + 1e-6) bad++
    }
    ok('可动范围 = 场地可见 ∩ 视口不出界', bad === 0, bad ? `${bad} 项不满足` : '')
    const target = computeCameraTarget(mkWorld(st, -2000, 0, 2000, 0))
    const r = camBounds({ stage: st }, target.zoom)
    ok('目标被夹在可动范围内', target.tx >= r.minX - 1e-6 && target.tx <= r.maxX + 1e-6)
  }

  // ---- 7. 帧率无关
  {
    const st = STAGES[0]
    const sb = stageBoxLoose(st)
    const run = (hz) => {
      const cam = createCam()
      const dt = 1000 / hz
      const frames = Math.round(1000 / dt)
      for (let i = 0; i < frames; i++) {
        const t = (i + 1) / frames
        const w = mkWorld(st, sb.x + 200 + t * 600, sb.y + sb.h, sb.x + sb.w - 200 + t * 600, sb.y + sb.h, { avx: 10, bvx: 10 })
        stepCamera(cam, w, dt)
      }
      return cam
    }
    const c60 = run(60)
    const c144 = run(144)
    const d = Math.hypot(c60.x - c144.x, c60.y - c144.y)
    ok('60Hz 与 144Hz 结果一致', d < 24, `差 ${d.toFixed(1)}px`)
  }

  // ---- 8. 平滑
  {
    const st = STAGES[0]
    const sb = stageBoxLoose(st)
    const cam = createCam()
    // 两人一起从左端瞬移到右端：这是相机单帧位移最坏的情况
    let maxStep = 0
    let prev = null
    for (let phase = 0; phase < 2; phase++) {
      const left = phase === 0
      const x0 = left ? st.blastZone.x + 60 : st.blastZone.x + st.blastZone.w - 60
      const w = mkWorld(st, x0, sb.y + sb.h, x0 + 200, sb.y + sb.h)
      for (let i = 0; i < 150; i++) {
        stepCamera(cam, w, 1000 / 60)
        if (prev) maxStep = Math.max(maxStep, Math.hypot(cam.x - prev.x, cam.y - prev.y))
        prev = { x: cam.x, y: cam.y }
      }
    }
    ok('单帧位移有上限（不瞬移）', maxStep < 220, `最大 ${maxStep.toFixed(1)}px/帧`)
  }

  // ---- 9. 死区
  {
    const st = STAGES[0]
    const sb = stageBoxLoose(st)
    const cx = sb.x + sb.w / 2
    const cam = createCam()
    const base = mkWorld(st, cx - 40, sb.y + sb.h, cx + 40, sb.y + sb.h)
    for (let i = 0; i < 120; i++) stepCamera(cam, base, 1000 / 60)
    const x0 = cam.x
    // 角色只移动 12px，远小于死区 44
    const nudged = mkWorld(st, cx - 34, sb.y + sb.h, cx + 46, sb.y + sb.h)
    for (let i = 0; i < 30; i++) stepCamera(cam, nudged, 1000 / 60)
    ok('死区内不追（无抖动）', Math.abs(cam.x - x0) < 0.5, `移动 ${Math.abs(cam.x - x0).toFixed(2)}px`)
  }

  // ---- 10. 出界指示（四向 + 角落）
  {
    const st = STAGES[0]
    const sb = stageBoxLoose(st)
    const b = st.blastZone
    const cx = sb.x + sb.w / 2

    // 左右两端各一人：都在 blast 内，但视野装不下
    const cam = createCam()
    const w = mkWorld(st, b.x + 40, sb.y + sb.h, b.x + b.w - 40, sb.y + sb.h)
    for (let i = 0; i < 200; i++) stepCamera(cam, w, 1000 / 60)
    const oa = offscreenOf(cam, w.fighters[0], 30)
    const ob = offscreenOf(cam, w.fighters[1], 30)
    ok('两端拉开时判出画', Boolean(oa || ob), `P1 ${oa ? 'OFF' : 'in'} · P2 ${ob ? 'OFF' : 'in'} · zoom ${cam.zoom.toFixed(2)}`)

    // 上方角落：一个人在高空场外
    const cam2 = createCam()
    const w2 = mkWorld(st, cx, b.y + 30, cx, sb.y + sb.h)
    for (let i = 0; i < 200; i++) stepCamera(cam2, w2, 1000 / 60)
    const up = offscreenOf(cam2, w2.fighters[0], 30)
    ok('上方出画能判出（竖直同样逻辑）', Boolean(up) && up.dirY < -0.2, up ? `dir(${up.dirX.toFixed(2)},${up.dirY.toFixed(2)}) edges ${up.edges}` : '未判出')

    // 近距离不误报
    const cam3 = createCam()
    const w3 = mkWorld(st, cx - 200, sb.y + sb.h, cx + 200, sb.y + sb.h)
    for (let i = 0; i < 150; i++) stepCamera(cam3, w3, 1000 / 60)
    ok('近距离不误报出画', !offscreenOf(cam3, w3.fighters[0], 30) && !offscreenOf(cam3, w3.fighters[1], 30))

    // 屏幕内的人一律返回 null（反向保证）
    const cam4 = createCam()
    const w4 = mkWorld(st, cx - 100, sb.y + sb.h, cx + 100, sb.y + sb.h)
    for (let i = 0; i < 150; i++) stepCamera(cam4, w4, 1000 / 60)
    ok('画面中央的人不判出画', !offscreenOf(cam4, { x: cx, y: sb.y + sb.h, vx: 0, vy: 0, crouching: false, respawnTimer: 0 }, 30))

  }

  console.log('\n11) 缩放不抖：打斗中的距离起伏不该让画面一张一缩')
  {
    const st = STAGES[0]
    const sb = stageBoxLoose(st)
    const cx = sb.x + sb.w / 2
    const warm = mkWorld(st, cx - 150, sb.y + sb.h, cx + 150, sb.y + sb.h)

    // (a) 小起伏（只差 +-10%）根本不该动缩放
    const camA = createCam()
    for (let i = 0; i < 60; i++) stepCamera(camA, warm, 1000 / 60)
    let travel = 0
    let prevA = camA.zoom
    for (let i = 0; i < 300; i++) {
      const spread = 300 + 30 * Math.sin((i * Math.PI) / 15)
      const w = mkWorld(st, cx - spread / 2, sb.y + sb.h, cx + spread / 2, sb.y + sb.h)
      stepCamera(camA, w, 1000 / 60)
      travel += Math.abs(camA.zoom - prevA)
      prevA = camA.zoom
    }
    ok('小起伏不缩放（累计行程 < 0.02）', travel < 0.02, `行程=${travel.toFixed(4)}`)

    // (b) 大起伏（+-100%）要跟得上，但不能每帧来回抽
    const camB = createCam()
    for (let i = 0; i < 60; i++) stepCamera(camB, warm, 1000 / 60)
    let reversals = 0
    let lastDir = 0
    let prevB = camB.zoom
    for (let i = 0; i < 600; i++) {
      const spread = 300 + 300 * ((1 - Math.cos((i * Math.PI * 2) / 120)) / 2)
      const w = mkWorld(st, cx - spread / 2, sb.y + sb.h, cx + spread / 2, sb.y + sb.h)
      stepCamera(camB, w, 1000 / 60)
      const dz = camB.zoom - prevB
      prevB = camB.zoom
      const dir = Math.abs(dz) < 0.0004 ? 0 : Math.sign(dz)
      if (dir !== 0 && lastDir !== 0 && dir !== lastDir) reversals++
      if (dir !== 0) lastDir = dir
    }
    ok('大起伏跟得上且不抽（600 帧反转 <= 14 次）', reversals <= 14, `反转=${reversals}`)
  }

  rmSync(outDir, { recursive: true, force: true })

  console.log('')
  if (fails === 0) console.log('相机断言全部通过')
  else {
    console.log(`有 ${fails} 项不通过`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
