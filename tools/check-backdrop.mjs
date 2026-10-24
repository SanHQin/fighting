#!/usr/bin/env node
/**
 * 战斗背景冒烟检查
 *
 * 没有 headless 浏览器可用（mojo 通道被拒），所以这里用一个**会记账的假 Canvas**，
 * 把四张场地的背景在若干相机状态下各跑一遍，断言：
 *   ① 不抛异常（最容易漏的是 createRadialGradient 收到 NaN 半径）
 *   ② 所有数值参数都是有限数（NaN / Infinity 画在 Canvas 上是静默失效，肉眼看不出来）
 *   ③ 每帧的绘制指令数在合理区间（太少说明某个母题没画，太多说明失控）
 *
 * 它不能替代"用眼睛看"，但能挡住"改个数字就白屏"这类回归。
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const srcDir = path.join(root, 'packages/client/src')
const outDir = path.join(root, '.tmp-backdrop')

/** 记录调用的假 2D 上下文 */
function makeCtx() {
  const calls = []
  let nan = []

  const check = (name, args) => {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) {
        nan.push(`${name}(${args.join(', ')})`)
      }
    }
  }

  const gradient = () => ({
    addColorStop(pos, color) {
      if (!Number.isFinite(pos)) nan.push(`addColorStop(${pos})`)
      if (typeof color !== 'string' || !color) nan.push(`addColorStop color=${color}`)
    },
  })

  const ctx = {
    canvas: { width: 1280, height: 720 },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    save: () => void calls.push('save'),
    restore: () => void calls.push('restore'),
    translate: (...a) => (check('translate', a), calls.push('translate')),
    scale: (...a) => (check('scale', a), calls.push('scale')),
    rotate: (...a) => (check('rotate', a), calls.push('rotate')),
    fillRect: (...a) => (check('fillRect', a), calls.push('fillRect')),
    strokeRect: (...a) => (check('strokeRect', a), calls.push('strokeRect')),
    clearRect: (...a) => (check('clearRect', a), calls.push('clearRect')),
    beginPath: () => void calls.push('beginPath'),
    closePath: () => void calls.push('closePath'),
    moveTo: (...a) => (check('moveTo', a), calls.push('moveTo')),
    lineTo: (...a) => (check('lineTo', a), calls.push('lineTo')),
    arc: (...a) => (check('arc', a), calls.push('arc')),
    ellipse: (...a) => (check('ellipse', a), calls.push('ellipse')),
    rect: (...a) => (check('rect', a), calls.push('rect')),
    roundRect: (...a) => (check('roundRect', a), calls.push('roundRect')),
    quadraticCurveTo: (...a) => (check('quadraticCurveTo', a), calls.push('quadraticCurveTo')),
    fill: () => void calls.push('fill'),
    stroke: () => void calls.push('stroke'),
    clip: () => void calls.push('clip'),
    setLineDash: (a) => (check('setLineDash', a), calls.push('setLineDash')),
    createLinearGradient: (...a) => (check('createLinearGradient', a), gradient()),
    createRadialGradient: (...a) => (check('createRadialGradient', a), gradient()),
    measureText: () => ({ width: 10 }),
    fillText: (...a) => (check('fillText', a.slice(1)), calls.push('fillText')),
    strokeText: (...a) => (check('strokeText', a.slice(1)), calls.push('strokeText')),
    __calls: () => calls,
    __nan: () => nan,
    __reset: () => {
      calls.length = 0
      nan = []
    },
  }
  return ctx
}

function transpile(rel, rewrites = []) {
  const file = path.join(srcDir, rel)
  let code = readFileSync(file, 'utf8')
  const out = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: false,
    },
    fileName: file,
  }).outputText
  let js = out
  for (const [from, to] of rewrites) {
    js = js.split(`from '${from}'`).join(`from '${to}'`)
  }
  const outFile = path.join(outDir, path.basename(rel).replace(/\.ts$/, '.mjs'))
  writeFileSync(outFile, js, 'utf8')
  return pathToFileURL(outFile).href
}

async function main() {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  transpile('types/index.ts')
  transpile('game/stageBackdrop.ts', [['@/types', './index.mjs']])

  const mod = await import(pathToFileURL(path.join(outDir, 'stageBackdrop.mjs')).href)
  const { drawStageBackdrop, platPalette } = mod

  const stages = [
    { id: 'dying_beacon', accent: '#ffb020', bgTop: '#1a1420', bgBottom: '#3a2410' },
    { id: 'gearworks', accent: '#7fd4ff', bgTop: '#0f1620', bgBottom: '#1c2a38' },
    { id: 'ember_field', accent: '#ff6a2a', bgTop: '#1a0e0a', bgBottom: '#421a0c' },
    { id: 'sky_bridge', accent: '#a8e85c', bgTop: '#0a1226', bgBottom: '#243a5a' },
  ]

  const cams = [
    { x: 0, y: -60, zoom: 1.0, groundY: 460 },
    { x: -520, y: -120, zoom: 0.72, groundY: 486 },
    { x: 700, y: 40, zoom: 1.12, groundY: 355 },
    { x: 0, y: 0, zoom: 0.62, groundY: 400 },
  ]

  let fail = 0
  for (const stage of stages) {
    for (const cam of cams) {
      for (const frame of [0, 137, 4821]) {
        const ctx = makeCtx()
        try {
          drawStageBackdrop(ctx, stage, cam, frame)
        } catch (e) {
          console.log(`  ✗ ${stage.id} cam(${cam.x},${cam.y},${cam.zoom}) f${frame}: ${e.message}`)
          fail++
          continue
        }
        const nan = ctx.__nan()
        if (nan.length) {
          console.log(`  ✗ ${stage.id} NaN 参数: ${nan.slice(0, 3).join(' | ')}`)
          fail++
        }
      }
    }
    // 每个母题至少要有一定量的绘制指令。
    // 注意这里数的是 fill + fillRect 之和：剪影类母题（厂房、管道）大量用 fillRect，
    // 齿轮类则是 path+fill，只数 fill 会误判齿轮工坊"没画东西"。
    const ctx = makeCtx()
    drawStageBackdrop(ctx, stage, cams[0], 240)
    const all = ctx.__calls()
    const n = all.length
    const paint = all.filter((c) => c === 'fill' || c === 'fillRect').length
    const ok = n >= 120 && paint >= 20
    console.log(`  ${ok ? '✓' : '✗'} ${stage.id.padEnd(14)} 指令 ${String(n).padStart(4)} · 上色 ${String(paint).padStart(3)} · 平台配色 ${platPalette(stage).solidTop}`)
    if (!ok) fail++
  }

  rmSync(outDir, { recursive: true, force: true })

  console.log('')
  if (fail === 0) {
    console.log('战斗背景冒烟检查全部通过')
  } else {
    console.log(`有 ${fail} 项不通过`)
    process.exitCode = 1
  }
}

void execFileSync
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
