<script setup lang="ts">
/**
 * Boot：预热资源、检查 WebGL，然后进登录页。
 * 单机阶段没有真资源要载，用一个 ~1.1s 的假进度模拟，
 * 顺便验证「<300ms 不显示加载条」的规则。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import { useSessionStore } from '@/stores'

const router = useRouter()
const session = useSessionStore()

const progress = ref(0)
const visible = ref(false)
const failed = ref<string | null>(null)
/** 已完成的启动步骤，用来滚日志 */
const done = ref<string[]>([])
const current = ref('')

function checkWebGL(): string | null {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    if (!gl) return '这台设备的浏览器没有可用的 WebGL。已尝试 webgl2 与 webgl。'
    return null
  } catch {
    return '创建 WebGL 上下文时抛异常，通常是显卡驱动或硬件加速被关闭。'
  }
}

const STEPS: { p: number; k: string; label: string }[] = [
  { p: 14, k: 'cfg', label: '读取本地配置与设置' },
  { p: 30, k: 'ruleset', label: '校验角色数据 rulesetHash' },
  { p: 48, k: 'stage', label: '装载场地与平台数据' },
  { p: 64, k: 'chars', label: '索引角色部件与姿势表' },
  { p: 82, k: 'audio', label: '准备音频上下文' },
  { p: 100, k: 'done', label: '就绪' },
]

onMounted(async () => {
  failed.value = checkWebGL()

  // 300ms 内完成就不显示进度条，避免闪一下
  const showTimer = window.setTimeout(() => {
    visible.value = true
  }, 300)

  for (const s of STEPS) {
    current.value = s.label
    await new Promise((r) => window.setTimeout(r, 170))
    progress.value = s.p
    if (s.k !== 'done') done.value.push(s.k)
  }
  current.value = ''

  window.clearTimeout(showTimer)
  await new Promise((r) => window.setTimeout(r, 180))

  if (failed.value) return

  session.markReady()
  await router.replace({ name: 'login' })
})
</script>

<template>
  <LogicalViewport tone="brand" :grid="false" scan>
    <div class="boot">
      <!-- 中心标志 -->
      <div class="mark">
        <div class="ring" aria-hidden="true">
          <span class="ring-arc" />
          <span class="core" />
        </div>
        <h1 class="title">残灯台</h1>
        <p class="sub">DYING BEACON</p>
        <p class="sub2">浏览器平台格斗 · 原型</p>
      </div>

      <div v-if="visible || failed" class="status">
        <template v-if="failed">
          <div class="fail ui-panel">
            <p class="err-title">无法启动</p>
            <p class="err-body">{{ failed }}</p>
            <p class="err-hint">
              在 Chrome 里打开 <code>chrome://gpu</code>，看 “WebGL” 一行是否 Hardware accelerated。
            </p>
          </div>
        </template>
        <template v-else>
          <div class="bar">
            <div class="fill" :style="{ width: progress + '%' }" />
            <div class="bar-glow" :style="{ left: progress + '%' }" />
          </div>
          <div class="bar-foot">
            <span class="pct ui-num">{{ String(progress).padStart(3, '0') }}%</span>
            <span class="cstep">{{ current }}</span>
          </div>
          <ul class="log">
            <li v-for="(k, i) in done" :key="k" :style="{ animationDelay: `${i * 20}ms` }">
              <span class="tick" aria-hidden="true">✓</span>{{ k }}
            </li>
          </ul>
        </template>
      </div>
    </div>
  </LogicalViewport>
</template>

<style scoped>
.boot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: 56px;
}

/* ---------- 标志 ---------- */
.mark {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-2);
  animation: rise 520ms var(--ease-out-soft) both;
}

/* 外圈：旋转的缺口环，暗示"在转" */
.ring {
  position: relative;
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  margin-bottom: var(--s-4);
}

.ring-arc {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--brand);
  border-right-color: color-mix(in srgb, var(--brand) 32%, transparent);
  animation: spin 1.6s linear infinite;
}

.core {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: linear-gradient(135deg, var(--brand) 0%, var(--brand-dim) 100%);
  box-shadow:
    0 0 42px color-mix(in srgb, var(--brand) 46%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.title {
  margin: 0;
  font-size: 44px;
  font-weight: 800;
  letter-spacing: 0.24em;
  text-indent: 0.24em;
  color: var(--fg-0);
}

.sub {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.42em;
  text-indent: 0.42em;
  color: var(--brand);
}

.sub2 {
  margin: 0;
  font-size: var(--fs-tiny);
  letter-spacing: 0.2em;
  color: var(--fg-2);
}

/* ---------- 状态 ---------- */
.status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-3);
  width: 380px;
  animation: fade 260ms var(--ease-standard) both;
}

.bar {
  position: relative;
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--bg-3) 80%, transparent);
  overflow: visible;
}

.fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--brand-dim), var(--brand));
  transition: width 170ms linear;
}

/* 进度头上一颗光点，让 3px 细条也能读出进度 */
.bar-glow {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 14px var(--brand);
  transform: translate(-50%, -50%);
  transition: left 170ms linear;
}

.bar-foot {
  display: flex;
  justify-content: space-between;
  width: 100%;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--fg-2);
}

.pct {
  color: var(--brand);
}

.cstep {
  min-height: 14px;
}

.log {
  display: flex;
  gap: var(--s-3);
  margin: var(--s-2) 0 0;
  padding: 0;
  list-style: none;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--fg-2);
}

.log li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  animation: fade 220ms var(--ease-standard) both;
}

.tick {
  color: var(--success);
}

/* ---------- 失败 ---------- */
.fail {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  width: 100%;
  padding: var(--s-5);
  border-color: color-mix(in srgb, var(--danger) 44%, var(--line));
}

.err-title {
  margin: 0;
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--danger);
}

.err-body {
  margin: 0;
  font-size: var(--fs-small);
  line-height: 1.7;
  color: var(--fg-1);
}

.err-hint {
  margin: 0;
  font-size: var(--fs-tiny);
  line-height: 1.7;
  color: var(--fg-2);
}

code {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 5px;
  border-radius: var(--r-1);
  background: var(--bg-3);
  color: var(--brand);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
