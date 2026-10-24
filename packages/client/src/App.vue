<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
// 用 route.name 做 key，页面切换时整体重建，避免残留状态
const routeKey = computed(() => String(route.name ?? route.path))
</script>

<template>
  <div class="app-root">
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="routeKey" />
      </Transition>
    </RouterView>
  </div>
</template>

<style scoped>
.app-root {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-0);
}

/* 页面转场 300ms，见 04 第 6 章动效档位。
   进：淡入 + 轻微上移 + 从 1.008 缩回 1 —— 速度感来自缩放而不是位移。
   出：只淡出且更快（200ms），避免两页同时占屏。 */
.page-enter-active {
  transition:
    opacity var(--t-slow) var(--ease-out-soft),
    transform var(--t-slow) var(--ease-out-soft),
    filter var(--t-slow) var(--ease-out-soft);
}
.page-leave-active {
  transition:
    opacity var(--t-mid) var(--ease-in-hard),
    filter var(--t-mid) var(--ease-in-hard);
}
.page-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(1.008);
  filter: blur(2px);
}
.page-leave-to {
  opacity: 0;
  filter: blur(2px);
}
</style>
