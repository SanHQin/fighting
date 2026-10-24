<script setup lang="ts">
/**
 * 模式选择。
 *
 * 交互约定（与主菜单一致）：卡片被**选中**只更新下方的详情面板，
 * 「开始对战」按钮才真正进入选人；在卡片上按 Enter 等同于开始
 * （键盘玩家不必再多按一次）。
 *
 * 在线模式在当前阶段置灰 —— 没有后端，点了只会让人困惑。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import PageHeader from '@/components/PageHeader.vue'
import HintBar from '@/components/HintBar.vue'
import { useFocusGrid, type FocusItem } from '@/composables/useFocusGrid'
import { useMatchStore } from '@/stores'
import type { MatchMode } from '@/types'

const router = useRouter()
const route = useRoute()
const match = useMatchStore()

interface Card {
  id: string
  mode: MatchMode | 'online'
  title: string
  body: string
  tag: string
  glyph: string
  disabled: boolean
}

const cards: Card[] = [
  {
    id: 'ai',
    mode: 'ai',
    title: '人机对战',
    body: 'AI 走同一套 InputSource 接口，难度只改感知延迟与失误率，不改伤害。',
    tag: '四档难度',
    glyph: '⌬',
    disabled: false,
  },
  {
    id: 'local',
    mode: 'local',
    title: '本地双人',
    body: '两个人共用一套键盘。适合调手感、试帧数据、或者单纯打一架。',
    tag: '1P / 2P 同屏',
    glyph: '⇄',
    disabled: false,
  },
  {
    id: 'online',
    mode: 'online',
    title: '在线对战',
    body: '房间、匹配、回滚联机都依赖服务端。后端接通后这里会亮起来。',
    tag: '待接入',
    glyph: '⌁',
    disabled: true,
  },
]

const aiLevel = ref<'easy' | 'normal' | 'hard' | 'master'>('normal')
match.aiLevel = 'normal'

const levels = [
  { id: 'easy', label: '简单', note: '感知 24 帧', desc: '反应慢半拍，几乎不防守' },
  { id: 'normal', label: '普通', note: '感知 16 帧', desc: '会格挡、会追打，默认难度' },
  { id: 'hard', label: '困难', note: '感知 10 帧', desc: '会读冲刺、破盾更积极' },
  { id: 'master', label: '大师', note: '感知 6 帧', desc: '几乎不吃白招，但仍是规则内' },
] as const

/** 卡片被选中的「预览」，鼠标悬停/键盘移动都会更新 */
const preferOnline = route.query.prefer === 'online'
const pickedId = ref<string>(preferOnline ? 'online' : 'ai')
const picked = computed(() => cards.find((c) => c.id === pickedId.value) ?? cards[0]!)
const levelInfo = computed(() => levels.find((l) => l.id === aiLevel.value) ?? levels[1])

const items = computed<FocusItem[]>(() => {
  const cardItems: FocusItem[] = cards.map((c, i) => ({
    id: c.id,
    x: i,
    y: 0,
    enabled: !c.disabled,
    onConfirm: () => {
      if (c.disabled) return
      start(c)
    },
  }))
  const levelItems: FocusItem[] = levels.map((l, i) => ({
    id: 'lv-' + l.id,
    x: i,
    y: 1,
    enabled: pickedId.value === 'ai',
    onConfirm: () => {
      aiLevel.value = l.id
      match.aiLevel = l.id
    },
  }))
  const goItem: FocusItem = {
    id: 'go',
    x: 0,
    y: 2,
    enabled: !picked.value.disabled,
    onConfirm: () => start(picked.value),
  }
  const backItem: FocusItem = {
    id: 'back',
    x: 0,
    y: 3,
    onConfirm: () => router.push({ name: 'menu' }),
  }
  return [...cardItems, ...levelItems, goItem, backItem]
})

const { focusedId, setFocus } = useFocusGrid(items, { initial: 'ai' })

/** 预览跟着焦点走：键盘移动到哪张卡，详情面板就显示哪张 */
function hover(id: string) {
  pickedId.value = id
  setFocus(id)
}

function start(c: Card) {
  if (c.disabled) return
  match.mode = c.mode as MatchMode
  match.aiLevel = aiLevel.value
  router.push({ name: 'char-select' })
}

const levelIdx = computed(() => levels.findIndex((l) => l.id === aiLevel.value))

/* ESC 语义：任何位置按 Esc 都回主菜单（焦点网格的 cancel 只在带 onCancel 的项上触发，
   这里显式补一条，保证行为与底部提示一致） */
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' || e.key === 'Backspace') {
    e.preventDefault()
    router.push({ name: 'menu' })
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <LogicalViewport tone="neutral" :grid="true">
    <div class="mode">
      <PageHeader
        kicker="STEP 1 / 3"
        title="选择模式"
        sub="一局打完再换模式也行 —— 结算页会把你送回来。"
        back="返回主菜单"
      />

      <div class="cards ui-stagger">
        <button
          v-for="(c, i) in cards"
          :key="c.id"
          class="card"
          :class="{
            'is-focused': focusedId === c.id || pickedId === c.id,
            'is-disabled': c.disabled,
          }"
          :disabled="c.disabled"
          @mouseenter="hover(c.id)"
          @click="hover(c.id)"
        >
          <span class="glyph" aria-hidden="true">{{ c.glyph }}</span>
          <span class="cno ui-num">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="tag">{{ c.tag }}</span>
          <span class="ct">{{ c.title }}</span>
          <span class="cb">{{ c.body }}</span>
          <span v-if="c.disabled" class="lock">
            <span class="lockdot" aria-hidden="true" />
            待接入
          </span>
          <span v-else class="cta">选中 →</span>
        </button>
      </div>

      <!-- 详情面板：内容随选中卡片变化 -->
      <section class="detail ui-panel">
        <Transition name="swap" mode="out-in">
          <div v-if="pickedId === 'ai'" key="ai" class="dt">
            <div class="dt-head">
              <span class="dt-k">AI 难度</span>
              <span class="dt-v">{{ levelInfo.label }}<i>·{{ levelInfo.note }}</i></span>
            </div>
            <div class="levels">
              <button
                v-for="(l, i) in levels"
                :key="l.id"
                class="lv"
                :class="{ on: levelIdx === i, 'is-focused': focusedId === 'lv-' + l.id }"
                @mouseenter="setFocus('lv-' + l.id)"
                @click="
                  aiLevel = l.id;
                  match.aiLevel = l.id
                "
              >
                <span class="lvbar" aria-hidden="true">
                  <i :style="{ height: `${(i + 1) * 25}%` }" />
                </span>
                <span class="lvtext">
                  <span class="lvl">{{ l.label }}</span>
                  <span class="lvn">{{ l.note }}</span>
                </span>
              </button>
            </div>
            <p class="dt-note">{{ levelInfo.desc }}</p>
          </div>

          <div v-else-if="pickedId === 'local'" key="local" class="dt">
            <div class="dt-head">
              <span class="dt-k">键盘分配</span>
              <span class="dt-v">两人同屏</span>
            </div>
            <div class="pads">
              <div class="pad p1">
                <span class="padwho">1P</span>
                <span class="keys">
                  <kbd>A</kbd><kbd>D</kbd><span class="kd">移动</span>
                  <kbd>W</kbd><span class="kd">跳</span>
                  <kbd>S</kbd><span class="kd">蹲防</span>
                  <kbd>J</kbd><span class="kd">攻击</span>
                  <kbd>L</kbd><span class="kd">冲刺</span>
                </span>
              </div>
              <div class="pad p2">
                <span class="padwho">2P</span>
                <span class="keys">
                  <kbd>←</kbd><kbd>→</kbd><span class="kd">移动</span>
                  <kbd>↑</kbd><span class="kd">跳</span>
                  <kbd>↓</kbd><span class="kd">蹲防</span>
                  <kbd>Num0</kbd><span class="kd">攻击</span>
                  <kbd>Num5</kbd><span class="kd">冲刺</span>
                </span>
              </div>
            </div>
            <p class="dt-note">同一台机器上两个人抢键盘，建议把 Numpad 那侧让给左手边的人。</p>
          </div>

          <div v-else key="online" class="dt">
            <div class="dt-head">
              <span class="dt-k">在线对战</span>
              <span class="dt-v dim">未接入</span>
            </div>
            <p class="dt-note wide">
              需要先完成后端：账号 → 房间与信令 → 回滚联机。设计已经写死在
              <b>docs/05-server.md</b>，代码还没写。现在点它只会连到空气。
            </p>
          </div>
        </Transition>
      </section>

      <div class="foot">
        <button
          class="ui-btn ui-btn-ghost"
          :class="{ 'is-focused': focusedId === 'back' }"
          @mouseenter="setFocus('back')"
          @click="router.push({ name: 'menu' })"
        >
          返回
        </button>
        <button
          class="ui-btn ui-btn-primary go"
          :class="{ 'is-focused': focusedId === 'go' }"
          :disabled="picked.disabled"
          @mouseenter="setFocus('go')"
          @click="start(picked)"
        >
          开始对战
          <span class="ui-num go-arrow">›</span>
        </button>
      </div>

      <HintBar
        :hints="[
          { key: '←→', label: '选模式' },
          { key: '↓', label: '难度 / 开始' },
          { key: 'Enter', label: '确认' },
          { key: 'Esc', label: '返回' },
        ]"
      >
        <span class="mode-now">
          当前：{{ picked.title }}<template v-if="pickedId === 'ai'"> · {{ levelInfo.label }}</template>
        </span>
      </HintBar>
    </div>
  </LogicalViewport>
</template>

<style scoped>
.mode {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

/* ---------- 卡片 ---------- */
.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--s-4);
  padding: var(--s-2) var(--s-7) 0;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  min-height: 178px;
  padding: var(--s-5);
  text-align: left;
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: color-mix(in srgb, var(--bg-1) 82%, transparent);
  overflow: hidden;
  transition:
    border-color var(--t-fast) var(--ease-standard),
    background var(--t-fast) var(--ease-standard),
    transform var(--t-mid) var(--ease-out-soft),
    box-shadow var(--t-mid) var(--ease-out-soft);
}

.card:hover:not(:disabled) {
  border-color: var(--line-strong);
  background: color-mix(in srgb, var(--bg-2) 86%, transparent);
}

.card.is-focused {
  border-color: color-mix(in srgb, var(--brand) 78%, var(--line));
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--brand) 10%, var(--bg-2)) 0%,
    color-mix(in srgb, var(--bg-2) 92%, transparent) 62%
  );
  transform: translateY(-4px);
  outline: none;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--brand) 22%, transparent),
    0 20px 44px -18px rgba(0, 0, 0, 0.85);
}

.card.is-disabled {
  cursor: not-allowed;
  opacity: 0.42;
  filter: saturate(0.3);
}

/* 右上角大号字形，纯装饰 */
.glyph {
  position: absolute;
  right: 10px;
  top: 2px;
  font-size: 76px;
  line-height: 1;
  color: color-mix(in srgb, var(--fg-1) 9%, transparent);
  pointer-events: none;
}

.cno {
  position: absolute;
  right: var(--s-4);
  bottom: var(--s-3);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--line-strong);
}

.tag {
  align-self: flex-start;
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--brand);
  background: color-mix(in srgb, var(--brand) 13%, transparent);
  border-radius: var(--r-1);
}

.card.is-disabled .tag {
  color: var(--fg-2);
  background: color-mix(in srgb, var(--fg-2) 14%, transparent);
}

.ct {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--fg-0);
}

.cb {
  font-size: var(--fs-tiny);
  line-height: 1.75;
  color: var(--fg-1);
  max-width: 92%;
}

.lock {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: auto;
  font-size: 10px;
  color: var(--fg-2);
}

.lockdot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--fg-2);
}

.cta {
  margin-top: auto;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--brand);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity var(--t-fast) var(--ease-standard),
    transform var(--t-fast) var(--ease-standard);
}

.card.is-focused .cta {
  opacity: 1;
  transform: translateX(0);
}

/* ---------- 详情面板 ---------- */
.detail {
  margin: var(--s-4) var(--s-7) 0;
  padding: var(--s-4) var(--s-5);
  min-height: 118px;
}

.dt {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.dt-head {
  display: flex;
  align-items: baseline;
  gap: var(--s-3);
}

.dt-k {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--fg-2);
}

.dt-v {
  font-size: var(--fs-small);
  font-weight: 600;
  color: var(--fg-0);
}

.dt-v i {
  font-style: normal;
  font-weight: 400;
  color: var(--fg-2);
}

.dt-v.dim {
  color: var(--warn);
}

.dt-note {
  margin: 0;
  font-size: var(--fs-tiny);
  color: var(--fg-1);
}

.dt-note.wide {
  line-height: 1.8;
  max-width: 720px;
}

.dt-note b {
  color: var(--fg-0);
  font-weight: 600;
}

/* 难度按钮 */
.levels {
  display: flex;
  gap: var(--s-3);
}

.lv {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-2) var(--s-4);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: color-mix(in srgb, var(--bg-1) 80%, transparent);
  transition:
    border-color var(--t-fast) var(--ease-standard),
    background var(--t-fast) var(--ease-standard);
}

.lv:hover {
  border-color: var(--line-strong);
}

.lv.on {
  border-color: color-mix(in srgb, var(--brand) 70%, var(--line));
  background: color-mix(in srgb, var(--brand) 11%, var(--bg-1));
}

.lv.is-focused {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 24%, transparent);
}

/* 竖向小柱条：难度越高越高 */
.lvbar {
  display: flex;
  align-items: flex-end;
  width: 5px;
  height: 20px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--bg-3) 90%, transparent);
  overflow: hidden;
}

.lvbar i {
  display: block;
  width: 100%;
  background: linear-gradient(to top, var(--brand-dim), var(--brand));
  transition: height var(--t-mid) var(--ease-out-soft);
}

.lvtext {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.lvl {
  font-size: var(--fs-small);
  font-weight: 600;
  color: var(--fg-0);
}

.lvn {
  font-size: 10px;
  color: var(--fg-2);
}

/* 键位分配 */
.pads {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-5);
}

.pad {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
  border-radius: var(--r-2);
  background: color-mix(in srgb, var(--bg-0) 42%, transparent);
  border-left: 3px solid var(--p1);
}

.pad.p2 {
  border-left-color: var(--p2);
}

.padwho {
  flex: none;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--p1);
}

.pad.p2 .padwho {
  color: var(--p2);
}

.keys {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
}

kbd {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 19px;
  padding: 0 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  color: var(--fg-1);
  background: linear-gradient(180deg, var(--bg-3), color-mix(in srgb, var(--bg-3) 66%, #000));
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: var(--r-1);
}

.kd {
  font-size: 10px;
  color: var(--fg-2);
  margin-right: 4px;
}

/* ---------- 底部按钮 ---------- */
.foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--s-3);
  margin-top: auto;
  padding: var(--s-4) var(--s-7);
}

.go {
  min-width: 168px;
}

.go-arrow {
  font-size: 17px;
  line-height: 1;
  opacity: 0.75;
}

.mode-now {
  color: var(--fg-1);
}

/* 详情面板内容切换 */
.swap-enter-active {
  transition:
    opacity var(--t-mid) var(--ease-out-soft),
    transform var(--t-mid) var(--ease-out-soft);
}
.swap-leave-active {
  transition: opacity var(--t-fast) var(--ease-in-hard);
}
.swap-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.swap-leave-to {
  opacity: 0;
}
</style>
