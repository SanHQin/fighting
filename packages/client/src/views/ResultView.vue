<script setup lang="ts">
/**
 * 结算页。线框见 docs/04-ui-art.md 第 4 章「结算页」：
 * 胜负字 96px → 两张角色卡 → 段位变化 → 四个按钮。
 * 进场顺序：300ms 遮罩淡入 → 胜负字 scale 1.4→1.0（18 帧阶跃）→ 数据行错开 60ms。
 *
 * 数据来源当前写死 LAST_RESULT；接后端后换成 GET /api/matches/:id。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import HintBar from '@/components/HintBar.vue'
import { useFocusGrid, type FocusItem } from '@/composables/useFocusGrid'
import { useMatchStore } from '@/stores'
import { LAST_RESULT, charById, stageById } from '@/mock/data'

defineProps<{ matchId: string }>()
const router = useRouter()
const match = useMatchStore()

const result = LAST_RESULT
const charA = charById(result.charIds[0])!
const charB = charById(result.charIds[1])!
const stage = stageById(result.stageId)!

const iWin = result.winner === 0

/* ---------------- 阶段动画 ----------------
 * 用 timeout 分段推进而不是纯 CSS animation，
 * 因为「数据行错开 60ms」需要知道第几行，且要能被 skip 跳过。
 */
const phase = ref(0)
const timers: number[] = []

function next(ms: number) {
  timers.push(window.setTimeout(() => (phase.value += 1), ms))
}

onMounted(() => {
  next(300) // 0 → 1 遮罩淡入完成，胜负字出现
  next(300 + 300) // 1 → 2 两张角色卡
  next(300 + 300 + 240) // 2 → 3 数据行
  next(300 + 300 + 240 + 360) // 3 → 4 按钮
})

onBeforeUnmount(() => timers.forEach((t) => clearTimeout(t)))

/** 任意键跳过动画 */
function skip() {
  if (phase.value < 4) {
    timers.forEach((t) => clearTimeout(t))
    phase.value = 4
    return true
  }
  return false
}

/* ---------------- 统计 ---------------- */
const totalFrames = computed(() => result.rounds.reduce((s, r) => s + r.frames, 0))
const durationText = computed(() => {
  const sec = Math.round(totalFrames.value / 60)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

const myStats = computed(() => ({
  stocks: result.rounds[result.rounds.length - 1].stocks[0],
  dmg: result.rounds.reduce((s, r) => s + r.damageDealt[0], 0),
  combo: Math.max(...result.rounds.map((r) => r.bestCombo[0])),
}))

const foeStats = computed(() => ({
  stocks: result.rounds[result.rounds.length - 1].stocks[1],
  dmg: result.rounds.reduce((s, r) => s + r.damageDealt[1], 0),
  combo: Math.max(...result.rounds.map((r) => r.bestCombo[1])),
}))

/* ---------------- 段位变化 ----------------
 * ratingDelta 为 null（本地/人机）时整块不渲染——这是刻意设计：
 * 跟 AI 打完弹一个「+0 分」只会让人以为系统坏了。
 */
const ratingShown = ref(0)
const showRating = computed(() => result.ratingDelta !== null)

onMounted(() => {
  const d = result.ratingDelta
  if (!d) return
  const from = d.before
  const to = d.after
  const dur = 800
  const t0 = performance.now()
  function tick(now: number) {
    const k = Math.min(1, (now - t0) / dur)
    // 与游戏内一致的阶跃缓动：先快后慢，不用 Math 三角函数
    const e = 1 - (1 - k) * (1 - k)
    ratingShown.value = Math.round(from + (to - from) * e)
    if (k < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

/* ---------------- 按钮 ---------------- */
const actions = [
  { id: 'again', label: '再来一局', primary: true },
  { id: 'switch', label: '换角色', primary: false },
  { id: 'save', label: '保存回放', primary: false },
  { id: 'menu', label: '回主菜单', primary: false },
] as const

const items = computed<FocusItem[]>(() =>
  actions.map((a, i) => ({
    id: a.id,
    x: i,
    y: 0,
    onConfirm: () => run(a.id),
  })),
)

const { focusedId, setFocus } = useFocusGrid(items, { initial: 'again' })

function run(id: string) {
  if (id === 'again') {
    router.replace({ name: 'stage-select' })
  } else if (id === 'switch') {
    router.replace({ name: 'char-select' })
  } else if (id === 'save') {
    saved.value = true
  } else {
    match.reset()
    router.replace({ name: 'menu' })
  }
}

const saved = ref(false)

/* 键盘：任意键跳过动画 */
function onKey() {
  skip()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <LogicalViewport :backdrop="false">
    <div class="result" :class="{ win: iWin, lose: !iWin }">
      <!-- 背景色块，胜负两种色温 -->
      <div class="backdrop" aria-hidden="true">
        <div class="glow" />
        <div class="grid" />
      </div>

      <div class="content">
        <!-- 胜负字 -->
        <header class="verdict" :class="{ show: phase >= 1 }">
          <p class="sub">{{ iWin ? 'VICTORY' : 'DEFEAT' }}</p>
          <h1 class="word">{{ iWin ? '胜 利' : '败 北' }}</h1>
          <p class="meta">
            {{ stage.displayName }} · {{ result.rounds.length }} 回合 · {{ durationText }}
          </p>
        </header>

        <!-- 两张角色卡 -->
        <div class="cards" :class="{ show: phase >= 2 }">
          <!-- 我方 -->
          <section class="card mine">
            <div class="who">
              <span class="slot">P1</span>
              <span class="nm">{{ charA.displayName }}</span>
              <span class="tag">{{ charA.weightClass === 'light' ? '轻' : charA.weightClass === 'heavy' ? '重' : '中' }}量级</span>
            </div>
            <div class="stats">
              <div class="row">
                <span>剩余命数</span>
                <b>{{ myStats.stocks }}</b>
              </div>
              <div class="row">
                <span>总伤害</span>
                <b>{{ myStats.dmg }}<i>%</i></b>
              </div>
              <div class="row">
                <span>最大连击</span>
                <b>{{ myStats.combo }}</b>
              </div>
            </div>
          </section>

          <div class="vs" aria-hidden="true">VS</div>

          <!-- 对手 -->
          <section class="card foe">
            <div class="who">
              <span class="slot">P2</span>
              <span class="nm">{{ charB.displayName }}</span>
              <span class="tag">{{ charB.weightClass === 'light' ? '轻' : charB.weightClass === 'heavy' ? '重' : '中' }}量级</span>
            </div>
            <div class="stats">
              <div class="row">
                <span>剩余命数</span>
                <b>{{ foeStats.stocks }}</b>
              </div>
              <div class="row">
                <span>总伤害</span>
                <b>{{ foeStats.dmg }}<i>%</i></b>
              </div>
              <div class="row">
                <span>最大连击</span>
                <b>{{ foeStats.combo }}</b>
              </div>
            </div>
          </section>
        </div>

        <!-- 分回合明细 -->
        <div class="rounds" :class="{ show: phase >= 3 }">
          <div
            v-for="r in result.rounds"
            :key="r.round"
            class="round"
            :class="{ won: r.winner === 0 }"
          >
            <span class="rn">R{{ r.round }}</span>
            <span class="rw">{{ r.winner === 0 ? '我方' : '对手' }}</span>
            <span class="rd">{{ r.damageDealt[0] }} / {{ r.damageDealt[1] }}</span>
          </div>
        </div>

        <!-- 段位变化 -->
        <div v-if="showRating" class="rating" :class="{ show: phase >= 3 }">
          <span class="rl">信誉分</span>
          <span class="rv">{{ ratingShown }}</span>
          <span
            class="rdelta"
            :class="{ up: (result.ratingDelta?.after ?? 0) >= (result.ratingDelta?.before ?? 0) }"
          >
            {{ (result.ratingDelta?.after ?? 0) >= (result.ratingDelta?.before ?? 0) ? '+' : '' }}{{
              (result.ratingDelta?.after ?? 0) - (result.ratingDelta?.before ?? 0)
            }}
          </span>
        </div>

        <!-- 按钮 -->
        <footer class="actions" :class="{ show: phase >= 4 }">
          <button
            v-for="a in actions"
            :key="a.id"
            :class="[
              'ui-btn',
              a.primary ? 'ui-btn-primary' : 'ui-btn-ghost',
              { 'is-focused': focusedId === a.id },
            ]"
            @click="run(a.id)"
            @mouseenter="setFocus(a.id)"
          >
            {{ a.id === 'save' && saved ? '已保存 ✓' : a.label }}
          </button>
        </footer>
      </div>

      <HintBar
        :hints="[
          { key: '←→', label: '选择' },
          { key: 'Enter', label: '确认' },
          { key: 'Esc', label: '回主菜单' },
        ]"
      />
    </div>
  </LogicalViewport>
</template>

<style scoped>
.result {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-0);
}

/* ---------- 背景 ---------- */
.backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.glow {
  position: absolute;
  top: -30%;
  left: 50%;
  width: 1200px;
  height: 900px;
  transform: translateX(-50%);
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.5;
}

.win .glow {
  background: radial-gradient(circle, rgba(168, 232, 92, 0.45) 0%, transparent 62%);
}

.lose .glow {
  background: radial-gradient(circle, rgba(255, 59, 48, 0.32) 0%, transparent 62%);
}

.grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(var(--line) 1px, transparent 1px),
    linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 64px 64px;
  opacity: 0.09;
  mask-image: radial-gradient(circle at 50% 30%, black 0%, transparent 72%);
}

/* ---------- 内容 ---------- */
.content {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-5);
  min-height: 0;
  padding: var(--s-6) var(--s-8) var(--s-4);
}

/* 胜负字 */
.verdict {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transform: scale(1.4);
  transition: opacity 200ms var(--ease-out-soft), transform 300ms var(--ease-out-soft);
}

.verdict.show {
  opacity: 1;
  transform: scale(1);
}

.sub {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.5em;
  text-indent: 0.5em;
  color: var(--fg-2);
}

.word {
  margin: 0;
  font-size: 96px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.08em;
  text-indent: 0.08em;
  text-shadow: 0 6px 0 var(--ink);
}

.win .word {
  color: var(--brand);
}

.lose .word {
  color: var(--danger);
}

.meta {
  margin: 0;
  font-size: var(--fs-tiny);
  color: var(--fg-2);
}

/* 角色卡 */
.cards {
  display: grid;
  grid-template-columns: 1fr 64px 1fr;
  align-items: center;
  gap: var(--s-4);
  width: 100%;
  max-width: 780px;
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 240ms var(--ease-out-soft), transform 240ms var(--ease-out-soft);
}

.cards.show {
  opacity: 1;
  transform: none;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-5);
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: color-mix(in srgb, var(--bg-1) 88%, transparent);
}

.card.mine {
  border-left: 3px solid var(--p1);
}

.card.foe {
  border-right: 3px solid var(--p2);
}

.who {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.card.foe .who {
  justify-content: flex-end;
}

.slot {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--fg-2);
}

.nm {
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--fg-0);
}

.tag {
  padding: 1px 6px;
  font-size: 10px;
  border-radius: var(--r-1);
  color: var(--fg-1);
  background: var(--bg-3);
}

.stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: var(--fs-tiny);
  color: var(--fg-2);
}

.card.foe .row {
  flex-direction: row-reverse;
}

.row b {
  font-family: var(--font-num);
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--fg-0);
}

.row b i {
  font-style: normal;
  font-size: 0.6em;
  opacity: 0.6;
  margin-left: 1px;
}

.vs {
  font-family: var(--font-num);
  font-size: var(--fs-h2);
  font-weight: 800;
  text-align: center;
  color: var(--fg-2);
  opacity: 0.55;
}

/* 回合明细 */
.rounds {
  display: flex;
  gap: var(--s-2);
  opacity: 0;
  transition: opacity 200ms var(--ease-out-soft) 120ms;
}

.rounds.show {
  opacity: 1;
}

.round {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: 5px 12px;
  font-size: 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-1);
  color: var(--fg-2);
  background: color-mix(in srgb, var(--bg-1) 70%, transparent);
}

.round.won {
  border-color: color-mix(in srgb, var(--brand) 42%, var(--line));
}

.rn {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--fg-1);
}

.round.won .rw {
  color: var(--brand);
}

.rd {
  font-family: var(--font-mono);
  opacity: 0.7;
}

/* 段位 */
.rating {
  display: flex;
  align-items: baseline;
  gap: var(--s-3);
  opacity: 0;
  transition: opacity 200ms var(--ease-out-soft) 180ms;
}

.rating.show {
  opacity: 1;
}

.rl {
  font-size: var(--fs-tiny);
  color: var(--fg-2);
}

.rv {
  font-family: var(--font-num);
  font-size: var(--fs-h2);
  font-weight: 800;
  color: var(--fg-0);
}

.rdelta {
  font-family: var(--font-mono);
  font-size: var(--fs-small);
  color: var(--danger);
}

.rdelta.up {
  color: var(--success);
}

/* 按钮 */
.actions {
  display: flex;
  gap: var(--s-3);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 200ms var(--ease-out-soft) 240ms,
    transform 200ms var(--ease-out-soft) 240ms;
}

.actions.show {
  opacity: 1;
  transform: none;
}

.actions :deep(.ui-btn) {
  height: 44px;
  min-width: 132px;
}
</style>
