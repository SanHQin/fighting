/**
 * 战斗场景背景
 *
 * 这里是渲染层（不是模拟层），所以 Math.sin / hash 都可以用 —— 只要不写回 FighterState。
 *
 * 设计原则（顺序即优先级）：
 *
 * 1. **背景永远不许抢角色。** 所有层的亮度都压在 `--bg-2` 附近，靠"剪影+一点光"造纵深，
 *    不靠"画得亮"。角色是纯色块 + 3px 深描边，只要背景保持低亮度低饱和，角色自然浮起来。
 * 2. **越远越亮、越近越暗。** 大气透视的反向用法：远处是雾（亮、低饱和），近处是逆光剪影（暗、纯黑）。
 *    这样即使所有层都是暗的，眼睛仍能读出前后关系。
 * 3. **平台高度附近要留一条"空带"。** 战斗发生在地面上下 200px 内，这一段背景必须是整屏最干净的地方，
 *    否则角色脚底的判定和落地时机看不清。所以 haze 带压在平台下方而不是上方。
 * 4. **每张图的母题只做一件事。** 残灯台=一排灯笼，齿轮工坊=转动的齿轮，灰烬原=地平线上的火，
 *    天穹回廊=云层与浮岛。不叠第三种元素 —— 三种元素会变成噪点。
 *
 * 视差用四个系数：0.06 / 0.14 / 0.26 / 0.44。数值刻意不成整数比，
 * 这样角色左右跑动时各层不会同步到一个节奏上，纵深感才成立。
 */

import type { StageDef } from '@/types'

export interface BackdropCam {
  x: number
  y: number
  zoom: number
  /** 地面（世界 y=0）在当前相机下的屏幕 y */
  groundY: number
}

const W = 1280
const H = 720

/** 稳定的伪随机：同一下标永远给同一个数，背景每帧不会抖 */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** 把十六进制色按比例混向黑色/白色，用来从 accent 派生出各层颜色 */
function shade(hex: string, mix: number, target: 'black' | 'white' = 'black'): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const gg = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  const t = target === 'black' ? 0 : 255
  const m = (v: number): number => Math.round(v + (t - v) * mix)
  return `rgb(${m(r)},${m(gg)},${m(b)})`
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const gg = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r},${gg},${b},${alpha})`
}

type Motif = 'lantern' | 'gear' | 'ember' | 'sky'

const MOTIF_OF: Record<string, Motif> = {
  dying_beacon: 'lantern',
  gearworks: 'gear',
  ember_field: 'ember',
  sky_bridge: 'sky',
}

/* ============================================================
 * 通用层
 * ============================================================ */

function drawSky(g: CanvasRenderingContext2D, stage: StageDef, py: number): void {
  const grad = g.createLinearGradient(0, py - 60, 0, H)
  grad.addColorStop(0, stage.bgTop)
  grad.addColorStop(0.55, stage.bgBottom)
  grad.addColorStop(1, shade(stage.bgBottom, 0.35))
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)

  // 天顶压暗：给上方一个"盖"，否则整屏偏亮、角色不吃香
  const cap = g.createLinearGradient(0, 0, 0, 260)
  cap.addColorStop(0, 'rgba(2,3,6,0.72)')
  cap.addColorStop(1, 'rgba(2,3,6,0)')
  g.fillStyle = cap
  g.fillRect(0, 0, W, 260)
}

/** 地平线附近的雾带：远景与中景之间的空气 */
function drawHaze(g: CanvasRenderingContext2D, stage: StageDef, gy: number): void {
  const y = gy
  const band = g.createLinearGradient(0, y - 220, 0, y + 120)
  band.addColorStop(0, rgba(stage.accent, 0))
  band.addColorStop(0.62, rgba(stage.accent, 0.10))
  band.addColorStop(1, rgba(stage.accent, 0))
  g.fillStyle = band
  g.fillRect(0, y - 220, W, 340)
}

/**
 * 平台下方的地面暗部。
 * 作用不只是"画个地"——它把画面下半部压成纯黑，角色落地时的脚底轮廓才清楚。
 */
function drawGroundShade(g: CanvasRenderingContext2D, gy: number): void {
  const y = gy
  const grad = g.createLinearGradient(0, y, 0, H + 160)
  grad.addColorStop(0, 'rgba(2,3,6,0.10)')
  grad.addColorStop(0.45, 'rgba(2,3,6,0.62)')
  grad.addColorStop(1, 'rgba(2,3,6,0.94)')
  g.fillStyle = grad
  g.fillRect(0, y, W, H - y + 200)
}

/** 暗角：把注意力收到画面中心，也让 HUD 压在暗角上更清楚 */
function drawVignette(g: CanvasRenderingContext2D, gy: number): void {
  const v = g.createRadialGradient(W / 2, gy - 40, 180, W / 2, gy - 40, 820)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(0.62, 'rgba(0,0,0,0.18)')
  v.addColorStop(1, 'rgba(0,0,0,0.66)')
  g.fillStyle = v
  g.fillRect(0, 0, W, H)
}

/**
 * 横向重复铺一层的通用工具。
 * 传入的 `draw` 自己拿到 x 与下标去画；这里只负责算每个元素该落在哪。
 * 用取模而非真循环很远 —— 背景只需覆盖视口，铺超出 200px 就够。
 */
function tile(
  px: number,
  step: number,
  count: number,
  draw: (x: number, i: number) => void,
): void {
  const span = step * count
  const base = ((px % span) + span) % span
  for (let i = -1; i <= count + 1; i++) {
    draw(base - span + i * step, ((i % count) + count) % count)
  }
}

/* ============================================================
 * 母题：残灯台 —— 一排灯笼
 * ============================================================ */

function drawLanternStage(g: CanvasRenderingContext2D, stage: StageDef, px: number, gy: number, frame: number): void {
  /* 远景的地面线要"跟着自己的高度走"：同一段垂直位移，远的层位移少、近的层位移多。
   * 用 gy 按比例内插到画面中心，就得到这一层的地面线 —— 直接给 gy 会让远近层同速，
   * 相机一上下跳，整幅画就变成一块硬纸板。 */
  const farBase = 400 + (gy - 400) * 0.55

  // 远：塔与屋檐剪影
  const farC = shade(stage.accent, 0.72)
  g.fillStyle = farC
  tile(px * 0.06, 150, 9, (x, i) => {
    const h = 150 + hash(i) * 120
    const w = 62 + hash(i + 40) * 46
    g.fillRect(x, farBase - h, w, h)
    // 斜屋檐
    g.beginPath()
    g.moveTo(x - 12, farBase - h)
    g.lineTo(x + w / 2, farBase - h - 26)
    g.lineTo(x + w + 12, farBase - h)
    g.closePath()
    g.fill()
  })

  // 中：悬灯。每盏灯一个暖色光晕，亮度随 frame 缓慢呼吸
  tile(px * 0.14, 132, 10, (x, i) => {
    const top = 74 + hash(i + 7) * 120
    const drop = 46 + hash(i + 13) * 70
    const cx = x + 46
    const cy = top + drop
    const sway = Math.sin((frame + i * 40) * 0.012) * 3

    // 吊绳
    g.strokeStyle = 'rgba(0,0,0,0.55)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(cx, top)
    g.lineTo(cx + sway, cy - 12)
    g.stroke()

    // 光晕
    const r = 46 + hash(i + 21) * 26
    const glow = g.createRadialGradient(cx + sway, cy, 2, cx + sway, cy, r)
    const breathe = 0.16 + 0.06 * Math.sin((frame + i * 90) * 0.02)
    glow.addColorStop(0, rgba(stage.accent, breathe + 0.16))
    glow.addColorStop(1, rgba(stage.accent, 0))
    g.fillStyle = glow
    g.beginPath()
    g.arc(cx + sway, cy, r, 0, Math.PI * 2)
    g.fill()

    // 灯体：上宽下窄的梯形，赛璐璐两阶明暗
    const bw = 15
    const bh = 22
    g.fillStyle = rgba(stage.accent, 0.92)
    g.beginPath()
    g.moveTo(cx + sway - bw, cy - bh / 2)
    g.lineTo(cx + sway + bw, cy - bh / 2)
    g.lineTo(cx + sway + bw * 0.72, cy + bh / 2)
    g.lineTo(cx + sway - bw * 0.72, cy + bh / 2)
    g.closePath()
    g.fill()
    g.fillStyle = 'rgba(255,255,255,0.22)'
    g.fillRect(cx + sway - bw * 0.5, cy - bh / 2 + 3, bw, 5)
  })

  // 近：两根灯柱，卡在画面左右边缘，给构图一个框
  const postC = 'rgba(4,5,8,0.88)'
  for (const side of [0, 1]) {
    const x = side === 0 ? 54 : W - 54
    g.fillStyle = postC
    g.fillRect(x - 9, gy - 300, 18, 300)
    // 柱头灯
    const cy = gy - 312
    const glow = g.createRadialGradient(x, cy, 2, x, cy, 78)
    glow.addColorStop(0, rgba(stage.accent, 0.30))
    glow.addColorStop(1, rgba(stage.accent, 0))
    g.fillStyle = glow
    g.beginPath()
    g.arc(x, cy, 78, 0, Math.PI * 2)
    g.fill()
  }
}

/* ============================================================
 * 母题：齿轮工坊 —— 转动的齿轮
 * ============================================================ */

function gearPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, teeth: number, rot: number): void {
  const inner = r * 0.78
  const tooth = (Math.PI * 2) / teeth
  g.beginPath()
  for (let i = 0; i < teeth; i++) {
    const a0 = rot + i * tooth
    const a1 = a0 + tooth * 0.34
    const a2 = a0 + tooth * 0.66
    const a3 = a0 + tooth
    g.lineTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner)
    g.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r)
    g.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r)
    g.lineTo(cx + Math.cos(a3) * inner, cy + Math.sin(a3) * inner)
  }
  g.closePath()
}

function drawGearStage(g: CanvasRenderingContext2D, stage: StageDef, px: number, py: number, gy: number, frame: number): void {
  // 远：厂房与烟囱
  g.fillStyle = shade(stage.accent, 0.78)
  tile(px * 0.06, 168, 8, (x, i) => {
    const h = 110 + hash(i + 3) * 90
    g.fillRect(x, gy - h, 96, h)
    if (hash(i + 11) > 0.45) {
      const cw = 16
      const ch = 60 + hash(i + 17) * 70
      g.fillRect(x + 26, gy - h - ch, cw, ch)
    }
  })

  // 中：三只大齿轮，各自转速与方向不同（同一速度会像贴图在整体滚动）
  const gears = [
    { x: 300, y: 210, r: 132, teeth: 18, dir: 1, speed: 0.0042 },
    { x: 700, y: 150, r: 96, teeth: 14, dir: -1, speed: 0.0061 },
    { x: 1030, y: 250, r: 168, teeth: 22, dir: 1, speed: 0.0031 },
  ]
  for (const gr of gears) {
    const cx = gr.x - px * 0.14 * 3
    const cy = gr.y + py
    const rot = frame * gr.speed * gr.dir
    g.fillStyle = shade(stage.accent, 0.62)
    gearPath(g, cx, cy, gr.r, gr.teeth, rot)
    g.fill()
    // 轮辐挖空：靠背景色挖，比画黑色更稳（背景是渐变的）
    g.save()
    g.globalCompositeOperation = 'destination-out'
    gearPath(g, cx, cy, gr.r * 0.36, 8, -rot * 1.3)
    g.fill()
    g.restore()
    // 轴心
    g.fillStyle = shade(stage.accent, 0.5)
    g.beginPath()
    g.arc(cx, cy, gr.r * 0.14, 0, Math.PI * 2)
    g.fill()
  }

  // 近：底部管道
  g.fillStyle = 'rgba(4,5,8,0.9)'
  for (let i = 0; i < 4; i++) {
    const y = gy - 26 + i * 9
    g.fillRect(-40, y, W + 80, 5)
  }
}

/* ============================================================
 * 母题：灰烬原 —— 地平线上的火
 * ============================================================ */

function drawEmberStage(g: CanvasRenderingContext2D, stage: StageDef, px: number, gy: number, frame: number): void {
  // 远山用更小的垂直视差（同 drawLanternStage 的理由）
  const farBase = 400 + (gy - 400) * 0.5

  // 远：火山锥
  g.fillStyle = shade(stage.accent, 0.76)
  tile(px * 0.06, 300, 5, (x, i) => {
    const h = 170 + hash(i + 2) * 130
    const w = 220 + hash(i + 9) * 120
    g.beginPath()
    g.moveTo(x, farBase)
    g.lineTo(x + w / 2, farBase - h)
    g.lineTo(x + w, farBase)
    g.closePath()
    g.fill()
    // 火山口的火：一条竖向亮痕，亮度呼吸
    if (hash(i + 5) > 0.4) {
      const a = 0.22 + 0.10 * Math.sin((frame + i * 120) * 0.03)
      g.fillStyle = rgba(stage.accent, a)
      g.beginPath()
      g.moveTo(x + w / 2 - 7, farBase - h)
      g.lineTo(x + w / 2 + 7, farBase - h)
      g.lineTo(x + w / 2 + 2, farBase - h + 34)
      g.lineTo(x + w / 2 - 2, farBase - h + 34)
      g.closePath()
      g.fill()
      g.fillStyle = shade(stage.accent, 0.76)
    }
  })

  // 中：地平线熔岩光带
  const y = gy
  const band = g.createLinearGradient(0, y - 90, 0, y + 10)
  band.addColorStop(0, rgba(stage.accent, 0))
  band.addColorStop(0.75, rgba(stage.accent, 0.26))
  band.addColorStop(1, rgba(stage.accent, 0.5))
  g.fillStyle = band
  g.fillRect(0, y - 90, W, 100)

  // 近：上升的火星
  for (let i = 0; i < 34; i++) {
    const seed = hash(i * 3.7)
    const speed = 0.28 + hash(i + 50) * 0.5
    const life = 900
    const t = ((frame * speed + seed * life) % life) / life
    const cx = ((seed * 1700 + px * 0.26) % (W + 160)) - 80
    const cy = gy - t * 420
    const r = 1.1 + hash(i + 70) * 1.9
    const a = (1 - t) * 0.55
    g.fillStyle = `rgba(255,190,110,${a})`
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.fill()
  }
}

/* ============================================================
 * 母题：天穹回廊 —— 云层与浮岛
 * ============================================================ */

function drawSkyStage(g: CanvasRenderingContext2D, stage: StageDef, px: number, py: number, gy: number, frame: number): void {
  // 远：星与月
  for (let i = 0; i < 70; i++) {
    const sx = hash(i * 2.1) * W
    const sy = hash(i * 5.3) * 380
    const tw = 0.4 + 0.6 * Math.abs(Math.sin((frame + i * 30) * 0.01))
    g.fillStyle = `rgba(220,235,255,${0.10 + tw * 0.22})`
    g.fillRect(sx, sy, 1.6, 1.6)
  }
  const mx = 1010 - px * 0.03
  const my = 128 + py
  const moon = g.createRadialGradient(mx, my, 6, mx, my, 120)
  moon.addColorStop(0, 'rgba(226,238,255,0.55)')
  moon.addColorStop(0.35, 'rgba(200,220,250,0.14)')
  moon.addColorStop(1, 'rgba(200,220,250,0)')
  g.fillStyle = moon
  g.beginPath()
  g.arc(mx, my, 120, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(232,242,255,0.72)'
  g.beginPath()
  g.arc(mx, my, 26, 0, Math.PI * 2)
  g.fill()

  // 中：云带。三层不同速度、不同透明度，形成"云在飘"而不是"贴图在动"
  const clouds = [
    { y: 250, speed: 0.14, alpha: 0.10, r: 130 },
    { y: 360, speed: 0.22, alpha: 0.13, r: 170 },
    { y: 470, speed: 0.32, alpha: 0.09, r: 210 },
  ]
  for (const c of clouds) {
    g.fillStyle = `rgba(198,220,245,${c.alpha})`
    tile(px * c.speed - frame * 0.06, 210, 8, (x, i) => {
      const cy = c.y + py + hash(i + c.y) * 26
      g.beginPath()
      g.ellipse(x + 60, cy, c.r * (0.7 + hash(i) * 0.5), c.r * 0.26, 0, 0, Math.PI * 2)
      g.fill()
    })
  }

  // 近：远处浮岛剪影（下缘垂挂碎片）
  g.fillStyle = shade(stage.accent, 0.8)
  tile(px * 0.26, 420, 4, (x, i) => {
    const w = 120 + hash(i + 4) * 90
    const y = 300 + hash(i + 8) * 120 + py
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + w, y)
    g.lineTo(x + w * 0.7, y + 34 + hash(i + 12) * 24)
    g.lineTo(x + w * 0.34, y + 30 + hash(i + 16) * 30)
    g.closePath()
    g.fill()
  })

  // 光柱：从上方斜射下来，压低透明度当体积光
  g.save()
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 3; i++) {
    const cx = 260 + i * 340 - px * 0.1
    const bottom = gy + 60
    const beam = g.createLinearGradient(cx, 0, cx + 120, bottom)
    beam.addColorStop(0, rgba(stage.accent, 0.10))
    beam.addColorStop(1, rgba(stage.accent, 0))
    g.fillStyle = beam
    g.beginPath()
    g.moveTo(cx, 0)
    g.lineTo(cx + 78, 0)
    g.lineTo(cx + 240, bottom)
    g.lineTo(cx + 40, bottom)
    g.closePath()
    g.fill()
  }
  g.restore()
}

/* ============================================================
 * 平台配色
 *
 * 平台的颜色必须跟着场地母题走，否则会出现"残灯台的木台"长在"齿轮工坊"的钢板上。
 * 但也不能每张图各写一套 —— 所以只区分四组材质，组内共用同一套数值，
 * 唯一跟着场地变的是顶面那道亮线（用 accent）。
 * ============================================================ */

export interface PlatPalette {
  solidTop: string
  solidMid: string
  solidBot: string
  passFill: string
  passCap: string
}

const PLAT_PALETTE: Record<Motif, PlatPalette> = {
  // 残灯台：旧木头 + 石基
  lantern: {
    solidTop: '#3d2f1e',
    solidMid: '#241a12',
    solidBot: '#120d0a',
    passFill: 'rgba(20,16,12,0.90)',
    passCap: 'rgba(255,240,200,0.72)',
  },
  // 齿轮工坊：冷灰钢板
  gear: {
    solidTop: '#2f3946',
    solidMid: '#1b222c',
    solidBot: '#0c1015',
    passFill: 'rgba(18,24,32,0.92)',
    passCap: 'rgba(198,222,255,0.66)',
  },
  // 灰烬原：烧焦的岩层，顶面还带一点余温
  ember: {
    solidTop: '#31241d',
    solidMid: '#1d1512',
    solidBot: '#0e0a08',
    passFill: 'rgba(24,16,12,0.90)',
    passCap: 'rgba(255,196,140,0.70)',
  },
  // 天穹回廊：风化的浅色石桥
  sky: {
    solidTop: '#33465a',
    solidMid: '#1e2a38',
    solidBot: '#0d1319',
    passFill: 'rgba(22,30,40,0.90)',
    passCap: 'rgba(214,232,255,0.72)',
  },
}

export function platPalette(stage: StageDef): PlatPalette {
  return PLAT_PALETTE[MOTIF_OF[stage.id] ?? 'lantern']
}

/* ============================================================
 * 入口
 * ============================================================ */

export function drawStageBackdrop(
  g: CanvasRenderingContext2D,
  stage: StageDef,
  cam: BackdropCam,
  frame: number,
): void {
  /* 相机越远（zoom 越小）远景越"退"，用一个轻微的缩放叠加制造推拉感。
   * 缩放中心放在地面线上，这样地面的屏幕位置在缩放时纹丝不动 ——
   * 否则平台和背景之间会出现一条随时间呼吸的缝。 */
  const pull = 1 + (1 - cam.zoom) * 0.06
  const gy = cam.groundY

  const px = -cam.x
  const py = -cam.y * 0.55

  g.save()
  g.translate(W / 2, gy)
  g.scale(pull, pull)
  g.translate(-W / 2, -gy)

  drawSky(g, stage, py)

  const motif = MOTIF_OF[stage.id] ?? 'lantern'
  switch (motif) {
    case 'gear':
      drawGearStage(g, stage, px, py, gy, frame)
      break
    case 'ember':
      drawEmberStage(g, stage, px, gy, frame)
      break
    case 'sky':
      drawSkyStage(g, stage, px, py, gy, frame)
      break
    default:
      drawLanternStage(g, stage, px, gy, frame)
      break
  }
  g.restore()

  // 雾带与地面暗部铺满整屏，不参与缩放
  drawHaze(g, stage, gy)
  drawGroundShade(g, gy)

  // 暗角永远贴着屏幕（含 HUD 区域）
  drawVignette(g, gy)
}






