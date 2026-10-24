<script setup lang="ts">
/**
 * 角色占位立绘：用角色配色画一个站立剪影。
 * 正式美术到位后换成 <img> / 部件骨骼，这里的 API 保持不变。
 *
 * 视觉总高约 88 逻辑像素 = 碰撞体 64 + 头顶装饰 + 描边（见 04 第 1.3 节）。
 * 尺寸全部用百分比，所以 44px 的头像和 196px 的立绘是同一套形状。
 */
import { computed } from 'vue'
import type { CharDef } from '@/types'

const props = withDefaults(
  defineProps<{
    char: CharDef
    /** 展示高度，px。默认 88 = 战斗中的视觉总高 */
    height?: number
    /** 是否显示朝向高光 */
    glow?: boolean
  }>(),
  { height: 88, glow: false },
)

const w = computed(() => Math.round(props.height * 0.5))

const style = computed(() => ({
  width: `${w.value}px`,
  height: `${props.height}px`,
  '--c': props.char.color,
  '--cd': props.char.colorDark,
}))

const showFace = computed(() => !props.char.locked)

/** 体型差异：重型角色肩更宽、头更小，轻型反过来 */
const shape = computed(() => {
  const wc = props.char.weightClass
  if (wc === 'heavy') return { torso: '62%', head: '22%', legs: '38%' }
  if (wc === 'light') return { torso: '44%', head: '27%', legs: '30%' }
  return { torso: '52%', head: '25%', legs: '34%' }
})
</script>

<template>
  <div class="char-silhouette" :style="style" :title="char.displayName">
    <div v-if="glow && showFace" class="glow" aria-hidden="true" />
    <div class="shadow" aria-hidden="true" />

    <div class="fig" :class="{ ghost: !showFace }">
      <!-- 后手（远端） -->
      <span class="arm left" aria-hidden="true" />
      <span class="arm right" aria-hidden="true" />

      <!-- 腿 -->
      <span class="leg left" :style="{ width: shape.legs }" aria-hidden="true" />
      <span class="leg right" :style="{ width: shape.legs }" aria-hidden="true" />

      <!-- 躯干：上宽下窄的梯形 -->
      <span class="torso" :style="{ width: shape.torso }" aria-hidden="true" />

      <!-- 头 -->
      <span class="head" :style="{ width: shape.head }" aria-hidden="true">
        <i v-if="showFace" class="crest" />
        <b v-else class="lock">?</b>
      </span>
    </div>
  </div>
</template>

<style scoped>
.char-silhouette {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.6));
}

/* 地面投影，让角色"站"在地上而不是浮着 */
.shadow {
  position: absolute;
  left: 50%;
  bottom: -3%;
  width: 74%;
  height: 9%;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(0, 0, 0, 0.62) 0%, transparent 72%);
  transform: translateX(-50%);
}

.fig {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  width: 100%;
  height: 100%;
}

/* ---------- 躯干 ---------- */
.torso {
  position: relative;
  height: 44%;
  flex: none;
  background: linear-gradient(180deg, var(--c) 0%, var(--cd) 100%);
  border: 2px solid var(--ink);
  border-radius: 26% 26% 14% 14%;
  z-index: 3;
  clip-path: polygon(9% 0, 91% 0, 100% 100%, 0 100%);
}

/* ---------- 头 ---------- */
.head {
  position: relative;
  aspect-ratio: 1;
  flex: none;
  margin-bottom: -4%;
  border-radius: 50%;
  background: var(--c);
  border: 2px solid var(--ink);
  z-index: 4;
  box-shadow: inset -3px -4px 0 color-mix(in srgb, var(--cd) 90%, #000);
}

/* 头顶小尖角：给剪影加辨识度，也凑够 88px 的视觉总高 */
.crest {
  position: absolute;
  left: 50%;
  top: -26%;
  width: 34%;
  height: 40%;
  background: var(--c);
  border: 2px solid var(--ink);
  border-bottom: none;
  border-radius: 50% 50% 0 0 / 100% 100% 0 0;
  transform: translateX(-50%);
}

.lock {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 62%;
  font-weight: 800;
  color: color-mix(in srgb, var(--fg-2) 85%, #000);
}

/* ---------- 手臂 ---------- */
.arm {
  position: absolute;
  top: 44%;
  width: 11%;
  height: 34%;
  background: var(--cd);
  border: 2px solid var(--ink);
  border-radius: 40% 40% 34% 34%;
  z-index: 2;
  transform-origin: top center;
}

.arm.left {
  left: 12%;
  transform: rotate(9deg);
}

.arm.right {
  right: 12%;
  transform: rotate(-9deg);
}

/* ---------- 腿 ---------- */
.leg {
  position: absolute;
  bottom: 0;
  height: 34%;
  background: var(--cd);
  border: 2px solid var(--ink);
  border-radius: 12% 12% 26% 26%;
  z-index: 1;
}

.leg.left {
  left: 22%;
}

.leg.right {
  right: 22%;
}

/* ---------- 未解锁：整体去色 ---------- */
.fig.ghost {
  filter: grayscale(1) brightness(0.55);
  opacity: 0.75;
}

.glow {
  position: absolute;
  inset: -22%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--c) 34%, transparent) 0%,
    transparent 66%
  );
  pointer-events: none;
  animation: breathe 4.2s var(--ease-standard) infinite alternate;
}

@keyframes breathe {
  from {
    opacity: 0.5;
    transform: scale(0.98);
  }
  to {
    opacity: 0.85;
    transform: scale(1.04);
  }
}
</style>
