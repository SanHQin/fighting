<script setup lang="ts">
/**
 * 逻辑画布：把内容锁在 1280×720 的逻辑坐标里，按窗口大小整体缩放。
 * 所有 UI 页面都套这一层，内部随便用 px 写死。
 *
 * 背景默认由 AppBackdrop 提供（可关）。这样页面之间切换时，
 * 背景层不重建，只有内容在动 —— 转场不会闪底色。
 */
import { computed } from 'vue'
import { useViewport } from '@/composables/useViewport'
import AppBackdrop from './AppBackdrop.vue'

const props = withDefaults(
  defineProps<{
    /** 关掉自带背景（战斗页、或页面自己要铺满整屏时用） */
    backdrop?: boolean
    tone?: 'neutral' | 'brand' | 'warm'
    grid?: boolean
    scan?: boolean
  }>(),
  { backdrop: true, tone: 'neutral', grid: true, scan: false },
)

const { metrics } = useViewport()

const frameStyle = computed(() => ({
  width: '1280px',
  height: '720px',
  transform: `translate(${metrics.value.offsetX}px, ${metrics.value.offsetY}px) scale(${metrics.value.scale})`,
}))
</script>

<template>
  <div class="viewport">
    <AppBackdrop
      v-if="props.backdrop"
      :tone="props.tone"
      :grid="props.grid"
      :scan="props.scan"
    />
    <div class="frame" :style="frameStyle">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
}
.frame {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  overflow: hidden;
}
</style>
