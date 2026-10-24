<script setup lang="ts">
/**
 * 战斗画面。阶段 1 用 Canvas 2D 直接画方块角色——
 * 真正接 PixiJS 与部件骨骼是 M4/M5 的事（见 docs/04-ui-art.md §8.2）。
 *
 * 循环结构严格按 docs/03-combat-system.md 第 3 章：
 *   累加器 → 固定 60Hz step → 渲染插值 → 一帧一次 step
 * 绝不用「可变 dt 直接积分」，那会让不同帧率的机器打出不同的物理。
 *
 * 相机（v0.7）：不是硬切，而是「快但有过渡」的跟随——
 * 用两人的包围盒反推缩放，保证两个人都留在画面里（大乱斗的做法），
 * 再加死区与距离自适应插值系数：追得近时慢（画面稳），追得远时快（不丢人）。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import DebugPanel from '@/components/DebugPanel.vue'
import WinOverlay from '@/components/WinOverlay.vue'
import type { DebugStats, FighterStat } from '@/components/DebugPanel.vue'
import { charById, stageById } from '@/mock/data'
import { useMatchStore } from '@/stores'
import {
  C,
  SPECIAL_FRAMES,
  SimpleAI,
  checksumHex,
  createWorld,
  emptyInput,
  hurtBox,
  isOffstage,
  moveOf,
  shieldCenter,
  shieldRadius,
  step,
  type InputState,
  type World,
} from '@fighting/battle-core'
import { KeyboardSource } from '@/game/keyboard'
import { drawStageBackdrop, platPalette } from '@/game/stageBackdrop'
import { createCam, offscreenOf, screenOf, stepCamera, viewportOf } from '@/game/cameraRig'
import { iconUrl, propUrl } from '@/game/portraits'
import { sprite } from '@/game/sprites'
import {
  ART_FIST,
  ART_FOOT,
  ART_LOWER,
  ART_UPPER,
  artOf,
  drawCrest,
  drawLimb,
  drawPart,
} from '@/game/charArt'

const props = defineProps<{ matchId: string }>()
const router = useRouter()
const match = useMatchStore()

const charA = charById(match.charIds[0])!
const charB = charById(match.charIds[1])!
const stage = stageById(match.stageId)!

/** HUD 头像：没有正式美术的角色回落成首字，不阻塞开局 */
const iconA = iconUrl(charA.id)
const iconB = iconUrl(charB.id)

/** 普通对象，绝不 reactive —— 60Hz 热路径 */
const world = shallowRef<World>(createWorld(charA, charB, stage))

const canvasRef = ref<HTMLCanvasElement | null>(null)
let raf = 0
let last = 0
let acc = 0
let ctx: CanvasRenderingContext2D | null = null

const keyboard = new KeyboardSource()
const ai = new SimpleAI(
  { easy: 24, normal: 16, hard: 10, master: 6 }[match.aiLevel] ?? 16,
)

/** HUD 用的响应式快照，每 6 帧更新一次，避免每帧触发 Vue 重渲染 */
const hud = ref({
  dmg: [0, 0] as [number, number],
  stocks: [C.STOCKS, C.STOCKS] as [number, number],
  shield: [C.SHIELD_MAX, C.SHIELD_MAX] as [number, number],
  /** P1 两个必杀的"已就绪百分比"0–100 */
  cd: [100, 100] as [number, number],
  /** P1 冲刺就绪百分比 0–100 */
  dash: 100,
  specialNames: ['技能一', '技能二'] as [string, string],
  lastMove: '准备战斗',
  time: 360,
})

const specialNames = [0, 1].map((slot) =>
  charA.specials.find((sp) => (sp.slot ?? 0) === slot && !sp.dir)?.name
    ?? charA.specials.find((sp) => (sp.slot ?? 0) === slot)?.name
    ?? `技能${slot + 1}`,
) as [string, string]

/** 调试面板开关，默认关闭，~ 键切换 */
const showDebug = ref(false)

const paused = ref(false)
/**
 * 对局结束标记。
 *
 * 坑：world 是 shallowRef，`computed(() => world.value.over)` 只会在 world.value
 * 这个引用被替换时才重算——而 step() 是原地改 world.over，computed 永远不会更新，
 * 结算浮层因此永远不出现（这就是"结束统计与反馈没了"的真正原因）。
 * 所以这里用一个独立 ref，在主循环里每 6 帧同步一次。
 */
const overFlag = ref(false)
const showResult = computed(() => overFlag.value)

/** 同样的道理：模板里读 world.frame 不会响应，单开一个 ref */
const frameNo = ref(0)

/** 对局结束时的统计快照，供结算浮层用 */
const overStats = computed(() => {
  // 显式依赖 frameNo，否则 world 原地改字段不会让计算属性失效
  void frameNo.value
  const w = world.value
  const m = (f: (typeof w.fighters)[0]) => ({
    name: f.char.displayName,
    color: f.char.color,
    charId: f.char.id,
    stocks: f.stocks,
    dealt: f.dealt,
    maxComboTaken: f.maxComboTaken,
    knockdowns: f.knockdowns,
    shield: f.shield,
  })
  return {
    p1: m(w.fighters[0]),
    p2: m(w.fighters[1]),
    // 计时只认 endFrame：结束后 frame 仍在为背景动画前进，读它会让用时一直涨
    elapsedSec: Math.max(0, w.endFrame >= 0 ? w.endFrame : w.frame) / 60,
    frame: w.endFrame >= 0 ? w.endFrame : w.frame,
    reason: w.timeLeft === 0 ? '时间耗尽' : '击飞出界',
  }
})

/* ---------- 性能采样 ---------- */
let frames = 0
let fpsAt = 0
let fpsValue = 60
let simMs = 0
let drawMs = 0
let frameMs = 0
let droppedSteps = 0

const debugStats = ref<DebugStats>({
  fps: 60,
  frameMs: 0,
  simMs: 0,
  drawMs: 0,
  dropped: 0,
  logicFrame: 0,
  canvasW: 1280,
  canvasH: 720,
  dpr: 1,
  scale: 1,
  viewW: 1280,
  viewH: 720,
  heapMB: null,
  camX: 0,
  camY: 0,
  camZoom: 1,
  projectiles: 0,
  checksum: '--------',
  fighters: [placeholderStat('P1'), placeholderStat('P2')],
})

function placeholderStat(name: string): FighterStat {
  return {
    name,
    color: '#888',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    state: 'idle',
    facing: 1,
    damage: 0,
    stocks: C.STOCKS,
    shield: C.SHIELD_MAX,
    shieldMax: C.SHIELD_MAX,
    combo: 0,
    maxComboTaken: 0,
    knockdowns: 0,
    hitstun: 0,
    hitlag: 0,
    invincible: 0,
    jumpsLeft: 2,
    onGround: true,
    attackDir: '—',
    attackFrame: -1,
    dealt: 0,
    dashCd: 0,
    dashTimer: 0,
    airDashes: 1,
    recoveryDashes: 1,
    onLedge: false,
    climbTimer: 0,
    moveName: '—',
  }
}

function toStat(f: World['fighters'][0], name: string): FighterStat {
  return {
    name,
    color: f.char.color,
    x: f.x,
    y: f.y,
    vx: f.vx,
    vy: f.vy,
    state: f.state,
    facing: f.facing,
    damage: f.damage,
    stocks: f.stocks,
    shield: f.shield,
    shieldMax: C.SHIELD_MAX,
    combo: f.combo,
    maxComboTaken: f.maxComboTaken,
    knockdowns: f.knockdowns,
    hitstun: f.hitstun,
    hitlag: f.hitlag,
    invincible: f.invincible,
    jumpsLeft: f.jumpsLeft,
    onGround: f.onGround,
    attackDir: f.attackDir,
    attackFrame: f.attackFrame,
    dealt: f.dealt,
    dashCd: f.dashCd,
    dashTimer: f.dashTimer,
    airDashes: f.airDashes,
    recoveryDashes: f.recoveryDashes,
    onLedge: f.ledge !== null,
    climbTimer: f.climbTimer,
    moveName: moveNameOf(f),
  }
}

/** 招式名：必杀显名字，普通招式显方向（冲刺攻击加前缀） */
function moveNameOf(f: World['fighters'][0]): string {
  if (f.attackFrame < 0) return '—'
  if (f.attackKind === 'special') return f.specialDef?.name ?? '必杀'
  const configuredName = f.char.moves?.[f.attackDir]?.name
  if (configuredName) return f.dashAttack ? `冲${configuredName}` : configuredName
  const dirLabel: Record<string, string> = {
    neutral: '站A',
    forward: '横A',
    back: '回身A',
    up: '上A',
    upForward: '斜上A',
    upBack: '回身上A',
    down: '下A',
    downForward: '斜下A',
    downBack: '回身下A',
  }
  const base = dirLabel[f.attackDir] ?? 'A'
  return f.dashAttack ? '冲' + base : base
}

const AI_DELAY = computed(
  () => ({ easy: 24, normal: 16, hard: 10, master: 6 })[match.aiLevel] ?? 16,
)

let cssScale = 1

function resize() {
  const c = canvasRef.value
  if (!c) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
  const w = 1280
  const h = 720
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  c.style.width = w + 'px'
  c.style.height = h + 'px'
  ctx = c.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  cssScale = Math.min(window.innerWidth / 1280, window.innerHeight / 720)
  debugStats.value = {
    ...debugStats.value,
    dpr,
    scale: cssScale,
    canvasW: c.width,
    canvasH: c.height,
    viewW: window.innerWidth,
    viewH: window.innerHeight,
  }
}

/* ============================================================
 * 相机
 *
 * 数学部分全在 game/cameraRig.ts：那里是纯函数，能脱离画面被断言
 * （两人是否都在画面里、有没有露出场地外、帧率变了行为会不会跟着变）。
 * 这里只留"什么时候推进"和"把它画出来"。
 * ============================================================ */
const cam = createCam()

/**
 * 每渲染帧推进相机。数学在 cameraRig.stepCamera，这里只负责调用。
 */
function updateCamera(w: World, dtMs: number): void {
  stepCamera(cam, w, dtMs)
}

/**
 * 出界指示器：有人跑出画面时，在画面边缘对应方向画一个三角 + 他的伤害值。
 *
 * 这是大乱斗镜头里最容易被忽略、但没有就一定被骂的一环：
 * 镜头缩到最小也装不下两人时（一人被击飞出界正在复归），
 * 玩家必须知道"那个人现在在我左边还是右边"。
 */
function drawOffscreenCues(g: CanvasRenderingContext2D, w: World) {
  const M = 30
  const BOT = 96 // 底部 HUD 高度，别让角标压在血条上
  const colors = ['#3b82f6', '#f97316']
  for (let i = 0; i < w.fighters.length; i++) {
    const f = w.fighters[i]!
    if (f.respawnTimer > 0 || f.state === 'dead') continue
    const off = offscreenOf(cam, f, M, undefined, BOT)
    if (!off) continue

    const pulse = 0.55 + 0.45 * Math.abs(Math.sin((w.frame + i * 23) * 0.07))
    const color = colors[i] ?? '#ffffff'
    const ang = Math.atan2(off.dirY, off.dirX)
    // 出了几条边：1 条只画箭头（贴边滑），2 条是角落，要画角标
    const corner = off.edges >= 2

    // 箭头贴安全框内侧滑：垂直出画就上下滑，水平出画就左右滑
    const arrowDist = 20
    const ax = off.sx - Math.cos(ang) * (corner ? 22 : 0)
    const ay = off.sy - Math.sin(ang) * (corner ? 22 : 0)

    // 还有场外复归冲刺时，箭头外面套一圈青色 —— 玩家得一眼看出"这一下还能救"
    const canRecover = f.recoveryDashes > 0 && isOffstage(w, f)
    if (canRecover) {
      g.save()
      g.strokeStyle = 'rgba(120,230,255,0.75)'
      g.lineWidth = 1.6
      g.beginPath()
      g.arc(ax, ay, 17, 0, Math.PI * 2)
      g.stroke()
      g.restore()
    }

    g.save()
    g.globalAlpha = 0.55 + pulse * 0.45
    g.translate(ax, ay)
    g.rotate(ang)
    g.fillStyle = color
    g.shadowColor = color
    g.shadowBlur = 10
    g.beginPath()
    g.moveTo(arrowDist, 0)
    g.lineTo(-arrowDist * 0.55, -arrowDist * 0.6)
    g.lineTo(-arrowDist * 0.2, 0)
    g.lineTo(-arrowDist * 0.55, arrowDist * 0.6)
    g.closePath()
    g.fill()
    g.restore()

    // 角标：伤害值 + 距离条。放在箭头内侧，始终朝画面中心
    const bx = off.sx - Math.cos(ang) * 44
    const by = off.sy - Math.sin(ang) * 44 - (corner ? 8 : 0)
    const r = 17
    g.save()
    g.globalAlpha = 0.78 + pulse * 0.22
    g.beginPath()
    g.roundRect(bx - r, by - r, r * 2, r * 2, 6)
    g.fillStyle = 'rgba(6,8,12,0.88)'
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = color
    g.stroke()
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '700 15px "DIN Alternate", system-ui, sans-serif'
    g.fillStyle = color
    g.fillText(`${Math.round(f.damage)}%`, bx, by)
    g.restore()

    // 场外越远，角标外圈越粗 —— 让玩家判断"还回得来吗"
    const vp = viewportOf(cam)
    const dx = Math.max(vp.x - f.x, 0, f.x - (vp.x + vp.w))
    const dy = Math.max(vp.y - f.y, 0, f.y - (vp.y + vp.h))
    const far = Math.min(1, Math.hypot(dx, dy) / 420)
    if (far > 0.02) {
      g.save()
      g.globalAlpha = 0.35 + far * 0.45
      g.strokeStyle = color
      g.lineWidth = 1 + far * 3
      g.beginPath()
      g.roundRect(bx - r - 4, by - r - 4, (r + 4) * 2, (r + 4) * 2, 9)
      g.stroke()
      g.restore()
    }
  }
}

/** 世界坐标 → 屏幕坐标 */
function w2s(wx: number, wy: number): { x: number; y: number } {
  return screenOf(cam, wx, wy)
}

/** 只算 x 的快捷方式 */
function sxo(worldX: number): number {
  return (worldX - cam.x) * cam.zoom + 640
}

/* ============================================================
 * 绘制
 * ============================================================ */

function draw() {
  const w = world.value
  if (!ctx) return
  const g = ctx

  // 震屏偏移
  const sh = cam.shake
  const shx = sh > 0 ? Math.sin(cam.shakePhase * 2.7) * sh : 0
  const shy = sh > 0 ? Math.cos(cam.shakePhase * 3.3) * sh : 0
  g.save()
  g.translate(shx, shy)

  drawBackground(g, w)
  drawHazards(g, w)
  drawPlatforms(g, w)
  drawBlastLines(g, w)
  drawProjectiles(g, w)
  drawFighters(g, w)
  drawEvents(g, w)
  drawComboText(g, w)
  // 出界指示器压在最上层：它是"找不到人"时唯一的线索
  drawOffscreenCues(g, w)

  g.restore()
}

/* 背景整体交给 game/stageBackdrop.ts：
 * 四层视差（0.06 / 0.14 / 0.26 / 0.44）+ 每张场地自己的母题（灯笼 / 齿轮 / 火 / 云）。
 * 放在独立模块里，是因为它的取舍和战斗逻辑无关——它只关心"角色浮不浮得起来"。
 * 这里只负责在它之上叠一层场地色调，让舞台和 HUD 的色温统一。 */
function drawBackground(g: CanvasRenderingContext2D, w: World) {
  // 地面（世界 y=0）在当前相机下的屏幕 y —— 背景要靠它对准平台，不能写死
  const groundY = (0 - cam.y) * cam.zoom + 400
  drawStageBackdrop(g, w.stage, { x: cam.x, y: cam.y, zoom: cam.zoom, groundY }, w.frame)

  // 场地色温：极低透明度的一层纯色，把整幅画的冷暖和该场地的 accent 拉齐
  g.fillStyle = w.stage.accent
  g.globalAlpha = 0.045
  g.fillRect(0, 0, 1280, 720)
  g.globalAlpha = 1
}

function drawPlatforms(g: CanvasRenderingContext2D, w: World) {
  const pal = platPalette(w.stage)
  for (const p of w.plats) {
    if (p.broken) {
      // 碎掉的平台只留一圈虚线残影，告诉玩家它会回来
      const a = w2s(p.x, p.y)
      g.strokeStyle = 'rgba(255,255,255,0.10)'
      g.setLineDash([5, 7])
      g.lineWidth = 1.5
      g.strokeRect(a.x, a.y, p.w * cam.zoom, Math.max(4, 10 * cam.zoom))
      g.setLineDash([])
      continue
    }
    const a = w2s(p.x, p.y)
    const pw = p.w * cam.zoom
    const ph = Math.max(6, p.h * cam.zoom)
    if (a.x + pw < -60 || a.x > 1340) continue

    if (p.type === 'solid') {
      const pg = g.createLinearGradient(0, a.y, 0, a.y + ph)
      pg.addColorStop(0, pal.solidTop)
      pg.addColorStop(0.35, pal.solidMid)
      pg.addColorStop(1, pal.solidBot)
      g.fillStyle = pg
      g.beginPath()
      g.roundRect(a.x, a.y, pw, ph, 4)
      g.fill()
      // 顶面亮线：这一道用场地 accent，是"同一套场景"最省力的信号
      g.fillStyle = p.flash > 0 ? '#fff' : w.stage.accent
      g.fillRect(a.x, a.y, pw, 3)
    } else {
      // 单向平台：细却有厚度的木条
      g.fillStyle = pal.passFill
      g.beginPath()
      g.roundRect(a.x, a.y, pw, Math.max(6, 10 * cam.zoom), 3)
      g.fill()
      g.fillStyle = p.flash > 0 ? '#fff' : pal.passCap
      g.fillRect(a.x, a.y, pw, 2.5)
    }

    // 可破坏平台：画出 hp 裂痕
    if (p.maxHp > 0) {
      const ratio = p.hp / p.maxHp
      if (ratio < 0.99) {
        g.strokeStyle = `rgba(255,80,60,${0.25 + (1 - ratio) * 0.6})`
        g.lineWidth = 1 + (1 - ratio) * 1.6
        const n = Math.ceil((1 - ratio) * 5)
        for (let i = 0; i < n; i++) {
          const cx = a.x + ((i + 1) / (n + 1)) * pw
          g.beginPath()
          g.moveTo(cx, a.y)
          g.lineTo(cx + 4, a.y + ph * 0.5)
          g.lineTo(cx - 3, a.y + ph)
          g.stroke()
        }
      }
    }

    // 移动平台：画一条导轨暗示
    if (p.moveAmp > 0) {
      const lx = w2s(p.baseX - p.moveAmp, p.y)
      g.strokeStyle = 'rgba(168,232,92,0.16)'
      g.setLineDash([3, 6])
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(lx.x, lx.y + 5)
      g.lineTo(lx.x + p.w * cam.zoom + p.moveAmp * 2 * cam.zoom, lx.y + 5)
      g.stroke()
      g.setLineDash([])
    }

    /* 可抓的边：左右两端画一小段「手能抓住」的亮角。
     * 这是抓边系统唯一的学习成本——玩家得先看见哪里能抓。 */
    if (p.grabbable) {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin((w.frame + p.id * 17) * 0.05))
      const cw = 7 * cam.zoom
      const ch = 9 * cam.zoom
      g.fillStyle = `rgba(168,232,92,${0.5 * pulse})`
      // 左边
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(a.x - cw, a.y + ch)
      g.lineTo(a.x, a.y + ch)
      g.closePath()
      g.fill()
      // 右边
      g.beginPath()
      g.moveTo(a.x + pw, a.y)
      g.lineTo(a.x + pw + cw, a.y + ch)
      g.lineTo(a.x + pw, a.y + ch)
      g.closePath()
      g.fill()
    }
  }
}

function drawBlastLines(g: CanvasRenderingContext2D, w: World) {
  g.strokeStyle = 'rgba(255,59,48,0.30)'
  g.setLineDash([7, 9])
  g.lineWidth = 2
  for (const wx of [w.stage.blastZone.x, w.stage.blastZone.x + w.stage.blastZone.w]) {
    const px = sxo(wx)
    if (px < -20 || px > 1300) continue
    g.beginPath()
    g.moveTo(px, 0)
    g.lineTo(px, 720)
    g.stroke()
  }
  g.setLineDash([])
}

function drawHazards(g: CanvasRenderingContext2D, w: World) {
  for (const h of w.hazards) {
    const d = h.def
    const a = w2s(h.x, h.y)
    const hw = h.w * cam.zoom
    const hh = h.h * cam.zoom

    if (d.kind === 'flame') {
      const t = (w.frame + d.phase) % d.period
      const warm = Math.max(0, 1 - Math.abs(t - d.duration * 0.5) / (d.duration * 0.6))
      // 地面喷口
      g.fillStyle = 'rgba(255,120,40,0.22)'
      g.fillRect(a.x - 4, a.y + hh - 6, hw + 8, 8)
      if (!h.active) continue
      const flick = 0.7 + 0.3 * Math.abs(Math.sin((w.frame + d.phase) * 0.3))
      const fg = g.createLinearGradient(0, a.y + hh, 0, a.y)
      fg.addColorStop(0, `rgba(255,190,60,${0.85 * flick})`)
      fg.addColorStop(0.5, `rgba(255,100,30,${0.55 * flick})`)
      fg.addColorStop(1, 'rgba(255,60,20,0)')
      g.fillStyle = fg
      g.beginPath()
      g.moveTo(a.x, a.y + hh)
      g.lineTo(a.x + hw * 0.2, a.y)
      g.lineTo(a.x + hw * 0.8, a.y)
      g.lineTo(a.x + hw, a.y + hh)
      g.closePath()
      g.fill()
      void warm
    } else if (d.kind === 'gear') {
      const cx = a.x + hw / 2
      const cy = a.y + hh / 2
      const r = hw / 2
      const rot = (w.frame + d.phase) * 0.06
      g.save()
      g.translate(cx, cy)
      g.rotate(rot)
      g.fillStyle = 'rgba(168,232,92,0.30)'
      g.beginPath()
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2
        const rr = i % 2 === 0 ? r : r * 0.72
        const px = Math.cos(ang) * rr
        const py = Math.sin(ang) * rr
        if (i === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.closePath()
      g.fill()
      g.strokeStyle = 'rgba(168,232,92,0.8)'
      g.lineWidth = 2
      g.stroke()
      g.fillStyle = 'rgba(10,14,10,0.9)'
      g.beginPath()
      g.arc(0, 0, r * 0.3, 0, Math.PI * 2)
      g.fill()
      g.restore()
    } else if (d.kind === 'rock') {
      if (!h.active) continue
      g.fillStyle = 'rgba(150,160,180,0.9)'
      g.beginPath()
      g.arc(a.x + hw / 2, a.y + hh / 2, hw / 2, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(255,255,255,0.5)'
      g.lineWidth = 1.5
      g.stroke()
      // 下落拖影
      g.strokeStyle = 'rgba(150,160,180,0.22)'
      g.beginPath()
      g.moveTo(a.x + hw / 2, a.y - 3)
      g.lineTo(a.x + hw / 2, a.y - 60 * cam.zoom)
      g.stroke()
    } else if (d.kind === 'lava') {
      if (!h.active) continue
      const lg = g.createLinearGradient(0, a.y, 0, a.y + hh)
      lg.addColorStop(0, 'rgba(255,120,30,0.9)')
      lg.addColorStop(1, 'rgba(180,30,10,0.95)')
      g.fillStyle = lg
      g.fillRect(a.x, a.y, hw, hh)
      // 表面波纹
      g.strokeStyle = 'rgba(255,220,120,0.7)'
      g.lineWidth = 2
      g.beginPath()
      for (let i = 0; i <= hw; i += 12) {
        const yy = a.y + Math.sin((i + w.frame * 3) * 0.05) * 3
        if (i === 0) g.moveTo(a.x + i, yy)
        else g.lineTo(a.x + i, yy)
      }
      g.stroke()
    } else if (d.kind === 'wind') {
      // 上升气流：向上的箭头流
      g.save()
      g.globalAlpha = 0.22
      g.strokeStyle = '#8ec5ff'
      g.lineWidth = 2
      for (let i = 0; i < 6; i++) {
        const yy = ((w.frame * 3 + i * 90) % (hh + 80)) - 40
        const xx = a.x + ((i * 47) % hw)
        g.beginPath()
        g.moveTo(xx, a.y + hh - yy)
        g.lineTo(xx, a.y + hh - yy - 26)
        g.stroke()
        g.beginPath()
        g.moveTo(xx - 5, a.y + hh - yy - 20)
        g.lineTo(xx, a.y + hh - yy - 28)
        g.lineTo(xx + 5, a.y + hh - yy - 20)
        g.stroke()
      }
      g.restore()
    }
  }
}

function drawProjectiles(g: CanvasRenderingContext2D, w: World) {
  for (const p of w.projectiles) {
    const a = w2s(p.x, p.y)
    const s = cam.zoom
    switch (p.kind) {
      case 'arrow': {
        const dir = p.vx >= 0 ? 1 : -1
        const len = 26 * s
        g.strokeStyle = '#ffe9a8'
        g.lineWidth = 2.5 * s
        g.beginPath()
        g.moveTo(a.x - dir * len, a.y)
        g.lineTo(a.x + dir * len, a.y)
        g.stroke()
        g.fillStyle = '#ffd24d'
        g.beginPath()
        g.moveTo(a.x + dir * len, a.y)
        g.lineTo(a.x + dir * (len - 9 * s), a.y - 5 * s)
        g.lineTo(a.x + dir * (len - 9 * s), a.y + 5 * s)
        g.closePath()
        g.fill()
        // 拖尾
        g.strokeStyle = 'rgba(255,233,168,0.28)'
        g.lineWidth = 1.5 * s
        g.beginPath()
        g.moveTo(a.x - dir * len * 2.4, a.y)
        g.lineTo(a.x - dir * len, a.y)
        g.stroke()
        break
      }
      case 'bottle': {
        const propSrc = propUrl((p.owner === 0 ? charA : charB).id, 'bottle')
        const prop = propSrc ? sprite(propSrc) : null
        g.save()
        g.translate(a.x, a.y)
        g.rotate(Math.atan2(p.vy, p.vx) * 0.6)
        if (prop) {
          // 有贴图就画贴图：宽 22 逻辑像素，高度按原比例
          const h = (22 * s * prop.height) / prop.width
          g.drawImage(prop, -11 * s, -h / 2, 22 * s, h)
        } else {
          g.fillStyle = 'rgba(120,190,120,0.92)'
          g.beginPath()
          g.roundRect(-6 * s, -9 * s, 12 * s, 18 * s, 3 * s)
          g.fill()
          g.fillStyle = '#9fe0a0'
          g.fillRect(-2.5 * s, -14 * s, 5 * s, 6 * s)
          g.strokeStyle = '#0b0f16'
          g.lineWidth = 1.4 * s
          g.stroke()
        }
        g.restore()
        break
      }
      case 'bomb': {
        g.fillStyle = p.fuse > 0 ? 'rgba(90,90,100,1)' : 'rgba(50,50,60,1)'
        g.beginPath()
        g.arc(a.x, a.y, 9 * s, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = '#0b0f16'
        g.lineWidth = 1.6 * s
        g.stroke()
        // 引信火花：引信越短闪得越快
        if (p.fuse > 0) {
          const fast = p.fuse < 16 ? 0.5 : 0.18
          const on = Math.sin(w.frame * (1 + fast * 8)) > 0
          g.fillStyle = on ? '#ffd84d' : '#ff6a30'
          g.beginPath()
          g.arc(a.x + 5 * s, a.y - 9 * s, 3.2 * s, 0, Math.PI * 2)
          g.fill()
        }
        break
      }
      case 'banana': {
        g.save()
        g.translate(a.x, a.y)
        g.strokeStyle = '#f5d341'
        g.lineWidth = 4.5 * s
        g.lineCap = 'round'
        g.beginPath()
        g.arc(0, -3 * s, 8 * s, Math.PI * 0.15, Math.PI * 0.85)
        g.stroke()
        g.restore()
        break
      }
      case 'trap': {
        const armed = p.arm <= 0
        g.save()
        g.translate(a.x, a.y)
        g.strokeStyle = armed ? '#c9d3e0' : 'rgba(201,211,224,0.35)'
        g.lineWidth = 2.4 * s
        for (let i = 0; i < 4; i++) {
          const xx = (i - 1.5) * 8 * s
          g.beginPath()
          g.moveTo(xx, 0)
          g.lineTo(xx, -9 * s)
          g.lineTo(xx + 3 * s, -13 * s)
          g.stroke()
        }
        g.beginPath()
        g.moveTo(-18 * s, 0)
        g.lineTo(18 * s, 0)
        g.stroke()
        if (!armed) {
          // 布防倒计时：一圈进度弧
          g.strokeStyle = 'rgba(255,216,77,0.85)'
          g.lineWidth = 2 * s
          g.beginPath()
          g.arc(0, -6 * s, 15 * s, -Math.PI / 2, -Math.PI / 2 + (1 - p.arm / 36) * Math.PI * 2)
          g.stroke()
        }
        g.restore()
        break
      }
      case 'explosion': {
        const t = 1 - p.life / 18
        const r = (12 + t * 46) * s
        const eg = g.createRadialGradient(a.x, a.y, r * 0.1, a.x, a.y, r)
        eg.addColorStop(0, `rgba(255,255,220,${0.9 * (1 - t)})`)
        eg.addColorStop(0.45, `rgba(255,160,60,${0.7 * (1 - t)})`)
        eg.addColorStop(1, 'rgba(255,60,20,0)')
        g.fillStyle = eg
        g.beginPath()
        g.arc(a.x, a.y, r, 0, Math.PI * 2)
        g.fill()
        break
      }
    }
  }
}

function drawFighters(g: CanvasRenderingContext2D, w: World) {
  const alpha = Math.min(1, acc / C.STEP_MS)
  for (const f of w.fighters) {
    if (f.state === 'dead' && f.respawnTimer > 0) continue
    const ix = f.px + (f.x - f.px) * alpha
    const iy = f.py + (f.y - f.py) * alpha
    drawFighter(g, ix, iy, f)
  }
}

/**
 * 四肢绘制。这是"8 方向攻击看得出方向"的关键。
 *
 * 手臂角度按 attackDir 给基准，再叠加出招包络做挥动：
 *   neutral    → 平举前伸（0°），肘弯略收
 *   forward    → 前上抬再下砸（-20° → 40°）
 *   back       → 向后拉再回头挥（150° → 100°）
 *   up         → 竖直上挑（80° → 100°）
 *   upForward  → 斜上 45°（45°）
 *   upBack     → 斜上后 135°
 *   down       → 下砸（-70°）
 *   downForward→ 斜下 -40°
 *   downBack   → 斜下后 200°（等价 -160°，回头下段）
 *
 * 腿部随状态：run 摆腿、jump 收腿、crouch 屈膝、knockdown 摊平。
 */
function drawLimbs(
  g: CanvasRenderingContext2D,
  f: World['fighters'][0],
  s: number,
  bw: number,
  bh: number,
  phase: number,
): void {
  const state = f.state
  const facing = f.facing
  const limbW = Math.max(3.2, 5 * s)
  const armLen = bh * 0.32
  const legLen = bh * 0.36
  const shoulderY = -bh * 0.74
  const hipY = -bh * 0.28

  const dark = f.char.colorDark
  const art = artOf(f.char.id)

  /**
   * 画一节肢体：从 (0,0) 起，角度 a（度，0=正前方），长度 len。
   *
   * 以前这里是 `lineTo` + `lineWidth`，视觉上就是四根棍子；
   * 现在换成 `charArt.ts` 里的 SVG 路径，同样是绕枢轴旋转，
   * 但形状有粗细过渡与收口 —— 这就是"用 SVG 代替美术资源"的落地点。
   */
  const seg = (
    a: number,
    len: number,
    thick = limbW,
    part: 'upper' | 'lower' = 'upper',
    fill: string = dark,
  ) => {
    const rad = (a * Math.PI) / 180
    const ang = facing > 0 ? rad : Math.PI - rad
    const ex = Math.cos(ang) * len
    const ey = -Math.sin(ang) * len
    drawLimb(g, part === 'upper' ? ART_UPPER : ART_LOWER, ex, ey, len, thick, fill, art.ink)
    return { ex, ey }
  }

  // ---------------- 腿 ----------------
  let frontLegA = 88
  let backLegA = 92
  let legBend = 0
  if (state === 'run') {
    const sw = Math.sin(phase * 0.55)
    frontLegA = 88 + sw * 26
    backLegA = 92 - sw * 26
  } else if (state === 'jump') {
    frontLegA = 52
    backLegA = 66
    legBend = 1
  } else if (state === 'fall') {
    frontLegA = 74
    backLegA = 78
  } else if (state === 'crouch') {
    frontLegA = 40
    backLegA = 48
    legBend = 1
  } else if (state === 'knockdown') {
    frontLegA = 30
    backLegA = 14
  } else if (state === 'hurt') {
    frontLegA = 70
    backLegA = 100
  } else if (state === 'land') {
    frontLegA = 60
    backLegA = 66
  }

  // 后腿（先画，压在躯干后）
  g.save()
  g.translate(facing * -bw * 0.16, hipY)
  const bk = seg(backLegA, legLen * (legBend ? 0.84 : 1), limbW * 0.92, 'upper', art.clothDark)
  g.translate(bk.ex, bk.ey)
  const bk2 = seg(backLegA - (legBend ? 42 : 8), legLen * 0.7, limbW * 0.8, 'lower', art.clothDark)
  g.translate(bk2.ex, bk2.ey)
  drawPart(g, ART_FOOT, 0, 0, limbW * 1.5, limbW * 1.05, art.clothDark, art.ink)
  g.restore()

  // 前腿
  g.save()
  g.translate(facing * bw * 0.16, hipY)
  const fr = seg(frontLegA, legLen * (legBend ? 0.86 : 1), limbW, 'upper', art.cloth)
  g.translate(fr.ex, fr.ey)
  const fr2 = seg(frontLegA - (legBend ? 44 : 10), legLen * 0.72, limbW * 0.82, 'lower', art.clothDark)
  g.translate(fr2.ex, fr2.ey)
  drawPart(g, ART_FOOT, 0, 0, limbW * 1.6, limbW * 1.1, art.armor, art.ink)
  g.restore()

  // ---------------- 手臂 ----------------
  // 出招包络：0 → 1 → 0
  let env = 0
  let total = 0
  if (state === 'attack' || state === 'special' || state === 'dashattack') {
    if (state === 'special') {
      const sp = f.specialDef
      const fr2 = sp ? SPECIAL_FRAMES[sp.kind] : SPECIAL_FRAMES.arrow
      total = fr2.startup + fr2.active + fr2.recovery
    } else {
      const m = moveOf(f, f.attackDir, f.dashAttack)
      total = m.startup + m.active + m.recovery
    }
    const t = total > 0 ? f.attackFrame / total : 0
    env = t < 0.4 ? t / 0.4 : Math.max(0, 1 - (t - 0.4) / 0.6)
  }

  // 每种方向的「蓄」与「出」两个角度
  let windA = 20
  let strikeA = 0
  let strikeLen = armLen
  switch (state === 'special' ? 'neutral' : f.attackDir) {
    case 'forward':
      windA = -24
      strikeA = 42
      strikeLen = armLen * 1.15
      break
    case 'back':
      windA = 152
      strikeA = 104
      break
    case 'up':
      windA = 62
      strikeA = 98
      strikeLen = armLen * 1.1
      break
    case 'upForward':
      windA = 20
      strikeA = 52
      break
    case 'upBack':
      windA = 128
      strikeA = 150
      break
    case 'down':
      windA = -30
      strikeA = -72
      break
    case 'downForward':
      windA = 4
      strikeA = -38
      break
    case 'downBack':
      windA = 116
      strikeA = -168
      break
    default:
      windA = 24
      strikeA = 0
      strikeLen = armLen * 1.05
  }

  // 非出招时的手臂姿势
  let idleFront = 42
  let idleBack = 34
  let idleBend = 0.7
  if (state === 'run') {
    idleFront = 40 + Math.sin(phase * 0.55) * 30
    idleBack = 48 - Math.sin(phase * 0.55) * 30
  } else if (state === 'jump') {
    idleFront = 68
    idleBack = 58
  } else if (state === 'crouch') {
    idleFront = 26
    idleBack = 20
    idleBend = 1
  } else if (state === 'hurt') {
    idleFront = 110
    idleBack = 100
  } else if (state === 'knockdown') {
    idleFront = 160
    idleBack = 140
    idleBend = 0.2
  } else if (state === 'broken') {
    idleFront = 130 + Math.sin(phase * 0.3) * 18
    idleBack = 120 - Math.sin(phase * 0.3) * 18
  } else if (state === 'dash') {
    // 冲刺：手往身后收，像跑短跑
    idleFront = 22
    idleBack = 152
    idleBend = 0.5
  } else if (state === 'ledge') {
    // 悬挂：两只手都朝上抓着边缘
    idleFront = 96
    idleBack = 84
    idleBend = 0.15
  }

  // 后手
  const backArmA = env > 0 ? windA - 30 * env : idleBack
  g.save()
  g.translate(facing * -bw * 0.4, shoulderY)
  const ba = seg(backArmA, armLen * (idleBend ? 0.9 : 1), limbW * 0.9, 'upper', art.clothDark)
  g.translate(ba.ex, ba.ey)
  const ba2 = seg(backArmA - 34 * idleBend, armLen * 0.78, limbW * 0.8, 'lower', art.clothDark)
  g.translate(ba2.ex, ba2.ey)
  drawPart(g, ART_FIST, 0, 0, limbW * 1.15, limbW * 1.15, art.clothDark, art.ink)
  g.restore()

  // 前手：出招时从 windA 打到 strikeA
  const frontA = env > 0 ? windA + (strikeA - windA) * env : idleFront
  const frontLen = env > 0 ? armLen + (strikeLen - armLen) * env : armLen
  g.save()
  g.translate(facing * bw * 0.4, shoulderY)
  const fa = seg(frontA, frontLen, limbW, 'upper', art.cloth)
  g.translate(fa.ex, fa.ey)
  const fa2 = seg(frontA - (env > 0.4 ? 6 : 30), armLen * 0.7, limbW * 0.82, 'lower', art.armor)
  g.translate(fa2.ex, fa2.ey)
  drawPart(g, ART_FIST, 0, 0, limbW * 1.3, limbW * 1.3, art.armor, art.ink)

  // 武器：挂在出击手末端。待机时竖起，出招时随手臂甩到正前方。
  if (art.weapon) {
    const wLen = limbW * 5.2 * art.weaponScale
    const wThick = limbW * 1.9
    // 握在手心后一点，绕手心旋转：待机 -90°（竖起），判定帧转到与手臂同向
    const wAng = env > 0 ? (1 - env) * -Math.PI * 0.55 : -Math.PI * 0.5
    g.save()
    g.translate(-limbW * 0.3, 0)
    drawPart(g, art.weapon, 0, 0, wLen, wThick, art.armor, art.ink, wAng)
    g.restore()
  }

  // 出拳拖影：判定帧期间在拳前方画一道弧
  if (env > 0.35 && (state === 'attack' || state === 'special' || state === 'dashattack')) {
    g.save()
    g.scale(facing, 1) // 弧要跟着朝向翻，否则朝左出拳时拖影画到背后
    g.strokeStyle = `rgba(255,232,150,${0.5 * env})`
    g.lineWidth = limbW * (state === 'dashattack' ? 2.2 : 1.4)
    g.beginPath()
    g.arc(0, 0, frontLen + 6 * s, -0.7, 0.7)
    g.stroke()
    g.restore()
  }
  g.restore()
}

function drawFighter(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  f: World['fighters'][0],
) {
  const a = w2s(x, y)
  const s = cam.zoom
  const px = a.x
  const cy = a.y
  const facing = f.facing
  const color = f.char.color
  const colorDark = f.char.colorDark
  const state = f.state
  const phase = f.stateFramePhase

  /* ---- 视觉动画：全部由状态纯推导，绝不写回 FighterState ---- */
  let scaleX = 1
  let scaleY = 1
  let rot = 0

  if (state === 'jump') {
    scaleY = 1.08
    scaleX = 0.94
  } else if (state === 'fall') {
    scaleY = 1.04
    scaleX = 0.97
  } else if (state === 'land') {
    scaleY = 0.9
    scaleX = 1.08
  } else if (state === 'crouch') {
    scaleY = 0.92
    scaleX = 1.05
  } else if (state === 'knockdown') {
    // 倒地：整体压扁 + 侧躺
    scaleY = 0.52
    scaleX = 1.24
    rot = facing * -Math.PI * 0.42
  } else if (state === 'broken') {
    // 破盾眩晕：左右摇晃
    rot = Math.sin(phase * 0.28) * 0.12
  } else if (state === 'dash') {
    // 冲刺的形变要跟着冲刺方向走：横冲拉长、上冲拉高、斜冲两者兼有。
    // 只按"向前拉长"画的话，向上冲刺会变成"人歪着往上飘"，很怪。
    const dvx = Math.abs(f.dashVecX)
    const dvy = Math.abs(f.dashVecY)
    scaleX = 1 + dvx * 0.22 - dvy * 0.12
    scaleY = 1 - dvx * 0.16 + dvy * 0.26
    // 只有横向分量才前倾；纯上下冲不歪
    rot = f.dashVecX * -0.16
    if (f.dashVecX === 0) rot = 0
  } else if (state === 'dashattack') {
    scaleX = 1.12
    scaleY = 0.95
  } else if (state === 'ledge') {
    // 悬挂：整个人挂在边缘下方，略微压缩
    scaleY = 0.96
  }

  let bob = 0
  let tilt = 0
  if (state === 'run') {
    bob = Math.sin(phase * 0.55) * 2.4 * s
    tilt = Math.sin(phase * 0.55) * 0.05
  } else if (state === 'idle') {
    bob = Math.sin(phase * 0.06) * 1.3 * s
  } else if (state === 'knockdown') {
    bob = Math.sin(phase * 0.2) * 1.2 * s
  } else if (state === 'ledge') {
    bob = Math.sin(phase * 0.1) * 1.2 * s
  }

  let shakeX = 0
  if (state === 'hurt') shakeX = Math.sin(phase * 2.4) * 3 * Math.min(1, f.hitstun / 12) * s

  // 出招前冲
  let lunge = 0
  if (state === 'attack' || state === 'special' || state === 'dashattack') {
    let total = 1
    if (state === 'special') {
      const sp = f.specialDef
      const fr = sp ? SPECIAL_FRAMES[sp.kind] : SPECIAL_FRAMES.arrow
      total = fr.startup + fr.active + fr.recovery
    } else {
      const m = moveOf(f, f.attackDir, f.dashAttack)
      total = m.startup + m.active + m.recovery
    }
    const t = f.attackFrame / Math.max(1, total)
    const envelope = t < 0.45 ? t / 0.45 : Math.max(0, 1 - (t - 0.45) / 0.55)
    const mult = state === 'special' ? 1.3 : state === 'dashattack' ? 1.9 : 1
    lunge = envelope * 6 * s * mult
  }

  const bh = (f.knockedDown ? 30 : f.crouching ? C.CROUCH_HEIGHT : 64) * scaleY * s
  const bw = 28 * scaleX * s

  const baseX = px + facing * lunge + shakeX
  const baseY = cy + bob

  // 无敌 / 击倒：透明闪烁（用户要的"透明闪烁、无敌虚无"）
  let alpha = 1
  if (f.knockedDown) {
    // 快速闪烁，一眼能看出"现在打不到"
    alpha = 0.25 + 0.45 * Math.abs(Math.sin(phase * 0.42))
  } else if (f.invincible > 0) {
    // 复活无敌：慢速呼吸闪烁，和击倒区分开
    alpha = 0.45 + 0.35 * Math.abs(Math.sin(phase * 0.18))
  }
  g.globalAlpha = alpha

  // 阴影
  const airH = Math.max(0, -y)
  const shadowScale = Math.max(0.4, 1 - airH / 300)
  g.fillStyle = `rgba(0,0,0,${0.42 * shadowScale * alpha})`
  g.beginPath()
  g.ellipse(px, cy + 2, bw * 0.6, 5 * shadowScale * s, 0, 0, Math.PI * 2)
  g.fill()

  g.save()
  g.translate(baseX, baseY)
  g.rotate(tilt + rot)

  // 躯干：对襟短打（矢量件，枢轴在髋部，向上长到 -bh）
  const bodyArt = artOf(f.char.id)
  drawPart(g, bodyArt.torso, 0, 0, bw * 1.2, bh, color, bodyArt.ink)
  // 体积感：上半身压一层亮色，不做渐变（渐变会把描边也染色）
  g.fillStyle = colorDark
  g.globalAlpha = 0.34
  g.beginPath()
  g.roundRect(-bw * 0.56, -bh * 0.42, bw * 1.12, bh * 0.42, 3 * s)
  g.fill()
  g.globalAlpha = 1
  // 胸甲片：让人在剪影上就看出"这是重装"
  g.fillStyle = bodyArt.armor
  g.beginPath()
  g.roundRect(-bw * 0.3, -bh * 0.74, bw * 0.6, bh * 0.3, 2.5 * s)
  g.fill()

  // 头：矢量头部 + 头饰。70 像素高时认出角色靠的就是头饰与武器。
  const headR = 8.4 * s
  const headY = -bh - headR * 1.05
  drawPart(g, bodyArt.head, 0, headY, headR * 2.1, headR * 2.3, bodyArt.cloth, bodyArt.ink)
  // 面部暗区（朝向侧）
  g.fillStyle = bodyArt.ink
  g.globalAlpha = 0.5
  g.beginPath()
  g.rect(facing > 0 ? headR * 0.2 : -headR * 0.98, headY - headR * 0.06, headR * 0.78, headR * 0.48)
  g.fill()
  g.globalAlpha = 1
  g.save()
  g.translate(0, headY)
  drawCrest(g, bodyArt.crest, headR, bodyArt.ink, bodyArt.accent)
  g.restore()

  /* ---- 四肢：让 8 个攻击方向一眼能认出来 ----
   * 全部由 (state, attackDir, attackFrame) 推导，不写回 FighterState。
   * 手臂角度约定：0° 指向正前方（+x），正角度朝上，负朝下。
   */
  drawLimbs(g, f, s, bw, bh, phase)

  // 朝向三角
  if (state !== 'knockdown') {
    g.fillStyle = '#ffb020'
    g.beginPath()
    g.moveTo(facing * (bw / 2 + 7 * s), -bh * 0.62)
    g.lineTo(facing * (bw / 2 + 1 * s), -bh * 0.62 - 5 * s)
    g.lineTo(facing * (bw / 2 + 1 * s), -bh * 0.62 + 5 * s)
    g.closePath()
    g.fill()
  }
  g.restore()

  g.globalAlpha = 1

  /* ---- 变形盾 ---- */
  const ratio = Math.max(0, Math.min(1, f.shield / C.SHIELD_MAX))
  const shieldOn = f.crouching
  if (!f.knockedDown && (shieldOn || ratio < 1)) {
    const rel = shieldCenter(f)
    const c = w2s(x + (rel.x - f.x), y + (rel.y - f.y))
    const r = shieldRadius(f) * s
    const blink = ratio < 0.25 ? 0.6 + 0.4 * Math.abs(Math.sin(phase * 0.35)) : 1
    g.beginPath()
    g.arc(c.x, c.y, r, 0, Math.PI * 2)
    g.fillStyle = shieldOn
      ? `rgba(96,165,250,${(0.12 + ratio * 0.1) * blink})`
      : `rgba(96,165,250,${ratio * 0.04})`
    g.fill()
    g.lineWidth = (shieldOn ? 2.5 : 1.2) * s
    g.strokeStyle =
      ratio < 0.25
        ? `rgba(255,59,48,${(0.45 + ratio) * blink})`
        : `rgba(96,165,250,${0.25 + ratio * 0.55})`
    g.stroke()
    g.beginPath()
    g.arc(c.x - r * 0.3, c.y - r * 0.35, r * 0.35, 0, Math.PI * 2)
    g.fillStyle = `rgba(255,255,255,${shieldOn ? 0.1 + ratio * 0.08 : 0.03})`
    g.fill()
  }

  /* ---- 击倒：脚下画一圈"地面裂纹"，强化"虚无"感 ---- */
  if (f.knockedDown) {
    g.strokeStyle = `rgba(255,216,77,${0.25 * Math.abs(Math.sin(phase * 0.42)) + 0.1})`
    g.lineWidth = 2 * s
    g.beginPath()
    g.ellipse(px, cy + 3, 34 * s, 8 * s, 0, 0, Math.PI * 2)
    g.stroke()
  }

  // 破盾眩晕星星
  if (state === 'broken') {
    g.fillStyle = '#ffd84d'
    for (let i = 0; i < 3; i++) {
      const ang = phase * 0.12 + i * 2.1
      g.beginPath()
      g.arc(
        px + Math.cos(ang) * 18 * s,
        cy - 78 * s + Math.sin(ang) * 6 * s,
        3 * s,
        0,
        Math.PI * 2,
      )
      g.fill()
    }
  }

  // 攻击判定框（调试用，~ 面板打开时才画）
  if (showDebug.value && (state === 'attack' || state === 'special')) {
    const hb = hurtBox(f)
    g.strokeStyle = 'rgba(255,216,77,0.85)'
    g.lineWidth = 1.5
    const h = w2s(hb.l, hb.t)
    g.strokeRect(h.x, h.y, (hb.r - hb.l) * s, (hb.b - hb.t) * s)
  }

  // 受击闪白
  if (state === 'hurt') {
    g.fillStyle = 'rgba(255,255,255,0.45)'
    g.beginPath()
    g.roundRect(baseX - bw / 2, baseY - bh, bw, bh, 6 * s)
    g.fill()
  }
}

function drawEvents(g: CanvasRenderingContext2D, w: World) {
  for (const ev of w.events) {
    const a = w2s(ev.x, ev.y)
    const s = cam.zoom
    if (ev.type === 'hit') {
      const power = ev.power ?? 0
      const r = (10 + Math.min(22, power * 2.2)) * s
      // 命中：放射状星芒，比圆更有冲击力
      const eg = g.createRadialGradient(a.x, a.y, 1, a.x, a.y, r * 1.8)
      eg.addColorStop(0, 'rgba(255,255,240,0.95)')
      eg.addColorStop(0.4, 'rgba(255,216,77,0.7)')
      eg.addColorStop(1, 'rgba(255,150,40,0)')
      g.fillStyle = eg
      g.beginPath()
      g.arc(a.x, a.y, r * 1.8, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(255,255,255,0.85)'
      g.lineWidth = 2 * s
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + ev.x * 0.01
        g.beginPath()
        g.moveTo(a.x + Math.cos(ang) * r * 0.5, a.y + Math.sin(ang) * r * 0.5)
        g.lineTo(a.x + Math.cos(ang) * r * 1.7, a.y + Math.sin(ang) * r * 1.7)
        g.stroke()
      }
      // 震屏强度随击飞速度
      cam.shake = Math.max(cam.shake, Math.min(11, 2 + power * 0.5))
    } else if (ev.type === 'ko') {
      cam.shake = Math.max(cam.shake, 13)
      const eg = g.createRadialGradient(a.x, a.y, 2, a.x, a.y, 90 * s)
      eg.addColorStop(0, 'rgba(255,255,255,0.9)')
      eg.addColorStop(0.3, 'rgba(255,80,50,0.7)')
      eg.addColorStop(1, 'rgba(255,40,20,0)')
      g.fillStyle = eg
      g.beginPath()
      g.arc(a.x, a.y, 90 * s, 0, Math.PI * 2)
      g.fill()
    } else if (ev.type === 'block') {
      g.strokeStyle = 'rgba(96,165,250,0.9)'
      g.lineWidth = 3 * s
      g.beginPath()
      g.arc(a.x, a.y, 20 * s, -1.0, 1.0)
      g.stroke()
      g.strokeStyle = 'rgba(191,219,254,0.7)'
      g.lineWidth = 1.5 * s
      g.beginPath()
      g.arc(a.x, a.y, 26 * s, -0.8, 0.8)
      g.stroke()
    } else if (ev.type === 'shieldbreak') {
      cam.shake = Math.max(cam.shake, 9)
      g.strokeStyle = 'rgba(255,59,48,0.95)'
      g.lineWidth = 3 * s
      g.beginPath()
      g.arc(a.x, a.y, 38 * s, 0, Math.PI * 2)
      g.stroke()
    } else if (ev.type === 'knockdown') {
      cam.shake = Math.max(cam.shake, 10)
      // 击倒：一圈冲击波 + 下方文字
      for (let i = 0; i < 2; i++) {
        g.strokeStyle = `rgba(255,216,77,${0.8 - i * 0.35})`
        g.lineWidth = (3 - i) * s
        g.beginPath()
        g.ellipse(a.x, a.y + 24 * s, (30 + i * 16) * s, (8 + i * 5) * s, 0, 0, Math.PI * 2)
        g.stroke()
      }
    } else if (ev.type === 'trip') {
      g.strokeStyle = 'rgba(245,211,65,0.9)'
      g.lineWidth = 2.5 * s
      g.beginPath()
      g.arc(a.x, a.y, 16 * s, Math.PI * 0.2, Math.PI * 0.9)
      g.stroke()
    } else if (ev.type === 'explode') {
      cam.shake = Math.max(cam.shake, 7)
    } else if (ev.type === 'trap') {
      cam.shake = Math.max(cam.shake, 8)
    } else if (ev.type === 'grab') {
      g.strokeStyle = 'rgba(255,120,60,0.9)'
      g.lineWidth = 2.5 * s
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + Math.PI / 4
        g.beginPath()
        g.moveTo(a.x + Math.cos(ang) * 10 * s, a.y + Math.sin(ang) * 10 * s)
        g.lineTo(a.x + Math.cos(ang) * 24 * s, a.y + Math.sin(ang) * 24 * s)
        g.stroke()
      }
    } else if (ev.type === 'dash' && ev.label === 'recovery') {
      // 场外复归冲刺：一条青色速度尾迹，和普通冲刺区分开
      // （玩家得立刻知道"这一下是能救命的那一下"）
      g.strokeStyle = 'rgba(120,230,255,0.55)'
      g.lineWidth = 5 * s
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(a.x - 46 * s, a.y + 12 * s)
      g.lineTo(a.x + 10 * s, a.y + 12 * s)
      g.stroke()
    } else if (ev.type === 'ledgegrab') {
      // 抓边：手边一圈白色高光闪一下，提示"抓住了"
      g.strokeStyle = 'rgba(232,240,255,0.9)'
      g.lineWidth = 2.4 * s
      g.beginPath()
      g.arc(a.x, a.y, 18 * s, Math.PI * 0.75, Math.PI * 2.25)
      g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.65)'
      g.beginPath()
      g.arc(a.x, a.y, 3.5 * s, 0, Math.PI * 2)
      g.fill()
    } else if (ev.type === 'climb') {
      g.strokeStyle = 'rgba(168,232,92,0.85)'
      g.lineWidth = 2 * s
      g.beginPath()
      g.arc(a.x, a.y, (14 + (ev.label === 'climb' ? 6 : 0)) * s, Math.PI * 0.6, Math.PI * 2.4)
      g.stroke()
    } else if (ev.type === 'dashattack') {
      // 冲刺攻击：起手一道白色速度线
      g.strokeStyle = 'rgba(255,255,255,0.7)'
      g.lineWidth = 2.6 * s
      g.beginPath()
      g.moveTo(a.x - 34 * s, a.y + 10 * s)
      g.lineTo(a.x + 18 * s, a.y + 10 * s)
      g.stroke()
    } else if (ev.type === 'platformbreak') {
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2
        g.fillStyle = 'rgba(190,160,120,0.75)'
        g.fillRect(
          a.x + Math.cos(ang) * 20 * s,
          a.y + Math.sin(ang) * 8 * s,
          5 * s,
          5 * s,
        )
      }
    } else if (ev.type === 'hazard') {
      cam.shake = Math.max(cam.shake, 5)
    }
    void s
  }
}

function drawComboText(g: CanvasRenderingContext2D, w: World) {
  for (const f of w.fighters) {
    if (f.combo < 2) continue
    const a = w2s(f.x, f.y)
    g.font = `800 ${Math.min(30, 20 + f.combo * 1.5) * cam.zoom}px system-ui, sans-serif`
    g.textAlign = 'center'
    g.lineWidth = 4
    g.strokeStyle = '#0b0f16'
    g.strokeText(`${f.combo} HIT`, a.x, a.y - 120 * cam.zoom)
    g.fillStyle = f.combo >= 5 ? '#ff8a1f' : '#ffd84d'
    g.fillText(`${f.combo} HIT`, a.x, a.y - 120 * cam.zoom)
    g.textAlign = 'left'
  }
}

/* ============================================================
 * 主循环
 * ============================================================ */

function loop(now: number) {
  raf = requestAnimationFrame(loop)
  if (!last) last = now
  const delta = Math.min(now - last, 250)
  last = now

  if (paused.value) return

  const t0 = performance.now()
  acc += delta
  let steps = 0
  while (acc >= C.STEP_MS && steps < 4 && !world.value.over) {
    const inputs: [InputState, InputState] = [emptyInput(), emptyInput()]
    if (match.mode === 'local') {
      inputs[0] = keyboard.read(0)
      inputs[1] = keyboard.read(1)
    } else {
      inputs[0] = keyboard.read(0)
      inputs[1] = ai.think(world.value.fighters[1], world.value.fighters[0])
    }
    step(world.value, inputs)
    acc -= C.STEP_MS
    steps++
  }
  if (acc > C.STEP_MS * 4) {
    droppedSteps += Math.floor(acc / C.STEP_MS)
    acc = 0
  }
  const t1 = performance.now()

  updateCamera(world.value, delta)
  draw()

  const t2 = performance.now()
  simMs += (t1 - t0 - simMs) * 0.15
  drawMs += (t2 - t1 - drawMs) * 0.15
  frameMs += (t2 - t0 - frameMs) * 0.15

  frames++
  if (frames % 6 === 0) {
    const w = world.value
    const f0 = w.fighters[0]
    hud.value = {
      dmg: [f0.damage, w.fighters[1].damage],
      stocks: [f0.stocks, w.fighters[1].stocks],
      shield: [f0.shield, w.fighters[1].shield],
      cd: [cdPctOf(f0, 0), cdPctOf(f0, 1)],
      specialNames,
      lastMove: moveNameOf(f0) === '—' ? '准备战斗' : moveNameOf(f0),
      dash: f0.dashCd <= 0 ? 100 : Math.max(0, 100 - (f0.dashCd / dashCdOf(f0)) * 100),
      time: Math.ceil(w.timeLeft / 60),
    }
    // shallowRef 原地改动不会触发 computed，这两个必须手动同步
    overFlag.value = w.over
    frameNo.value = w.endFrame >= 0 ? w.endFrame : w.frame
  }

  if (showDebug.value && frames % 6 === 0) {
    const w = world.value
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number } }
    debugStats.value = {
      fps: fpsValue,
      frameMs,
      simMs,
      drawMs,
      dropped: droppedSteps,
      logicFrame: w.frame,
      canvasW: debugStats.value.canvasW,
      canvasH: debugStats.value.canvasH,
      dpr: debugStats.value.dpr,
      scale: debugStats.value.scale,
      viewW: debugStats.value.viewW,
      viewH: debugStats.value.viewH,
      heapMB: perf.memory ? perf.memory.usedJSHeapSize / 1048576 : null,
      camX: cam.x,
      camY: cam.y,
      camZoom: cam.zoom,
      projectiles: w.projectiles.length,
      checksum: checksumHex(w),
      fighters: [
        toStat(w.fighters[0], charA.displayName),
        toStat(w.fighters[1], charB.displayName),
      ],
    }
  }

  if (now - fpsAt > 500) {
    fpsValue = Math.round((frames * 1000) / (now - fpsAt))
    frames = 0
    fpsAt = now
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Backquote') {
    e.preventDefault()
    showDebug.value = !showDebug.value
    return
  }
  if (e.code === 'Escape') {
    e.preventDefault()
    if (world.value.over) return
    paused.value = !paused.value
  }
}

onMounted(() => {
  resize()
  keyboard.attach()
  ai.setDelay(AI_DELAY.value)
  window.addEventListener('resize', resize)
  window.addEventListener('keydown', onKeyDown)
  fpsAt = performance.now()
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  keyboard.detach()
  window.removeEventListener('resize', resize)
  window.removeEventListener('keydown', onKeyDown)
})

/* ---------- HUD 辅助 ---------- */
function dmgColor(d: number): string {
  if (d >= 150) return 'var(--dmg-3)'
  if (d >= 100) return 'var(--dmg-2)'
  if (d >= 50) return 'var(--dmg-1)'
  return 'var(--dmg-0)'
}

function shieldOrbPx(s: number): number {
  const ratio = Math.max(0, Math.min(1, s / C.SHIELD_MAX))
  return 7 + ratio * 17
}

/** 某个必杀槽就绪百分比（0–100），槽里有多条变体时取该槽最大冷却 */
function cdPctOf(f: World['fighters'][0], slot: 0 | 1): number {
  const cd = f.cooldown[slot]
  if (cd <= 0) return 100
  let maxCd = 1
  for (const s of f.char.specials) {
    if (s.slot === slot && s.cooldown > maxCd) maxCd = s.cooldown
  }
  return Math.max(0, Math.min(100, 100 - (cd / maxCd) * 100))
}

function dashCdOf(f: World['fighters'][0]): number {
  return Math.max(1, f.char.dashCooldown ?? C.DASH_COOLDOWN)
}

function restart() {
  world.value = createWorld(charA, charB, stage)
  droppedSteps = 0
  simMs = 0
  drawMs = 0
  frameMs = 0
  acc = 0
  last = 0
  cam.init = false
  cam.zoomTarget = 1
  cam.shake = 0
  paused.value = false
  overFlag.value = false
  frameNo.value = 0
}

function toCharSelect() {
  match.reset()
  router.push({ name: 'char-select' })
}

function goResult() {
  router.push({ name: 'result', params: { matchId: props.matchId } })
}

function quit() {
  router.push({ name: 'menu' })
}

const modeLabel = computed(
  () => ({ local: '本地双人', ai: '人机对战', online: '在线对战' })[match.mode],
)
</script>

<template>
  <LogicalViewport>
    <div class="battle">
      <canvas ref="canvasRef" class="screen" />

      <!-- ================= HUD（大乱斗式：底部两角 + 顶部计时） ================= -->
      <div class="hud">
        <!-- 计时：顶部正中，最小化 -->
        <div class="timer">
          <span class="tnum" :class="{ urgent: hud.time <= 30 }">{{ hud.time }}</span>
          <span class="match-state">{{ hud.lastMove }}</span>
        </div>

        <!-- P1：左下角 -->
        <div class="ppanel p1">
          <div class="avatar" :style="{ background: charA.color }">
            <img
              v-if="iconA"
              class="avimg"
              :src="iconA"
              :alt="charA.displayName"
              decoding="async"
              draggable="false"
            />
            <template v-else>{{ charA.displayName.slice(0, 1) }}</template>
          </div>
          <div class="pinfo">
            <div class="pname">P1 · {{ charA.displayName }}</div>
            <div class="prow">
              <span
                class="dmg"
                :style="{ color: dmgColor(hud.dmg[0]) }"
                :class="{ hot: hud.dmg[0] >= 100 }"
              >
                {{ hud.dmg[0].toFixed(0) }}<i>%</i>
              </span>
              <div class="orb" :class="{ low: hud.shield[0] < C.SHIELD_MAX * 0.25 }">
                <div
                  class="ball"
                  :style="{ width: shieldOrbPx(hud.shield[0]) + 'px', height: shieldOrbPx(hud.shield[0]) + 'px' }"
                />
              </div>
            </div>
            <div class="stocks">
              <i v-for="n in C.STOCKS" :key="n" :class="{ off: n > hud.stocks[0] }" />
            </div>
          </div>
        </div>

        <!-- P2：右下角 -->
        <div class="ppanel p2">
          <div class="pinfo right">
            <div class="pname">{{ charB.displayName }} · P2</div>
            <div class="prow right">
              <span
                class="dmg"
                :style="{ color: dmgColor(hud.dmg[1]) }"
                :class="{ hot: hud.dmg[1] >= 100 }"
              >
                {{ hud.dmg[1].toFixed(0) }}<i>%</i>
              </span>
              <div class="orb" :class="{ low: hud.shield[1] < C.SHIELD_MAX * 0.25 }">
                <div
                  class="ball"
                  :style="{ width: shieldOrbPx(hud.shield[1]) + 'px', height: shieldOrbPx(hud.shield[1]) + 'px' }"
                />
              </div>
            </div>
            <div class="stocks right">
              <i v-for="n in C.STOCKS" :key="n" :class="{ off: n > hud.stocks[1] }" />
            </div>
          </div>
          <div class="avatar" :style="{ background: charB.color }">
            <img
              v-if="iconB"
              class="avimg"
              :src="iconB"
              :alt="charB.displayName"
              decoding="async"
              draggable="false"
            />
            <template v-else>{{ charB.displayName.slice(0, 1) }}</template>
          </div>
        </div>
      </div>

      <!-- 必杀冷却 + 冲刺冷却：贴底部中央，只显示 P1 -->
      <div class="cdex">
        <div class="cdside">
          <span class="cdlab" :class="{ ready: hud.cd[0] >= 100 }">U · {{ hud.specialNames[0] }}</span>
          <div class="cdtrack"><i :style="{ width: hud.cd[0] + '%' }" /></div>
        </div>
        <div class="cdside">
          <span class="cdlab" :class="{ ready: hud.cd[1] >= 100 }">I · {{ hud.specialNames[1] }}</span>
          <div class="cdtrack"><i :style="{ width: hud.cd[1] + '%' }" /></div>
        </div>
        <div class="cdside">
          <span class="cdlab dash" :class="{ ready: hud.dash >= 100 }">L</span>
          <div class="cdtrack dash"><i :style="{ width: hud.dash + '%' }" /></div>
        </div>
      </div>

      <!-- 操作提示：只在开局 8 秒内显示，之后自动淡出 -->
      <Transition name="fade">
        <div v-if="frameNo < 480 && !showResult" class="keys">
          <span><kbd>A</kbd><kbd>D</kbd> 移动</span>
          <span><kbd>K</kbd> 跳</span>
          <span><kbd>J</kbd> 攻击</span>
          <span><kbd>L</kbd> 冲刺</span>
          <span><kbd>U</kbd> {{ charA.specials.find((sp) => (sp.slot ?? 0) === 0 && !sp.dir)?.name ?? '技能一' }}</span>
          <span><kbd>I</kbd> {{ charA.specials.find((sp) => (sp.slot ?? 0) === 1 && !sp.dir)?.name ?? '技能二' }}</span>
          <span><kbd>S</kbd> 蹲防</span>
          <span class="dim">方向 + <kbd>J</kbd> = 八方向招式</span>
          <span class="dim">方向 + <kbd>L</kbd> = 空中冲刺复归</span>
          <span class="dim">冲刺中 + <kbd>J</kbd> = 冲刺攻击</span>
          <span class="dim">摸到台边自动抓 · <kbd>K</kbd> 上爬</span>
          <span class="dim"><kbd>~</kbd> 参数</span>
        </div>
      </Transition>

      <div class="topright">
        <button class="mini" @click="paused = !paused">{{ paused ? '继续' : '暂停' }}</button>
        <button class="mini" @click="quit">退出</button>
      </div>

      <Transition name="fade">
        <DebugPanel v-if="showDebug" :stats="debugStats" />
      </Transition>

      <WinOverlay
        v-if="showResult"
        :winner="(world.winner ?? 0) as 0 | 1"
        :stats="overStats"
        :mode-label="modeLabel ?? ''"
        @again="restart"
        @switch-char="toCharSelect"
        @detail="goResult"
        @quit="quit"
      />

      <Transition name="fade">
        <div v-if="paused && !showResult" class="pausewrap">
          <div class="pausebox">
            <p class="plab">PAUSED</p>
            <p class="phint">按 <kbd>Esc</kbd> 继续</p>
            <div class="pbtns">
              <button class="pbtn primary" @click="paused = false">继续</button>
              <button class="pbtn" @click="quit">退出对局</button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </LogicalViewport>
</template>

<script lang="ts">
export default { name: 'BattleView' }
</script>

<style scoped>
.battle {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}

.screen {
  position: absolute;
  inset: 0;
  display: block;
}

/* ================= HUD ================= */
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 计时：顶部正中一小块，不抢视野 */
.timer {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  place-items: center;
  min-width: 78px;
  height: 54px;
  grid-template-rows: 1fr auto;
  padding: 0 14px;
  background: rgba(5, 6, 10, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  backdrop-filter: blur(2px);
}

.match-state {
  max-width: 180px;
  overflow: hidden;
  color: rgba(245, 247, 250, 0.65);
  font-size: 9px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tnum {
  font-family: var(--font-num);
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
  color: rgba(245, 247, 250, 0.92);
  text-shadow: 2px 2px 0 var(--ink);
  transition: color 200ms linear;
}

.tnum.urgent {
  color: var(--danger);
  animation: urgent 600ms steps(2, end) infinite;
}

@keyframes urgent {
  50% {
    opacity: 0.45;
  }
}

/* 玩家面板：底部两角，模仿大乱斗 */
.ppanel {
  position: absolute;
  bottom: 18px;
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.ppanel.p1 {
  left: 20px;
}

.ppanel.p2 {
  right: 20px;
}

.avatar {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  border: 2px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
  font-size: 20px;
  font-weight: 800;
  color: #fff;
  text-shadow: 0 2px 5px rgba(0, 0, 0, 0.7);
  flex: none;
  overflow: hidden;
}

/* 头像图：铺满方块、顶部对齐（立绘是 3:5，52px 宽只有一半高度可露出脸和肩） */
.avimg {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 18%;
  user-select: none;
}

.pinfo {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-bottom: 2px;
}

.pinfo.right {
  align-items: flex-end;
}

.pname {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: rgba(245, 247, 250, 0.62);
  text-shadow: 1px 1px 0 var(--ink);
  white-space: nowrap;
}

.prow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prow.right {
  flex-direction: row-reverse;
}

.dmg {
  font-family: var(--font-num);
  font-size: 40px;
  font-weight: 800;
  line-height: 0.95;
  letter-spacing: -0.03em;
  text-shadow:
    3px 3px 0 var(--ink),
    0 0 12px rgba(0, 0, 0, 0.5);
  transition: color 140ms linear;
}

.dmg.hot {
  animation: dmgpop 200ms var(--ease-out-soft);
}

@keyframes dmgpop {
  50% {
    transform: scale(1.12);
  }
}

.dmg i {
  font-size: 0.45em;
  font-style: normal;
  opacity: 0.72;
  margin-left: 1px;
}

/* 盾球 */
.orb {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
}

.ball {
  border-radius: 50%;
  background: radial-gradient(circle at 32% 30%, #bfdbfe 0%, #60a5fa 55%, #2563eb 100%);
  box-shadow:
    0 0 6px rgba(96, 165, 250, 0.55),
    inset 0 0 4px rgba(255, 255, 255, 0.35);
  transition:
    width 90ms linear,
    height 90ms linear;
}

.orb.low .ball {
  background: radial-gradient(circle at 32% 30%, #fecaca 0%, #ff8a1f 55%, #b91c1c 100%);
  box-shadow: 0 0 8px rgba(255, 59, 48, 0.7);
  animation: shieldpulse 480ms steps(2, end) infinite;
}

@keyframes shieldpulse {
  50% {
    opacity: 0.45;
  }
}

.stocks {
  display: flex;
  gap: 3px;
  margin-top: 1px;
}

.stocks.right {
  justify-content: flex-end;
}

.stocks i {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 5px rgba(168, 232, 92, 0.5);
  transition:
    background 160ms linear,
    box-shadow 160ms linear;
}

.stocks i.off {
  background: rgba(255, 255, 255, 0.14);
  box-shadow: none;
}

/* 必杀冷却 */
.cdex {
  position: absolute;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 18px;
  padding: 8px 14px;
  background: rgba(5, 6, 10, 0.52);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  backdrop-filter: blur(5px);
  pointer-events: none;
  opacity: 0.75;
}

.cdside {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 168px;
}

.cdlab {
  font-family: var(--font-mono);
  font-size: 10px;
  max-width: 118px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  color: var(--fg-2);
}

.cdlab.ready {
  color: var(--brand);
  text-shadow: 0 0 6px rgba(168, 232, 92, 0.6);
}

.cdtrack {
  width: 46px;
  height: 4px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  overflow: hidden;
}

.cdtrack i {
  display: block;
  height: 100%;
  background: var(--brand);
  transition: width 90ms linear;
}

/* 操作提示 */
.keys {
  position: absolute;
  left: 50%;
  top: 78px;
  transform: translateX(-50%);
  display: flex;
  gap: 14px;
  padding: 6px 14px;
  font-size: 11px;
  color: rgba(245, 247, 250, 0.78);
  background: rgba(5, 6, 10, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  white-space: nowrap;
}

.keys .dim {
  color: var(--fg-2);
}

kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  margin: 0 1px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-1);
  background: rgba(34, 43, 58, 0.92);
  border: 1px solid var(--line-strong);
  border-radius: 3px;
}

.topright {
  position: absolute;
  top: 14px;
  right: 18px;
  display: flex;
  gap: 6px;
}

.mini {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--fg-1);
  background: rgba(5, 6, 10, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  transition: background var(--t-fast) var(--ease-standard);
}

.mini:hover {
  background: var(--bg-3);
  color: var(--fg-0);
}

/* 暂停 */
.pausewrap {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(5, 6, 10, 0.72);
  backdrop-filter: blur(8px);
}

.pausebox {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-width: 300px;
  padding: 36px 44px;
  background: rgba(15, 20, 29, 0.95);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.65);
}

.plab {
  margin: 0;
  font-family: var(--font-num);
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.14em;
  color: var(--fg-0);
}

.phint {
  margin: 0;
  font-size: 13px;
  color: var(--fg-2);
}

.pbtns {
  display: flex;
  gap: 10px;
}

.pbtn {
  height: 40px;
  padding: 0 22px;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-1);
  background: var(--bg-2);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
}

.pbtn:hover {
  background: var(--bg-3);
  color: var(--fg-0);
}

.pbtn.primary {
  color: var(--brand-ink);
  background: var(--brand);
  border-color: transparent;
}

.pbtn.primary:hover {
  background: color-mix(in srgb, var(--brand) 88%, white);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--t-mid) var(--ease-standard);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
