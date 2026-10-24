<script setup lang="ts">
/**
 * 对局结束浮层。
 *
 * 按 docs/04-ui-art.md §4 的结算节奏：
 *   遮罩淡入 300ms → 胜负字 scale 1.4→1.0（18 帧阶跃）→ 数据行错开 60ms → 按钮
 *
 * 键盘可操作（Enter 再来一局 / Esc 退出），鼠标也能点。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/** 结算卡片需要的最小字段集，与 DebugPanel 的 FighterStat 解耦 */
interface OverFighter {
  name: string
  color: string
  stocks: number
  dealt: number
  maxComboTaken: number
  shield: number
  /** 被击倒次数 */
  knockdowns: number
}

export interface OverStats {
  p1: OverFighter
  p2: OverFighter
  elapsedSec: number
  frame: number
  reason: string
}

const props = defineProps<{
  winner: 0 | 1
  stats: OverStats
  modeLabel: string
}>()

const emit = defineEmits<{
  (e: 'again'): void
  (e: 'switchChar'): void
  (e: 'detail'): void
  (e: 'quit'): void
}>()

/** 0=遮罩 1=胜负字 2=数据 3=按钮 */
const phase = ref(0)
let timers: number[] = []

const isWin = computed(() => props.winner === 0)
const winName = computed(() =>
  props.winner === 0 ? props.stats.p1.name : props.stats.p2.name,
)

function skip() {
  timers.forEach((t) => window.clearTimeout(t))
  timers = []
  phase.value = 3
}

onMounted(() => {
  timers.push(window.setTimeout(() => (phase.value = 1), 220))
  timers.push(window.setTimeout(() => (phase.value = 2), 480))
  timers.push(window.setTimeout(() => (phase.value = 3), 760))
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  timers.forEach((t) => window.clearTimeout(t))
  window.removeEventListener('keydown', onKey)
})

function onKey(e: KeyboardEvent) {
  if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
    e.preventDefault()
    if (phase.value < 3) skip()
    else emit('again')
  } else if (e.code === 'Escape') {
    e.preventDefault()
    if (phase.value < 3) skip()
    else emit('quit')
  }
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}
</script>

<template>
  <div class="win" @click.self="skip">
    <!-- 背景光晕 -->
    <div class="glow" :class="{ lose: !isWin }" />

    <!-- 胜负字 -->
    <div class="hero" :class="{ show: phase >= 1, lose: !isWin }">
      <p class="vs">{{ modeLabel }}</p>
      <h2 class="word">{{ isWin ? 'VICTORY' : 'DEFEAT' }}</h2>
      <p class="who">{{ isWin ? '胜 利' : '败 北' }}</p>
    </div>

    <!-- 数据 -->
    <div class="cards" :class="{ show: phase >= 2 }">
      <div class="card" :class="{ win: winner === 0 }">
        <div class="chead">
          <i class="sw" :style="{ background: stats.p1.color }" />
          <b>{{ stats.p1.name }}</b>
          <span v-if="winner === 0" class="badge">WIN</span>
        </div>
        <div class="crow"><span>剩余命数</span><b>{{ stats.p1.stocks }}</b></div>
        <div class="crow"><span>总伤害</span><b>{{ stats.p1.dealt.toFixed(0) }}%</b></div>
        <div class="crow"><span>最高连击</span><b>{{ stats.p1.maxComboTaken }}</b></div>
        <div class="crow"><span>被击倒</span><b>{{ stats.p1.knockdowns }} 次</b></div>
        <div class="crow"><span>残余盾值</span><b>{{ stats.p1.shield.toFixed(0) }}</b></div>
      </div>

      <div class="vsdiv">VS</div>

      <div class="card" :class="{ win: winner === 1 }">
        <div class="chead">
          <i class="sw" :style="{ background: stats.p2.color }" />
          <b>{{ stats.p2.name }}</b>
          <span v-if="winner === 1" class="badge">WIN</span>
        </div>
        <div class="crow"><span>剩余命数</span><b>{{ stats.p2.stocks }}</b></div>
        <div class="crow"><span>总伤害</span><b>{{ stats.p2.dealt.toFixed(0) }}%</b></div>
        <div class="crow"><span>最高连击</span><b>{{ stats.p2.maxComboTaken }}</b></div>
        <div class="crow"><span>被击倒</span><b>{{ stats.p2.knockdowns }} 次</b></div>
        <div class="crow"><span>残余盾值</span><b>{{ stats.p2.shield.toFixed(0) }}</b></div>
      </div>
    </div>

    <p class="meta" :class="{ show: phase >= 2 }">
      {{ winName }} 获胜 · {{ stats.reason }} · 用时 {{ fmtTime(stats.elapsedSec) }}
      · {{ stats.frame }} 帧
    </p>

    <!-- 按钮 -->
    <div class="btns" :class="{ show: phase >= 3 }">
      <button class="btn primary" @click="emit('again')">
        <span>再来一局</span><kbd>Enter</kbd>
      </button>
      <button class="btn" @click="emit('switchChar')">换角色</button>
      <button class="btn" @click="emit('detail')">查看结算</button>
      <button class="btn" @click="emit('quit')">
        <span>退出</span><kbd>Esc</kbd>
      </button>
    </div>

    <p class="tip" :class="{ show: phase >= 3 }">点击任意处跳过动画</p>
  </div>
</template>

<style scoped>
.win {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-5);
  background: rgba(5, 6, 10, 0.82);
  backdrop-filter: blur(8px);
  animation: fadein 300ms var(--ease-standard) both;
  z-index: 30;
}

.glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    60% 50% at 50% 42%,
    rgba(168, 232, 92, 0.16) 0%,
    rgba(168, 232, 92, 0) 70%
  );
  pointer-events: none;
}

.glow.lose {
  background: radial-gradient(
    60% 50% at 50% 42%,
    rgba(255, 59, 48, 0.15) 0%,
    rgba(255, 59, 48, 0) 70%
  );
}

/* ---- 胜负字 ---- */
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  opacity: 0;
  transform: scale(1.4);
  transition:
    opacity 180ms var(--ease-out-soft),
    transform 260ms steps(3, end);
}

.hero.show {
  opacity: 1;
  transform: scale(1);
}

.vs {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.32em;
  color: var(--fg-2);
}

.word {
  margin: 0;
  font-family: var(--font-num);
  font-size: 104px;
  font-weight: 800;
  line-height: 0.92;
  letter-spacing: 0.02em;
  color: var(--brand);
  text-shadow:
    0 0 40px rgba(168, 232, 92, 0.45),
    5px 5px 0 var(--ink);
}

.hero.lose .word {
  color: var(--danger);
  text-shadow:
    0 0 40px rgba(255, 59, 48, 0.4),
    5px 5px 0 var(--ink);
}

.who {
  margin: 2px 0 0;
  font-size: var(--fs-h3);
  font-weight: 700;
  letter-spacing: 0.4em;
  color: var(--fg-1);
}

/* ---- 数据卡 ---- */
.cards {
  display: flex;
  align-items: stretch;
  gap: var(--s-4);
  opacity: 0;
  transform: translateY(10px);
  transition:
    opacity 200ms var(--ease-out-soft),
    transform 200ms var(--ease-out-soft);
}

.cards.show {
  opacity: 1;
  transform: none;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 236px;
  padding: var(--s-4);
  background: rgba(15, 20, 29, 0.9);
  border: 1px solid var(--line);
  border-radius: var(--r-3);
}

.card.win {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px rgba(168, 232, 92, 0.35) inset;
}

.chead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 5px;
  margin-bottom: 3px;
  border-bottom: 1px solid var(--line);
}

.chead b {
  font-size: var(--fs-body);
  color: var(--fg-0);
}

.sw {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex: none;
}

.badge {
  margin-left: auto;
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--brand-ink);
  background: var(--brand);
  border-radius: 2px;
}

.crow {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-small);
}

.crow span {
  color: var(--fg-2);
}

.crow b {
  font-family: var(--font-num);
  color: var(--fg-0);
}

.vsdiv {
  align-self: center;
  font-family: var(--font-num);
  font-size: 14px;
  font-weight: 800;
  color: var(--fg-2);
}

.meta {
  margin: 0;
  font-size: var(--fs-small);
  color: var(--fg-2);
  opacity: 0;
  transition: opacity 200ms var(--ease-out-soft);
}

.meta.show {
  opacity: 1;
}

/* ---- 按钮 ---- */
.btns {
  display: flex;
  gap: var(--s-3);
  opacity: 0;
  transition: opacity 200ms var(--ease-out-soft);
}

.btns.show {
  opacity: 1;
  pointer-events: auto;
}

.btns {
  pointer-events: none;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  height: 44px;
  min-width: 132px;
  justify-content: center;
  padding: 0 var(--s-5);
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--fg-1);
  background: var(--bg-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-2);
  transition:
    background var(--t-fast) var(--ease-standard),
    color var(--t-fast) var(--ease-standard);
}

.btn:hover {
  background: var(--bg-3);
  color: var(--fg-0);
}

.btn.primary {
  color: var(--brand-ink);
  background: var(--brand);
  border-color: var(--brand);
}

.btn.primary:hover {
  background: color-mix(in srgb, var(--brand) 86%, white);
}

.btn kbd {
  padding: 0 4px;
  font-family: var(--font-mono);
  font-size: 9px;
  color: inherit;
  opacity: 0.6;
  border: 1px solid currentColor;
  border-radius: 2px;
}

.tip {
  position: absolute;
  bottom: 18px;
  margin: 0;
  font-size: 10px;
  color: var(--fg-2);
  opacity: 0;
  transition: opacity 300ms;
}

.tip.show {
  opacity: 0.6;
}

@keyframes fadein {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
