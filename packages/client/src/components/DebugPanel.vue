<script setup lang="ts">
/**
 * 调试面板（按 ~ 键开合）。
 *
 * 只读：所有数据由 BattleView 采样后传进来，这里不碰 world。
 *
 * 关于「CPU / GPU 占用率」：浏览器**不提供**进程级 CPU 或 GPU 利用率，
 * 任何声称能读到的都是猜的。这里给的是能真实测到、且对调优更有用的东西：
 *   - 模拟耗时 / 渲染耗时（每帧，EMA 平滑）—— 这两项就是 CPU 花掉的时间
 *   - 帧预算占比 —— 16.67ms 里用掉了多少
 *   - 渲染耗时可以当 GPU 的代理指标（Canvas2D 的绘制在 GPU 侧合成）
 * 面板里会明确标注「代理」二字，不假装是真实占用率。
 */
import { computed } from 'vue'

export interface FighterStat {
  name: string
  color: string
  x: number
  y: number
  vx: number
  vy: number
  state: string
  facing: number
  damage: number
  stocks: number
  shield: number
  shieldMax: number
  combo: number
  maxComboTaken: number
  hitstun: number
  hitlag: number
  invincible: number
  jumpsLeft: number
  onGround: boolean
  attackDir: string
  attackFrame: number
  dealt: number
  /** 被击倒次数 */
  knockdowns: number
  /** 冲刺剩余冷却帧、当前冲刺剩余帧 */
  dashCd: number
  dashTimer: number
  /** 剩余空中冲刺次数 */
  airDashes: number
  /** 场外复归冲刺剩余次数（每回合 1 次） */
  recoveryDashes: number
  /** 是否正挂在台边 */
  onLedge: boolean
  /** 上爬剩余帧 */
  climbTimer: number
  /** 当前招式名（普通招式或必杀名） */
  moveName: string
}

export interface DebugStats {
  fps: number
  frameMs: number
  simMs: number
  drawMs: number
  dropped: number
  logicFrame: number
  /** 画布实际像素尺寸 */
  canvasW: number
  canvasH: number
  dpr: number
  scale: number
  viewW: number
  viewH: number
  heapMB: number | null
  /** 相机（世界坐标中心）与缩放 */
  camX: number
  camY: number
  camZoom: number
  /** 场上投射物数量 */
  projectiles: number
  /**
   * 模拟状态校验和（8 位十六进制）。
   * 联机调试时这是唯一能一眼看出「两边已经跑岔了」的东西——
   * 它进了快照的每一个影响下一帧的字段（不含渲染用的 px/py / flash / events）。
   */
  checksum: string
  fighters: [FighterStat, FighterStat]
}

const props = defineProps<{ stats: DebugStats }>()

const budget = computed(() => (props.stats.frameMs / 16.667) * 100)

function bar(pct: number): string {
  const n = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return '█'.repeat(n) + '░'.repeat(10 - n)
}

function budgetColor(): string {
  const p = budget.value
  if (p > 90) return 'var(--danger)'
  if (p > 70) return 'var(--warn)'
  return 'var(--brand)'
}

function num(v: number, d = 1): string {
  return v.toFixed(d)
}

function pad(v: string, n: number): string {
  return v.length >= n ? v : v + ' '.repeat(n - v.length)
}

/** 招式名过长时截断，保持面板宽度稳定 */
function shortMove(v: string): string {
  return v.length > 10 ? v.slice(0, 9) + '…' : pad(v, 10)
}
</script>

<template>
  <div class="dbg">
    <div class="dbghead">
      <span class="dot" />
      <b>DEBUG</b>
      <span class="hint">~ 关闭</span>
    </div>

    <!-- 画面 -->
    <div class="sec">
      <p class="st">画面</p>
      <div class="row"><span>视口</span><b>{{ stats.viewW }} × {{ stats.viewH }}</b></div>
      <div class="row"><span>画布</span><b>{{ stats.canvasW }} × {{ stats.canvasH }}</b></div>
      <div class="row"><span>DPR / 缩放</span><b>{{ num(stats.dpr, 2) }} / {{ num(stats.scale, 3) }}</b></div>
      <div class="row"><span>相机 x/y</span><b>{{ num(stats.camX, 0) }} / {{ num(stats.camY, 0) }}</b></div>
      <div class="row"><span>相机 zoom</span><b>{{ num(stats.camZoom, 3) }}</b></div>
    </div>

    <!-- 帧 -->
    <div class="sec">
      <p class="st">帧</p>
      <div class="row"><span>FPS</span><b class="big">{{ stats.fps }}</b></div>
      <div class="row">
        <span>帧耗时</span>
        <b :style="{ color: budgetColor() }">{{ num(stats.frameMs, 2) }} ms</b>
      </div>
      <div class="row">
        <span>预算占用</span>
        <b :style="{ color: budgetColor() }">{{ num(budget, 0) }}%</b>
      </div>
      <div class="barbar" :style="{ color: budgetColor() }">{{ bar(budget) }}</div>
      <div class="row"><span>模拟 (CPU)</span><b>{{ num(stats.simMs, 3) }} ms</b></div>
      <div class="row"><span>渲染 (GPU 代理)</span><b>{{ num(stats.drawMs, 3) }} ms</b></div>
      <div class="row">
        <span>掉帧</span>
        <b :style="{ color: stats.dropped > 0 ? 'var(--warn)' : 'var(--fg-1)' }">{{ stats.dropped }}</b>
      </div>
      <div class="row"><span>逻辑帧</span><b>{{ stats.logicFrame }}</b></div>
      <div class="row"><span>投射物</span><b>{{ stats.projectiles }}</b></div>
      <div class="row"><span>校验和</span><b class="cs">{{ stats.checksum }}</b></div>
      <div class="row">
        <span>JS 堆</span>
        <b>{{ stats.heapMB === null ? '不可用' : num(stats.heapMB, 1) + ' MB' }}</b>
      </div>
    </div>

    <!-- 双方 -->
    <div class="sec">
      <p class="st">角色</p>
      <div v-for="(f, i) in stats.fighters" :key="i" class="fighter" :style="{ borderColor: f.color }">
        <div class="fname">
          <i class="sw" :style="{ background: f.color }" />
          <b>{{ f.name }}</b>
          <span class="fstate">{{ f.state }}</span>
        </div>
        <div class="grid">
          <span>x/y</span><b>{{ num(f.x, 0) }} / {{ num(f.y, 0) }}</b>
          <span>vx/vy</span><b>{{ num(f.vx, 2) }} / {{ num(f.vy, 2) }}</b>
          <span>伤害</span><b>{{ num(f.damage, 1) }}%</b>
          <span>命数</span><b>{{ f.stocks }}</b>
          <span>盾值</span>
          <b>{{ num(f.shield, 1) }}/{{ f.shieldMax }}</b>
          <span>连击</span><b>{{ f.combo }} <em>（最高吃 {{ f.maxComboTaken }}）</em></b>
          <span>击倒</span><b>{{ f.knockdowns }} 次</b>
          <span>硬直</span><b>{{ f.hitstun }} 帧</b>
          <span>顿帧</span><b>{{ f.hitlag }} 帧</b>
          <span>无敌</span><b>{{ f.invincible }} 帧</b>
          <span>跳跃</span><b>{{ f.jumpsLeft }} <em>{{ f.onGround ? '地面' : '空中' }}</em></b>
          <span>朝向</span><b>{{ f.facing > 0 ? '右' : '左' }}</b>
          <span>冲刺</span>
          <b>
            {{ f.dashTimer > 0 ? '冲刺中 ' + f.dashTimer + 'f' : '冷却 ' + f.dashCd + 'f' }}
            <em>（空冲 {{ f.airDashes }} · 复归 {{ f.recoveryDashes }}）</em>
          </b>
          <span>抓边</span>
          <b>{{ f.onLedge ? (f.climbTimer > 0 ? '上爬 ' + f.climbTimer + 'f' : '悬挂') : '—' }}</b>
          <span>招式</span>
          <b>{{ f.attackFrame < 0 ? '—' : shortMove(f.moveName) + ' f' + f.attackFrame }}</b>
          <span>输出</span><b>{{ num(f.dealt, 0) }}%</b>
        </div>
      </div>
    </div>

    <p class="foot">
      浏览器不暴露真实 CPU/GPU 占用率，上面「模拟/渲染耗时」是能测到的部分，
      渲染耗时作 GPU 代理。
    </p>
  </div>
</template>

<style scoped>
.dbg {
  position: absolute;
  top: var(--s-4);
  right: var(--s-4);
  width: 306px;
  max-height: 660px;
  overflow-y: auto;
  padding: var(--s-3);
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--fg-1);
  background: rgba(5, 6, 10, 0.93);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-2);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  pointer-events: none;
  z-index: 20;
  scrollbar-width: thin;
}

.dbghead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 4px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--line);
  color: var(--brand);
  letter-spacing: 0.1em;
}

.dbghead b {
  font-size: 11px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 6px var(--brand);
}

.hint {
  margin-left: auto;
  color: var(--fg-2);
  font-size: 9px;
  letter-spacing: 0;
}

.sec {
  padding: 4px 0;
  border-bottom: 1px dashed rgba(46, 58, 77, 0.6);
}

.st {
  margin: 0 0 2px;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--fg-2);
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.row span {
  color: var(--fg-2);
}

.row b {
  color: var(--fg-0);
  font-weight: 600;
}

.row b.big {
  font-size: 14px;
  color: var(--brand);
}

.barbar {
  letter-spacing: -0.5px;
  font-size: 10px;
}

.fighter {
  margin-top: 4px;
  padding: 4px 6px;
  border-left: 2px solid;
  background: rgba(22, 29, 41, 0.55);
  border-radius: 0 var(--r-1) var(--r-1) 0;
}

.fname {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 2px;
}

.fname b {
  color: var(--fg-0);
  font-size: 11px;
}

.sw {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: none;
}

.fstate {
  margin-left: auto;
  color: var(--brand);
  font-size: 9px;
}

.grid {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 0 6px;
}

.grid span {
  color: var(--fg-2);
}

.grid b {
  color: var(--fg-0);
  font-weight: 500;
  white-space: pre;
}

.grid em {
  font-style: normal;
  color: var(--fg-2);
}

.foot {
  margin: 5px 0 0;
  font-size: 9px;
  line-height: 1.45;
  color: var(--fg-2);
}
</style>
