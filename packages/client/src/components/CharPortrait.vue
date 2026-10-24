<script setup lang="ts">
/**
 * 角色立绘：有正式美术就画图，没有就回落几何剪影。
 *
 * 刻意不做「加载中 → 骨架屏 → 失败占位」三态：立绘都是 webp、单张 < 80KB、
 * 选人页同屏最多 4 张，闪一下不如直接显示剪影来得稳。真要做三态，先加
 * loading 占位而不是骨架屏——骨架屏在小图上更像故障。
 */
import { computed, ref } from 'vue'
import type { CharDef } from '@/types'
import { artOf } from '@/game/portraits'
import CharSilhouette from './CharSilhouette.vue'

const props = withDefaults(
  defineProps<{
    char: CharDef
    /** 展示高度，px。默认 88 = 战斗中的视觉总高 */
    height?: number
    glow?: boolean
    /** 强制只画剪影（列表项等场景下图片细节反而糊） */
    silhouetteOnly?: boolean
    /** 用 1:1 头像而不是 3:5 立绘（底部网格、HUD 用） */
    icon?: boolean
  }>(),
  { height: 88, glow: false, silhouetteOnly: false, icon: false },
)

const art = computed(() => (props.silhouetteOnly ? null : artOf(props.char.id)))
const src = computed(() => {
  const a = art.value
  if (!a) return null
  return props.icon ? (a.icon ?? a.portrait ?? null) : (a.portrait ?? a.icon ?? null)
})
const useImage = computed(() => Boolean(src.value) && !props.char.locked)
const failed = ref(false)

const imgStyle = computed(() => {
  // 头像本身已居中裁好，不需要再放大；立绘按 portraitFill 放大再裁
  const fill = props.icon ? 1 : (art.value?.portraitFill ?? 1)
  const scale = fill > 0 ? 1 / fill : 1
  return {
    height: `${props.height}px`,
    transform: `scale(${scale})`,
  }
})

const boxStyle = computed(() => ({
  width: `${Math.round(props.height * (props.icon ? 1 : 0.6))}px`,
  height: `${props.height}px`,
  '--c': props.char.color,
}))
</script>

<template>
  <div class="char-portrait" :style="boxStyle" :title="char.displayName">
    <div v-if="glow && !char.locked" class="glow" aria-hidden="true" />
    <img
      v-if="useImage && !failed"
      class="shot"
      :src="src!"
      :alt="char.displayName"
      :style="imgStyle"
      decoding="async"
      draggable="false"
      @error="failed = true"
    />
    <CharSilhouette v-else :char="char" :height="height" :glow="glow" />
  </div>
</template>

<style scoped>
.char-portrait {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
}

.shot {
  display: block;
  width: auto;
  object-fit: contain;
  transform-origin: bottom center;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.55));
  user-select: none;
}

.glow {
  position: absolute;
  inset: -18%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--c) 30%, transparent) 0%,
    transparent 68%
  );
  pointer-events: none;
}
</style>
