<script setup lang="ts">
/**
 * 404。走到这里的常见原因：
 * 1. hash 路由手改错了（#/select/charr）
 * 2. 回放文件里记的 matchId 在本机库里不存在
 * 3. 老书签指向了改名前的路由
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import HintBar from '@/components/HintBar.vue'

const route = useRoute()
const router = useRouter()

function goMenu() {
  router.replace({ name: 'menu' })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
    e.preventDefault()
    goMenu()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <LogicalViewport tone="neutral" :grid="true">
    <div class="nf">
      <div class="numwrap" aria-hidden="true">
        <span class="big">404</span>
        <span class="ghost">404</span>
      </div>

      <span class="ui-kicker">PAGE NOT FOUND</span>
      <h1 class="title">这页不存在</h1>

      <p class="path">{{ route.fullPath }}</p>

      <p class="hint">
        如果是回放链接，说明这局对战没有存在本机；<br />
        如果是收藏的旧地址，路由可能已经改过名。
      </p>

      <div class="acts">
        <button class="ui-btn ui-btn-primary" @click="goMenu">回主菜单</button>
        <button class="ui-btn ui-btn-ghost" @click="router.back()">退一步</button>
      </div>
    </div>
    <HintBar :hints="[{ key: 'Enter', label: '回主菜单' }, { key: 'Esc', label: '同样回主菜单' }]" />
  </LogicalViewport>
</template>

<style scoped>
.nf {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-3);
  width: 100%;
  height: calc(100% - 40px);
}

/* 描边数字 + 背后一层模糊残影，比单一描边字有层次 */
.numwrap {
  position: relative;
  display: grid;
  place-items: center;
  margin-bottom: var(--s-4);
}

.big,
.ghost {
  grid-area: 1 / 1;
  font-family: var(--font-num);
  font-size: 168px;
  font-weight: 800;
  line-height: 0.9;
  letter-spacing: -0.05em;
}

.big {
  color: transparent;
  -webkit-text-stroke: 2px var(--line-strong);
}

.ghost {
  color: color-mix(in srgb, var(--brand) 10%, transparent);
  filter: blur(18px);
  transform: translateY(6px) scale(1.06);
}

.title {
  margin: 0;
  font-size: var(--fs-h2);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--fg-0);
}

.path {
  margin: 0;
  padding: 3px 12px;
  font-family: var(--font-mono);
  font-size: var(--fs-tiny);
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 10%, var(--bg-1));
  border: 1px solid color-mix(in srgb, var(--warn) 26%, transparent);
  border-radius: var(--r-1);
  max-width: 560px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  margin: var(--s-2) 0 var(--s-5);
  max-width: 460px;
  font-size: var(--fs-tiny);
  line-height: 1.95;
  text-align: center;
  color: var(--fg-2);
}

.acts {
  display: flex;
  gap: var(--s-3);
}
</style>
