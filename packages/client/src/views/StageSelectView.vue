<script setup lang="ts">
/**
 * 场地选择。四张场地，左中右三栏：
 *   左 = 竖直列表（焦点网格，A/D 或 ←→ 切场地）
 *   中 = 预览（把世界坐标映射成缩略图，画出平台/出界/场地事件/可破坏标记）
 *   右 = 场地情报（危险等级、事件列表、平台构成、VS 双方）
 *
 * 预览里刻意把「可破坏平台」画成带裂痕的橙色、「移动平台」画成带导轨的绿条、
 * 「场地事件」画成半透明色块——选场地时玩家需要知道这张图会打什么。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import PageHeader from '@/components/PageHeader.vue'
import HintBar from '@/components/HintBar.vue'
import CharSilhouette from '@/components/CharSilhouette.vue'
import { STAGES, charById } from '@/mock/data'
import { useMatchStore } from '@/stores'

const router = useRouter()
const match = useMatchStore()

const index = ref(0)
const chosen = computed(() => STAGES[index.value]!)

const p1 = computed(() => charById(match.charIds[0]))
const p2 = computed(() => charById(match.charIds[1]))

function prev() {
  index.value = (index.value - 1 + STAGES.length) % STAGES.length
}
function next() {
  index.value = (index.value + 1) % STAGES.length
}

/* ---------------- 预览映射 ---------------- */
const VIEW_W = 640
const VIEW_H = 320

/** 用本张场地的出界线算缩放，这样每张图都刚好塞满预览框 */
const mapper = computed(() => {
  const b = chosen.value.blastZone
  const sx = VIEW_W / b.w
  const sy = VIEW_H / b.h
  return {
    tx: (x: number) => (x - b.x) * sx,
    ty: (y: number) => (y - b.y) * sy,
    sx,
    sy,
    b,
  }
})

const platforms = computed(() => {
  const { tx, ty, sx, sy } = mapper.value
  return chosen.value.platforms.map((p) => ({
    ...p,
    left: tx(p.x),
    top: ty(p.y),
    width: Math.max(3, p.w * sx),
    height: Math.max(3, p.h * sy),
  }))
})

const hazards = computed(() => {
  const { tx, ty, sx, sy } = mapper.value
  return (chosen.value.hazards ?? []).map((h, i) => ({
    ...h,
    key: h.kind + i,
    left: tx(h.x),
    top: ty(h.y),
    width: Math.max(4, h.w * sx),
    height: Math.max(4, h.h * sy),
  }))
})

const spawns = computed(() => {
  const { tx, ty } = mapper.value
  return chosen.value.spawnPoints.map((s, i) => ({ key: i, left: tx(s.x), top: ty(s.y) }))
})

/* ---------------- 情报 ---------------- */
const hazardLabel: Record<string, string> = {
  flame: '地火喷口',
  gear: '旋转齿轮',
  wind: '上升气流',
  lava: '熔岩',
  rock: '落石',
}

const hazardRows = computed(() =>
  (chosen.value.hazards ?? []).map((h) => ({
    key: h.kind,
    name: hazardLabel[h.kind] ?? h.kind,
    dmg: h.damage,
    period: Math.round(h.period / 60),
    label: h.label || '',
  })),
)

const breakables = computed(() => chosen.value.platforms.filter((p) => (p.hp ?? 0) > 0).length)
const movers = computed(() => chosen.value.platforms.filter((p) => (p.moveAmp ?? 0) > 0).length)

const dangerText = computed(() => ['', '低', '中', '高', '极高'][chosen.value.danger] ?? '低')
const dangerClass = computed(() => `d${Math.min(4, Math.max(1, chosen.value.danger))}`)

function start() {
  match.stageId = chosen.value.id
  if (!match.stocks) match.stocks = 3
  router.push({ name: 'battle', params: { matchId: 'local-' + Date.now() } })
}

function back() {
  router.push({ name: 'char-select' })
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return

  if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
    e.preventDefault()
    start()
    return
  }
  if (e.code === 'Escape' || e.code === 'Backspace') {
    e.preventDefault()
    back()
    return
  }
  if (['KeyW', 'ArrowUp', 'KeyA', 'ArrowLeft'].includes(e.code)) {
    e.preventDefault()
    prev()
  } else if (['KeyS', 'ArrowDown', 'KeyD', 'ArrowRight'].includes(e.code)) {
    e.preventDefault()
    next()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <LogicalViewport tone="warm">
    <div class="stg">
      <PageHeader
        kicker="STEP 3 / 3"
        title="选择场地"
        sub="每张图验证一个机制：地形会动、会烧、会消失。危险度高的图出界区也更近。"
        back="返回选人"
        compact
      >
        <div class="step-dots" aria-hidden="true">
          <i class="on" /><i class="on" /><i class="on" />
        </div>
      </PageHeader>

      <div class="body">
        <!-- 左：场地列表 -->
        <nav class="list ui-stagger">
          <button
            v-for="(s, i) in STAGES"
            :key="s.id"
            class="sitem"
            :class="{ on: i === index }"
            @mouseenter="index = i"
            @click="index = i; start()"
          >
            <span class="sidx">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="smeta">
              <b>{{ s.displayName }}</b>
              <i>{{ s.id.toUpperCase().replace('_', ' ') }}</i>
            </span>
            <span class="sdanger" :class="'d' + Math.min(4, Math.max(1, s.danger))">
              {{ ['', '低', '中', '高', '极高'][s.danger] }}
            </span>
          </button>
        </nav>

        <!-- 中：预览 -->
        <section class="preview">
          <div
            class="canvas"
            :style="{
              background: `linear-gradient(180deg, ${chosen.bgTop}, ${chosen.bgBottom})`,
              '--accent': chosen.accent,
            }"
          >
            <!-- 出界线 -->
            <div
              class="blast"
              :style="{
                left: '0px',
                top: '0px',
                width: VIEW_W + 'px',
                height: VIEW_H + 'px',
              }"
            />

            <!-- 场地事件 -->
            <div
              v-for="h in hazards"
              :key="h.key"
              class="haz"
              :class="h.kind"
              :style="{
                left: h.left + 'px',
                top: h.top + 'px',
                width: h.width + 'px',
                height: h.height + 'px',
              }"
            />

            <!-- 平台 -->
            <div
              v-for="p in platforms"
              :key="p.id"
              class="plat"
              :class="[p.type, { brk: (p.hp ?? 0) > 0, mov: (p.moveAmp ?? 0) > 0 }]"
              :style="{
                left: p.left + 'px',
                top: p.top + 'px',
                width: p.width + 'px',
                height: p.height + 'px',
              }"
            />

            <!-- 出生点 -->
            <div
              v-for="s in spawns"
              :key="s.key"
              class="spawn"
              :style="{ left: s.left + 'px', top: s.top + 'px' }"
            />

            <span class="lbl left">出界</span>
            <span class="lbl right">出界</span>
          </div>

          <p class="blurb">{{ chosen.blurb }}</p>

          <div class="legend">
            <span><i class="lg solid" />实心台</span>
            <span><i class="lg pass" />单向台</span>
            <span><i class="lg brk" />可破坏</span>
            <span><i class="lg mov" />移动台</span>
            <span><i class="lg haz" />场地事件</span>
            <span><i class="lg sp" />出生点</span>
          </div>
        </section>

        <!-- 右：情报 -->
        <aside class="info">
          <div class="iname">
            <h2>{{ chosen.displayName }}</h2>
            <span class="dchip" :class="dangerClass">危险 {{ dangerText }}</span>
          </div>
          <p class="sen">{{ chosen.id.toUpperCase().replace('_', ' ') }} · v{{ chosen.version }}</p>

          <dl class="kv">
            <div><dt>平台数</dt><dd>{{ chosen.platforms.length }}</dd></div>
            <div><dt>可抓边</dt><dd>{{ chosen.platforms.filter((p) => p.grabbable).length }} 处</dd></div>
            <div><dt>可破坏</dt><dd>{{ breakables }} 块</dd></div>
            <div><dt>移动台</dt><dd>{{ movers }} 块</dd></div>
            <div><dt>命数</dt><dd>{{ match.stocks }}</dd></div>
          </dl>

          <div class="hbox" v-if="hazardRows.length">
            <p class="hbt">场地事件</p>
            <div v-for="h in hazardRows" :key="h.key" class="hrow">
              <span class="hdot" :class="h.key" />
              <b>{{ h.name }}</b>
              <em v-if="h.dmg > 0">{{ h.dmg }}% · 每 {{ h.period }}s</em>
              <em v-else>无伤害</em>
            </div>
          </div>
          <p v-else class="hnone">这张图没有场地事件，纯看走位和连段。</p>

          <div class="versus">
            <div v-if="p1" class="vs-side">
              <CharSilhouette :char="p1" :height="58" />
              <span class="vs-name">{{ p1.displayName }}</span>
            </div>
            <span class="vs">VS</span>
            <div v-if="p2" class="vs-side">
              <CharSilhouette :char="p2" :height="58" />
              <span class="vs-name">{{ p2.displayName }}</span>
            </div>
          </div>

          <button class="go" @click="start">开始战斗</button>
        </aside>
      </div>

      <HintBar
        :hints="[
          { key: 'A D', label: '切换场地' },
          { key: 'Enter', label: '开始' },
          { key: 'Esc', label: '返回' },
        ]"
      />
    </div>
  </LogicalViewport>
</template>

<style scoped>
.stg {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

/* 三步进度点 */
.step-dots {
  display: flex;
  gap: 6px;
}

.step-dots i {
  width: 18px;
  height: 2px;
  border-radius: 1px;
  background: var(--line-strong);
}

.step-dots i.on {
  background: var(--brand);
  box-shadow: 0 0 8px color-mix(in srgb, var(--brand) 60%, transparent);
}

.body {
  display: grid;
  grid-template-columns: 200px 1fr 300px;
  gap: var(--s-5);
  flex: 1;
  min-height: 0;
  padding: var(--s-5) var(--s-6);
}

/* ---------- 左列表 ---------- */
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sitem {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 10px 14px;
  text-align: left;
  background: color-mix(in srgb, var(--bg-1) 88%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  overflow: hidden;
  transition:
    background var(--t-fast) var(--ease-standard),
    border-color var(--t-fast) var(--ease-standard),
    transform var(--t-mid) var(--ease-out-soft);
}

/* 选中项的左侧强调条 */
.sitem::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 0;
  border-radius: 0 2px 2px 0;
  background: var(--brand);
  transform: translateY(-50%);
  transition: height var(--t-fast) var(--ease-standard);
}

.sitem:hover {
  background: color-mix(in srgb, var(--bg-2) 92%, transparent);
  border-color: var(--line-strong);
}

.sitem.on {
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--brand) 16%, var(--bg-2)) 0%,
    color-mix(in srgb, var(--bg-2) 92%, transparent) 82%
  );
  border-color: color-mix(in srgb, var(--brand) 66%, var(--line));
  transform: translateX(3px);
}

.sitem.on::before {
  height: 62%;
}

.sidx {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-2);
}

.sitem.on .sidx {
  color: var(--brand);
}

.smeta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.smeta b {
  font-size: 13px;
  color: var(--fg-0);
  white-space: nowrap;
}

.smeta i {
  font-style: normal;
  font-family: var(--font-mono);
  font-size: 8.5px;
  letter-spacing: 0.05em;
  color: var(--fg-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sdanger {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  flex: none;
}

.sdanger.d1 {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 16%, transparent);
}
.sdanger.d2 {
  color: var(--info);
  background: color-mix(in srgb, var(--info) 16%, transparent);
}
.sdanger.d3 {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 18%, transparent);
}
.sdanger.d4 {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 18%, transparent);
}

/* ---------- 中预览 ---------- */
.preview {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  min-width: 0;
}

.canvas {
  position: relative;
  width: 640px;
  height: 320px;
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  overflow: hidden;
  flex: none;
}

/* 预览不是战斗画面的截图，但必须让人"认出是同一张图"：
 * 与 game/stageBackdrop.ts 用同一个 accent 做一团地面光，再压一层暗角，
 * 剩下的交给平台示意图 —— 选场地时看的是布局，不是美术。 */
.canvas::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    58% 54% at 50% 66%,
    color-mix(in srgb, var(--accent, #ffb020) 24%, transparent),
    transparent 72%
  );
  pointer-events: none;
}

.canvas::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    118% 100% at 50% 44%,
    transparent 44%,
    rgba(2, 3, 6, 0.68) 100%
  );
  pointer-events: none;
}

.blast {
  position: absolute;
  border: 1px dashed color-mix(in srgb, var(--danger) 45%, transparent);
  border-radius: 6px;
  pointer-events: none;
}

.plat {
  position: absolute;
  border-radius: 2px;
}

.plat.solid {
  background: linear-gradient(180deg, #3d2f1e, #17100b);
  box-shadow: inset 0 2px 0 var(--accent, #ffb020);
}

.plat.passthrough {
  background: rgba(255, 240, 200, 0.55);
  box-shadow: 0 0 4px rgba(255, 240, 200, 0.35);
}

.plat.brk {
  box-shadow:
    inset 0 2px 0 var(--warn),
    0 0 8px color-mix(in srgb, var(--warn) 45%, transparent);
}

.plat.mov {
  box-shadow:
    inset 0 2px 0 var(--brand),
    0 0 8px color-mix(in srgb, var(--brand) 45%, transparent);
}

.haz {
  position: absolute;
  border-radius: 3px;
}

.haz.flame,
.haz.lava {
  background: color-mix(in srgb, #ff7a1f 42%, transparent);
  border: 1px solid color-mix(in srgb, #ff7a1f 70%, transparent);
}

.haz.gear {
  background: color-mix(in srgb, var(--brand) 26%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand) 65%, transparent);
  border-radius: 50%;
}

.haz.wind {
  background: repeating-linear-gradient(
    180deg,
    color-mix(in srgb, var(--info) 24%, transparent) 0 4px,
    transparent 4px 9px
  );
  border: 1px dashed color-mix(in srgb, var(--info) 55%, transparent);
}

.haz.rock {
  background: color-mix(in srgb, #9aa6b8 40%, transparent);
  border: 1px solid color-mix(in srgb, #9aa6b8 75%, transparent);
}

.spawn {
  position: absolute;
  width: 7px;
  height: 7px;
  margin: -3.5px 0 0 -3.5px;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 6px var(--brand);
}

.lbl {
  position: absolute;
  top: 6px;
  font-size: 8px;
  letter-spacing: 0.14em;
  color: color-mix(in srgb, var(--danger) 80%, transparent);
}

.lbl.left {
  left: 6px;
}
.lbl.right {
  right: 6px;
}

.blurb {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--fg-1);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 10px;
  color: var(--fg-2);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.lg {
  width: 12px;
  height: 5px;
  border-radius: 2px;
}

.lg.solid {
  background: #3d2f1e;
  box-shadow: inset 0 1px 0 #ffb020;
}
.lg.pass {
  background: rgba(255, 240, 200, 0.6);
}
.lg.brk {
  background: var(--warn);
}
.lg.mov {
  background: var(--brand);
}
.lg.haz {
  background: color-mix(in srgb, #ff7a1f 55%, transparent);
}
.lg.sp {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand);
}

/* ---------- 右情报 ---------- */
.info {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: var(--s-4);
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  min-height: 0;
  overflow-y: auto;
}

.iname {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.iname h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: var(--fg-0);
}

.dchip {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 3px;
}

.dchip.d1 {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 16%, transparent);
}
.dchip.d2 {
  color: var(--info);
  background: color-mix(in srgb, var(--info) 16%, transparent);
}
.dchip.d3 {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 18%, transparent);
}
.dchip.d4 {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 18%, transparent);
}

.sen {
  margin: -6px 0 0;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--fg-2);
}

.kv {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
  margin: 0;
  padding: var(--s-3) 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.kv div {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.kv dt {
  color: var(--fg-2);
}

.kv dd {
  margin: 0;
  color: var(--fg-0);
  font-weight: 600;
}

.hbox {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.hbt {
  margin: 0;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--fg-2);
}

.hrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.hdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--fg-2);
}

.hdot.flame,
.hdot.lava {
  background: #ff7a1f;
}
.hdot.gear {
  background: var(--brand);
}
.hdot.wind {
  background: var(--info);
}
.hdot.rock {
  background: #9aa6b8;
}

.hrow b {
  color: var(--fg-0);
  font-weight: 600;
}

.hrow em {
  margin-left: auto;
  font-style: normal;
  font-size: 10px;
  color: var(--fg-2);
}

.hnone {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-2);
}

.versus {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: var(--s-2) 0;
  margin-top: auto;
}

.vs-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
}

.vs-name {
  font-size: 10px;
  color: var(--fg-1);
}

.vs {
  font-family: var(--font-num);
  font-size: 14px;
  font-weight: 800;
  color: var(--fg-2);
}

.go {
  height: 46px;
  font-size: 15px;
  font-weight: 700;
  color: var(--brand-ink);
  background: var(--brand);
  border-radius: var(--r-2);
  transition: background var(--t-fast) var(--ease-standard);
}

.go:hover {
  background: color-mix(in srgb, var(--brand) 88%, white);
}
</style>
