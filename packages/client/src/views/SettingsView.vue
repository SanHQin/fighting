<script setup lang="ts">
/**
 * 设置页。三组：画面 / 音频 / 按键。
 * 交互约定来自 docs/04-ui-art.md 第 4 章：
 *   ↑↓ 选行、←→ 调值、Q/E 切页签、ESC 返回。
 * 所有值先写进 store（内存），点「保存」才落 localStorage——
 * 直接实时保存会让用户调滑条时把好配置覆盖掉。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import PageHeader from '@/components/PageHeader.vue'
import HintBar from '@/components/HintBar.vue'
import { useSettingsStore, useSessionStore } from '@/stores'

const router = useRouter()
const settings = useSettingsStore()
const session = useSessionStore()

type TabId = 'video' | 'audio' | 'keys'
const tabs: { id: TabId; label: string }[] = [
  { id: 'video', label: '画面' },
  { id: 'audio', label: '音频' },
  { id: 'keys', label: '按键' },
]
const tab = ref<TabId>('video')

interface Row {
  id: string
  label: string
  note?: string
  kind: 'toggle' | 'range' | 'info'
  get: () => boolean | number
  set?: (v: boolean | number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}

const rows = computed<Row[]>(() => {
  if (tab.value === 'video') {
    return [
      {
        id: 'fps',
        label: '显示帧率与回滚统计',
        note: '左上角叠加 FPS / frame / 回滚次数，开发期常开',
        kind: 'toggle',
        get: () => settings.showFps,
        set: (v) => (settings.showFps = v as boolean),
      },
      {
        id: 'hitbox',
        label: '显示判定框',
        note: '叠加 hurtbox / hitbox，调帧数据时必开',
        kind: 'toggle',
        get: () => settings.showHitbox,
        set: (v) => (settings.showHitbox = v as boolean),
      },
      {
        id: 'lowq',
        label: '低画质模式',
        note: '关多层视差与粒子；集显或 1440p 卡顿时打开',
        kind: 'toggle',
        get: () => settings.lowQuality,
        set: (v) => (settings.lowQuality = v as boolean),
      },
      {
        id: 'full',
        label: '全屏',
        note: '按 F11 也可以，行为一致',
        kind: 'toggle',
        get: () => settings.fullscreen,
        set: (v) => {
          settings.fullscreen = v as boolean
          if (v) document.documentElement.requestFullscreen?.().catch(() => {})
          else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
        },
      },
      {
        id: 'res',
        label: '渲染分辨率',
        kind: 'info',
        get: () => 1280,
      },
    ]
  }
  if (tab.value === 'audio') {
    return [
      {
        id: 'master',
        label: '总音量',
        kind: 'range',
        get: () => Math.round(settings.masterVolume * 100),
        set: (v) => (settings.masterVolume = (v as number) / 100),
        min: 0,
        max: 100,
        step: 5,
        unit: '%',
      },
      {
        id: 'bgm',
        label: '背景音乐',
        kind: 'range',
        get: () => Math.round(settings.bgmVolume * 100),
        set: (v) => (settings.bgmVolume = (v as number) / 100),
        min: 0,
        max: 100,
        step: 5,
        unit: '%',
      },
      {
        id: 'sfx',
        label: '音效',
        kind: 'range',
        get: () => Math.round(settings.sfxVolume * 100),
        set: (v) => (settings.sfxVolume = (v as number) / 100),
        min: 0,
        max: 100,
        step: 5,
        unit: '%',
      },
    ]
  }
  return [
    { id: 'k1', label: '1P 移动', kind: 'info', get: () => 0 },
    { id: 'k2', label: '1P 跳跃 / 快降', kind: 'info', get: () => 0 },
    { id: 'k3', label: '1P 攻击', kind: 'info', get: () => 0 },
    { id: 'k4', label: '2P 移动', kind: 'info', get: () => 0 },
    { id: 'k5', label: '菜单确认 / 返回', kind: 'info', get: () => 0 },
  ]
})

const keyMap: Record<string, string> = {
  k1: 'A / D',
  k2: 'W / S',
  k3: 'F（空格也可跳）',
  k4: '← / →',
  k5: 'Enter / ESC',
}

/** 模板里访问不到 window，提前算好；SSR / 非浏览器环境下退回 1.00 */
const dpr = ref(1)
const resText = computed(() => `1280 × 720 逻辑 · DPR ${dpr.value.toFixed(2)}×`)

/* ---------------- 焦点与输入 ---------------- */
const cursor = ref(0)

function clampCursor() {
  if (cursor.value >= rows.value.length) cursor.value = Math.max(0, rows.value.length - 1)
}
clampCursor()

function switchTab(d: number) {
  const i = tabs.findIndex((t) => t.id === tab.value)
  tab.value = tabs[(i + d + tabs.length) % tabs.length].id
  cursor.value = 0
}

function onKeyDown(e: KeyboardEvent) {
  const row = rows.value[cursor.value]
  switch (e.code) {
    case 'ArrowUp':
    case 'KeyW':
      cursor.value = Math.max(0, cursor.value - 1)
      e.preventDefault()
      break
    case 'ArrowDown':
    case 'KeyS':
      cursor.value = Math.min(rows.value.length - 1, cursor.value + 1)
      e.preventDefault()
      break
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'KeyA':
    case 'KeyD':
      if (row?.kind === 'range' && row.set) {
        const delta = (e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : 1) * (row.step ?? 5)
        const cur = row.get() as number
        row.set(Math.max(row.min ?? 0, Math.min(row.max ?? 100, cur + delta)))
      }
      e.preventDefault()
      break
    case 'Enter':
    case 'Space':
      if (row?.kind === 'toggle' && row.set) {
        row.set(!(row.get() as boolean))
      } else if (row?.kind === 'range' && row.set) {
        // 环回：到底跳回最小，方便纯键盘操作
        const cur = row.get() as number
        row.set(cur >= (row.max ?? 100) ? (row.min ?? 0) : (row.max ?? 100))
      }
      e.preventDefault()
      break
    case 'KeyQ':
      switchTab(-1)
      e.preventDefault()
      break
    case 'KeyE':
      switchTab(1)
      e.preventDefault()
      break
    case 'Escape':
    case 'Backspace':
      router.push({ name: 'menu' })
      e.preventDefault()
      break
  }
}

onMounted(() => {
  // devicePixelRatio 只有浏览器里才有；SSR / 测试环境保持 1
  dpr.value = window.devicePixelRatio || 1
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

/* ---------------- 保存 ---------------- */
const savedAt = ref(0)
const saveFlash = ref(false)
let flashTimer = 0

function save() {
  localStorage.setItem(
    'fighting.settings',
    JSON.stringify({
      masterVolume: settings.masterVolume,
      bgmVolume: settings.bgmVolume,
      sfxVolume: settings.sfxVolume,
      showFps: settings.showFps,
      showHitbox: settings.showHitbox,
      fullscreen: settings.fullscreen,
      lowQuality: settings.lowQuality,
    }),
  )
  savedAt.value = Date.now()
  saveFlash.value = true
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => (saveFlash.value = false), 1600)
}

onBeforeUnmount(() => window.clearTimeout(flashTimer))
</script>

<template>
  <LogicalViewport tone="neutral">
    <div class="settings">
      <PageHeader
        kicker="OPTIONS"
        title="设置"
        sub="改动即时生效，保存在本机 localStorage。战斗内的调试叠加按 ~ 开关。"
        back="返回主菜单"
      >
        <span v-if="saveFlash" class="saved">
          <i aria-hidden="true">✓</i> 已保存
        </span>
      </PageHeader>

      <div class="body">
        <!-- 页签 -->
        <nav class="tabs">
          <button
            v-for="t in tabs"
            :key="t.id"
            class="tab"
            :class="{ on: tab === t.id }"
            @click="((tab = t.id), (cursor = 0))"
          >
            {{ t.label }}
          </button>
          <span class="tabhint">Q / E 切换</span>
        </nav>

        <!-- 行 -->
        <section class="panel">
          <ul class="rows">
            <li
              v-for="(r, i) in rows"
              :key="r.id"
              class="row"
              :class="{ focused: cursor === i, inert: r.kind === 'info' }"
              @mouseenter="cursor = i"
            >
              <div class="lbl">
                <span class="name">{{ r.label }}</span>
                <span v-if="r.note" class="note">{{ r.note }}</span>
              </div>

              <div class="ctl">
                <!-- 开关 -->
                <button
                  v-if="r.kind === 'toggle'"
                  class="switch"
                  :class="{ on: r.get() }"
                  @click="r.set?.(!r.get())"
                >
                  <span class="knob" />
                </button>

                <!-- 滑条 -->
                <div v-else-if="r.kind === 'range'" class="range">
                  <span class="val">{{ r.get() }}{{ r.unit }}</span>
                  <div class="track" @click="r.set?.(r.max ?? 100)">
                    <div class="fill" :style="{ width: (r.get() as number) + '%' }" />
                  </div>
                </div>

                <!-- 只读 -->
                <span v-else class="ro">
                  {{ keyMap[r.id] ?? resText }}
                </span>
              </div>
            </li>
          </ul>

          <p v-if="tab === 'keys'" class="footnote">
            键位在 v1 不做自定义。原因是这套键位与手柄映射共用一张表，
            改了要同步改 UI 提示、教程与回放里的输入编码说明——等手柄接入后一起做。
          </p>
          <p v-else-if="tab === 'video'" class="footnote">
            渲染分辨率固定在 1280×720 逻辑像素，窗口大小只改 CSS 缩放。
            物理常量的可读性建立在这条约束上，放开会牵动全部手感调参。
          </p>
        </section>
      </div>

      <footer class="savebar">
        <span class="who">{{ session.user?.nickname }}</span>
        <button class="ui-btn ui-btn-primary" @click="save">保存设置</button>
      </footer>

      <HintBar :hints="[{ key: '↑↓', label: '选择' }, { key: 'Enter', label: '切换' }, { key: 'ESC', label: '返回' }]" />
    </div>
  </LogicalViewport>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

/* 顶栏右侧的「已保存」小提示 */
.saved {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  font-size: var(--fs-tiny);
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 34%, transparent);
  border-radius: 999px;
  animation: pop 200ms var(--ease-out-soft) both;
}

.saved i {
  font-style: normal;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.body {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: var(--s-6);
  flex: 1;
  min-height: 0;
  padding: var(--s-6) var(--s-7);
}

/* 页签 */
.tabs {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  align-content: start;
}

.tab {
  position: relative;
  padding: var(--s-3) var(--s-4);
  text-align: left;
  font-size: var(--fs-body);
  color: var(--fg-1);
  border-radius: var(--r-2);
  transition: background var(--t-fast) var(--ease-standard),
    color var(--t-fast) var(--ease-standard);
}

.tab:hover {
  background: var(--bg-2);
}

.tab.on {
  color: var(--fg-0);
  background: var(--bg-2);
  box-shadow: inset 3px 0 0 var(--brand);
}

.tabhint {
  margin-top: var(--s-3);
  padding-left: var(--s-4);
  font-size: 10px;
  color: var(--fg-2);
}

/* 行 */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  min-width: 0;
  overflow: auto;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-6);
  min-height: 56px;
  padding: var(--s-3) var(--s-4);
  border-radius: var(--r-2);
  border: 1px solid transparent;
  transition: background var(--t-fast) var(--ease-standard),
    border-color var(--t-fast) var(--ease-standard);
}

.row.focused {
  background: var(--bg-2);
  border-color: var(--line);
}

.row.inert {
  opacity: 0.9;
}

.lbl {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-size: var(--fs-body);
  color: var(--fg-0);
}

.note {
  font-size: var(--fs-tiny);
  color: var(--fg-2);
  line-height: 1.5;
}

.ctl {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

/* 开关 */
.switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
  padding: 0;
  border-radius: 13px;
  background: var(--bg-3);
  border: 1px solid var(--line-strong);
  transition: background var(--t-mid) var(--ease-standard);
}

.switch.on {
  background: color-mix(in srgb, var(--brand) 26%, var(--bg-3));
  border-color: color-mix(in srgb, var(--brand) 60%, var(--line-strong));
}

.knob {
  position: absolute;
  top: 50%;
  left: 2px;
  width: 20px;
  height: 20px;
  margin-top: -10px;
  border-radius: 50%;
  background: var(--fg-2);
  transition: transform var(--t-mid) var(--ease-out-soft),
    background var(--t-mid) var(--ease-standard);
}

.switch.on .knob {
  transform: translateX(22px);
  background: var(--brand);
}

/* 滑条 */
.range {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.val {
  min-width: 46px;
  font-family: var(--font-num);
  font-size: var(--fs-small);
  text-align: right;
  color: var(--fg-0);
}

.track {
  width: 200px;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-3);
  overflow: hidden;
  cursor: pointer;
}

.fill {
  height: 100%;
  background: linear-gradient(90deg, var(--info), var(--brand));
  transition: width var(--t-fast) linear;
}

.ro {
  font-family: var(--font-mono);
  font-size: var(--fs-small);
  color: var(--fg-1);
}

.footnote {
  margin: 0;
  padding: var(--s-3) var(--s-4);
  font-size: var(--fs-tiny);
  line-height: 1.8;
  color: var(--fg-2);
  border-left: 2px solid var(--line-strong);
  background: color-mix(in srgb, var(--bg-1) 60%, transparent);
  border-radius: 0 var(--r-2) var(--r-2) 0;
}

/* 保存条 */
.savebar {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  height: 56px;
  padding: 0 var(--s-7);
  border-top: 1px solid var(--line);
}

.who {
  margin-left: auto;
  font-size: var(--fs-tiny);
  color: var(--fg-2);
}
</style>
