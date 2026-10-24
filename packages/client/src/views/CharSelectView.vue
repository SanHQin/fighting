<script setup lang="ts">
/**
 * 角色选择。三栏布局 + 底部 2×2 网格，见 docs/04-ui-art.md 第 4 章。
 *
 * 两个必须做到的细节：
 * 1. 预览 80ms 防抖 —— 摇杆连跳会一路划过好几个角色，不防抖就是闪屏。
 * 2. 300ms 内重复 confirm 只认第一次 —— 手柄连击不能连跳两页。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import PageHeader from '@/components/PageHeader.vue'
import HintBar from '@/components/HintBar.vue'
import CharPortrait from '@/components/CharPortrait.vue'
import { characterCatalog, charById } from '@/mock/data'
import { useMatchStore } from '@/stores'
import type { CharDef } from '@/types'

const router = useRouter()
const match = useMatchStore()

const hovered = ref<CharDef>(charById('aoi') ?? characterCatalog()[0]!)
const previewed = ref<CharDef>(charById('aoi') ?? characterCatalog()[0]!)
const p1 = ref<CharDef | null>(null)
const p2 = ref<CharDef | null>(null)
/** 本地双人时轮流选：0=1P 在选，1=2P 在选 */
const turn = ref<0 | 1>(0)

let debounceTimer = 0
watch(hovered, (c) => {
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    previewed.value = c
  }, 80)
})

let lastConfirmAt = 0

function cursorOn(id: string) {
  const c = charById(id)
  if (c && !c.locked) hovered.value = c
}

/* ---------- 键盘/焦点 ----------
 * 网格是 2×2，方向键移动一格；到边界就停住（不循环）。
 * 锁定的格子跳过，避免"选到空位"这种迷惑行为。
 */
const GRID_COLS = 2
const cursor = ref(0)

function moveCursor(dx: number, dy: number) {
  const rows = Math.ceil(GRID.length / GRID_COLS)
  const c = cursor.value % GRID_COLS
  const r = Math.floor(cursor.value / GRID_COLS)
  let nc = Math.max(0, Math.min(GRID_COLS - 1, c + dx))
  let nr = Math.max(0, Math.min(rows - 1, r + dy))
  let idx = nr * GRID_COLS + nc
  // 落点被锁：往反方向退一格
  if (charById(GRID[idx]!)?.locked) {
    idx = cursor.value
  }
  cursor.value = idx
  const id = GRID[idx]
  if (id) cursorOn(id)
}

function onKey(e: KeyboardEvent) {
  const k = e.key
  if (k === 'Escape' || k === 'Backspace') {
    e.preventDefault()
    back()
    return
  }
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
    e.preventDefault()
    moveCursor(-1, 0)
  } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
    e.preventDefault()
    moveCursor(1, 0)
  } else if (k === 'ArrowUp' || k === 'w' || k === 'W') {
    e.preventDefault()
    moveCursor(0, -1)
  } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
    e.preventDefault()
    moveCursor(0, 1)
  } else if (k === 'Enter' || k === ' ') {
    e.preventDefault()
    pick()
  }
}

function pick() {
  const now = performance.now()
  if (now - lastConfirmAt < 300) return
  lastConfirmAt = now

  const c = hovered.value
  if (c.locked) return

  if (match.mode === 'local') {
    if (turn.value === 0) {
      p1.value = c
      turn.value = 1
      // 2P 默认落在另一个角色上，省得两边抢同一个
      const other = characterCatalog().find((x) => !x.locked && x.id !== c.id)
      if (other) hovered.value = other
    } else {
      p2.value = c
      lastConfirmAt = 0
      goStage()
    }
    return
  }

  p1.value = c
  // 人机/在线：对手由系统定
  p2.value = characterCatalog().find((x) => !x.locked && x.id !== c.id) ?? null
  goStage()
}

function goStage() {
  if (!p1.value) return
  match.charIds = [p1.value.id, (p2.value ?? charById('aoi') ?? characterCatalog()[0]!).id]
  router.push({ name: 'stage-select' })
}

function back() {
  router.push({ name: 'mode' })
}

const hintText = computed(() =>
  match.mode === 'local'
    ? turn.value === 0
      ? '1P 选择中'
      : '2P 选择中'
    : '选择你的角色',
)

/** 2×2 网格的顺序：aoi / ken / li / locked */
const GRID = ['aoi', 'ken', 'li', 'shu']

/** 方向变体的显示名 */
function dirLabel(dir: string): string {
  return (
    {
      up: '↑',
      down: '↓',
      forward: '→',
      back: '←',
      upForward: '↗',
      upBack: '↖',
      downForward: '↘',
      downBack: '↙',
      neutral: '中',
    } as Record<string, string>
  )[dir] ?? dir
}

function dashSpeedText(c: CharDef): string {
  const mul = c.dashSpeedMul ?? 1
  if (mul >= 1.08) return '快'
  if (mul <= 0.94) return '慢'
  return '标准'
}

function dashFramesText(c: CharDef): string {
  const mul = c.dashFramesMul ?? 1
  if (mul >= 1.06) return '长'
  if (mul <= 0.9) return '短'
  return '标准'
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.clearTimeout(debounceTimer)
})
</script>

<template>
  <LogicalViewport tone="neutral">
    <div class="sel">
      <PageHeader
        kicker="STEP 2 / 3"
        :title="hintText"
        sub="左右切换，上下对比。九方向出招、独有必杀、冲刺与击倒差异都写在右侧。"
        back="返回模式选择"
        compact
      >
        <div class="step-dots" aria-hidden="true">
          <i class="on" /><i class="on" /><i />
        </div>
      </PageHeader>

      <div class="stage">
        <!-- 左：1P 槽 -->
        <aside class="slot" :class="{ active: match.mode === 'local' && turn === 0 }">
          <span class="sidetag">1P</span>
          <div class="box" :class="{ ready: p1 }">
            <CharPortrait v-if="p1" :char="p1" :height="104" glow />
            <span v-else class="empty">?</span>
          </div>
          <span v-if="p1?.id === previewed.id" class="stamp">READY</span>
        </aside>

        <!-- 中：预览 -->
        <section class="preview" :style="{ '--fighter-accent': previewed.color }">
          <div class="portrait">
            <template v-if="!previewed.locked">
              <CharPortrait :char="previewed" :height="196" glow />
            </template>
            <span v-else class="lockedbig">未解锁</span>
          </div>

          <div class="meta">
            <h2 class="cname">{{ previewed.displayName }}</h2>
            <p class="cen">{{ previewed.displayNameEn }}</p>
            <p class="tag">{{ previewed.tagline }}</p>

            <div class="stats">
              <div class="st">
                <span class="sk">速度</span>
                <span class="stars">
                  <i v-for="n in 5" :key="n" :class="{ on: n <= previewed.speed }" />
                </span>
              </div>
              <div class="st">
                <span class="sk">力量</span>
                <span class="stars">
                  <i v-for="n in 5" :key="n" :class="{ on: n <= previewed.power }" />
                </span>
              </div>
              <div class="st">
                <span class="sk">体重</span>
                <span class="sv">{{ previewed.weightClass }}</span>
              </div>
              <div class="st">
                <span class="sk">招式</span>
                <span class="sv">{{ previewed.moveCount }}</span>
              </div>
            </div>

            <div v-if="previewed.moves" class="movebook">
              <p class="spt"><span>普通攻击 · 九方向</span><em>角色专属</em></p>
              <div class="movegrid">
                <div v-for="(move, dir) in previewed.moves" :key="dir" class="movechip">
                  <b>{{ dirLabel(String(dir)) }}</b>
                  <span>{{ move?.damage ?? '基础' }}%</span>
                  <small>{{ move?.startup ?? '—' }}F 起手</small>
                </div>
              </div>
            </div>

            <!-- 独有必杀：这是角色之间真正的差异 -->
            <div v-if="previewed.specials.length" class="sp">
              <p class="spt">
                <span>独有招式</span>
                <em>{{ previewed.specials.length }} 个</em>
              </p>
              <div v-for="sp in previewed.specials" :key="sp.name" class="sprow">
                <span class="spkey">{{ sp.slot === 0 ? 'U' : 'I' }}</span>
                <span class="spname">
                  {{ sp.name }}
                  <em v-if="sp.dir" class="dir">+{{ dirLabel(sp.dir) }}</em>
                </span>
                <span class="spstat">
                  <template v-if="sp.damage > 0">{{ sp.damage }}%</template>
                  <template v-else>—</template>
                  <em>CD {{ Math.round(sp.cooldown / 60) }}s</em>
                </span>
              </div>
              <p class="sphint">按住方向再按技能键，出的是同一槽位的另一个变体。</p>
            </div>

            <!-- 冲刺特性：每个角色的冲刺速度/帧数/空冲次数都不同 -->
            <div class="dashrow">
              <p class="spt"><span>冲刺</span></p>
              <p class="kdtext">
                速度 <b>{{ dashSpeedText(previewed) }}</b> ·
                持续 <b>{{ dashFramesText(previewed) }}</b> ·
                冷却 <b>{{ ((previewed.dashCooldown ?? 26) / 60).toFixed(1) }}s</b> ·
                空中冲刺 <b>{{ previewed.airDashes ?? 1 }}</b> 次 ·
                冲刺攻击伤害 <b>{{ Math.round((previewed.dashAttackMul ?? 1) * 100) }}%</b>
              </p>
            </div>

            <!-- 击倒特性：每个角色不一样 -->
            <div class="kd">
              <p class="spt"><span>击倒特性</span></p>
              <p class="kdtext">
                伤害达 <b>{{ previewed.knockdownGate }}%</b> 后被连击击飞 →
                倒地 <b>{{ previewed.knockdownFrames }}</b> 帧，
                起身无敌 <b>{{ previewed.getupInvincible }}</b> 帧。
                <template v-if="previewed.knockdownFrames >= 52">
                  倒地很久，但爬起来很脆——挨打代价最大。
                </template>
                <template v-else-if="previewed.knockdownFrames <= 42">
                  倒地很短，起身无敌长——抗压型。
                </template>
                <template v-else>
                  中规中矩的倒地时长。
                </template>
              </p>
            </div>
          </div>
        </section>

        <!-- 右：2P / 对手 -->
        <aside class="slot right">
          <span class="sidetag p2">2P</span>
          <div class="box" :class="{ ready: p2 }">
            <CharPortrait v-if="p2" :char="p2" :height="104" />
            <span v-else class="empty">?</span>
          </div>
          <span v-if="p2" class="stamp dim">CPU</span>
        </aside>
      </div>

      <!-- 底部网格 -->
      <div class="grid">
        <button
          v-for="id in GRID"
          :key="id"
          class="cell"
          :class="{
            locked: charById(id)?.locked,
            on: hovered.id === id,
            taken: p1?.id === id || p2?.id === id,
          }"
          @mouseenter="cursorOn(id)"
          @click="
            cursorOn(id);
            pick()
          "
        >
          <template v-if="charById(id)">
            <CharPortrait
              v-if="!charById(id)!.locked"
              :char="charById(id)!"
              :height="52"
              icon
            />
            <span v-else class="q">?</span>
            <span class="cnick">
              {{ charById(id)!.locked ? '未解锁' : charById(id)!.displayName }}
            </span>
          </template>
        </button>
      </div>

      <HintBar
        :hints="[
          { key: '←→↑↓', label: '选择' },
          { key: 'Enter', label: '确认' },
          { key: 'Esc', label: '返回' },
        ]"
      />
    </div>
  </LogicalViewport>
</template>

<style scoped>
.sel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

/* 三步进度点：模式 → 角色 → 场地 */
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

.stage {
  display: grid;
  grid-template-columns: 140px 1fr 140px;
  gap: var(--s-5);
  padding: var(--s-5) var(--s-6) var(--s-3);
  flex: 1;
  min-height: 0;
}

/* 左右槽 */
.slot {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-3);
}

.slot.active .box {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 20%, transparent);
}

.sidetag {
  position: absolute;
  top: 0;
  left: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--p1);
}

.sidetag.p2 {
  color: var(--p2);
  left: auto;
  right: 0;
}

.box {
  display: grid;
  place-items: center;
  width: 116px;
  height: 132px;
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: color-mix(in srgb, var(--bg-1) 82%, transparent);
  transition: border-color var(--t-mid) var(--ease-out-soft);
}

.box.ready {
  border-color: color-mix(in srgb, var(--brand) 50%, var(--line));
}

.empty {
  font-size: 32px;
  color: var(--line-strong);
}

.stamp {
  position: absolute;
  bottom: 18px;
  padding: 2px 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--brand-ink);
  background: var(--brand);
  border-radius: var(--r-1);
  transform: rotate(-3deg);
}

.stamp.dim {
  color: var(--fg-0);
  background: var(--bg-3);
}

/* 预览 */
.preview {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: var(--s-5);
  align-items: stretch;
  padding: 0 var(--s-3);
  border-top: 2px solid color-mix(in srgb, var(--fighter-accent) 72%, transparent);
  min-height: 0;
}

.portrait {
  display: grid;
  place-items: center;
  height: 100%;
  border-radius: var(--r-3);
  background: radial-gradient(
    circle at 50% 62%,
    color-mix(in srgb, var(--bg-3) 76%, transparent) 0%,
    transparent 72%
  );
}

.lockedbig {
  font-size: var(--fs-small);
  color: var(--fg-2);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  min-width: 0;
  overflow-y: auto;
  padding-right: var(--s-2);
}

.cname {
  margin: 0;
  font-size: var(--fs-h1);
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--fg-0);
}

.cen {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-tiny);
  letter-spacing: 0.1em;
  color: var(--fg-2);
  text-transform: uppercase;
}

.tag {
  margin: var(--s-2) 0 var(--s-4);
  max-width: 420px;
  font-size: var(--fs-small);
  line-height: 1.8;
  color: var(--fg-1);
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, 180px);
  gap: var(--s-2) var(--s-5);
}

.st {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-1) 0;
  border-bottom: 1px dashed var(--line);
}

.sk {
  font-size: var(--fs-tiny);
  color: var(--fg-2);
}

.sv {
  font-family: var(--font-num);
  font-size: var(--fs-small);
  color: var(--fg-0);
}

.stars {
  display: flex;
  gap: 3px;
}

.stars i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--bg-3);
}

.stars i.on {
  background: var(--brand);
}

/* 独有必杀 */
.sp {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: var(--s-3);
  padding-top: var(--s-2);
  border-top: 1px solid var(--line);
}

.movebook {
  margin-top: var(--s-2);
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: color-mix(in srgb, var(--bg-2) 78%, transparent);
}

.movegrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(72px, 1fr));
  gap: 4px;
}

.movechip {
  display: grid;
  grid-template-columns: 22px 1fr;
  align-items: center;
  gap: 1px 5px;
  padding: 4px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--fighter-accent) 12%, var(--bg-1));
  font-size: 10px;
}

.movechip b { color: var(--fighter-accent); font-family: var(--font-mono); }
.movechip small { grid-column: 2; color: var(--fg-2); font-size: 9px; }

.spt {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 2px;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--fg-2);
}

.spt em {
  font-style: normal;
  letter-spacing: 0;
  color: var(--fg-2);
}

.sprow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: color-mix(in srgb, var(--bg-2) 70%, transparent);
  border: 1px solid var(--line);
  border-left: 2px solid var(--brand);
  border-radius: var(--r-1);
}

.spkey {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  flex: none;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  color: var(--brand-ink);
  background: var(--brand);
  border-radius: 3px;
}

.spname {
  flex: 1;
  font-size: 12px;
  color: var(--fg-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spstat {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: none;
  font-family: var(--font-num);
  font-size: 12px;
  color: var(--dmg-2);
}

.spstat em {
  font-style: normal;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--fg-2);
}

/* 方向变体标记 */
.spname .dir {
  margin-left: 4px;
  font-style: normal;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--brand);
  opacity: 0.85;
}

.sphint {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.6;
  color: var(--fg-2);
}

/* 冲刺特性 */
.dashrow {
  margin-top: var(--s-2);
  padding-top: var(--s-2);
  border-top: 1px solid var(--line);
}

/* 击倒特性 */
.kd {
  margin-top: var(--s-2);
  padding-top: var(--s-2);
  border-top: 1px solid var(--line);
}

.kdtext {
  margin: 0;
  max-width: 440px;
  font-size: 11px;
  line-height: 1.75;
  color: var(--fg-1);
}

.kdtext b {
  color: var(--warn);
  font-family: var(--font-num);
}

/* 底部网格 */
.grid {
  display: grid;
  grid-template-columns: repeat(4, 96px);
  gap: var(--s-3);
  justify-content: center;
  padding: var(--s-3) var(--s-6) var(--s-5);
}

.cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
  height: 104px;
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
  transition: border-color var(--t-fast) var(--ease-standard),
    transform var(--t-fast) var(--ease-standard);
}

.cell:hover {
  border-color: var(--line-strong);
}

.cell.on {
  border-color: var(--brand);
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.4);
}

.cell.taken::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--r-2);
  background: color-mix(in srgb, var(--brand) 12%, transparent);
}

.cell.locked {
  opacity: 0.5;
}

.q {
  font-size: 22px;
  color: var(--fg-2);
}

.cnick {
  font-size: 10px;
  color: var(--fg-1);
  max-width: 84px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
