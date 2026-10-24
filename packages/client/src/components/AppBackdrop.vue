<script setup lang="ts">
/**
 * 全站背景层。所有非战斗页面共用，负责"同一个游戏"的统一感。
 *
 * 为什么单独抽一层而不是每页各写一个渐变：
 * 1. 页面转场时背景如果是每页自己的元素，切换会闪一下底色；
 *    背景做成一致的层之后，只有内容在动，观感上是"同一个世界换了一屏"。
 * 2. 呼吸光晕需要长时间动画，放在每页里会被重复创建/销毁，掉帧。
 */
withDefaults(
  defineProps<{
    /** 主色调倾向：中性青灰 / 品牌黄绿 / 暖橙（战斗相关页用暖色） */
    tone?: 'neutral' | 'brand' | 'warm'
    /** 是否画细网格。列表页建议开，视觉上像"机台面板" */
    grid?: boolean
    /** 是否画横向扫描线。克制使用，只给标题页 */
    scan?: boolean
  }>(),
  { tone: 'neutral', grid: true, scan: false },
)
</script>

<template>
  <div class="backdrop" :class="[`t-${tone}`, { 'has-grid': grid, 'has-scan': scan }]">
    <div class="glow glow-a" aria-hidden="true" />
    <div class="glow glow-b" aria-hidden="true" />
    <div class="grid" aria-hidden="true" />
    <div class="scan" aria-hidden="true" />
    <div class="vignette" aria-hidden="true" />
  </div>
</template>

<style scoped>
.backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 18% 12%, var(--bg-2) 0%, transparent 58%),
    radial-gradient(90% 80% at 88% 92%, color-mix(in srgb, var(--bg-2) 70%, #000) 0%, transparent 62%),
    var(--bg-0);
}

/* 两团缓慢呼吸的光晕，相位错开，避免整屏同步闪 */
.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.34;
  will-change: transform, opacity;
}

.glow-a {
  width: 560px;
  height: 560px;
  left: -140px;
  top: -180px;
  background: radial-gradient(circle, var(--tint-a) 0%, transparent 68%);
  animation: breathe-a 11s var(--ease-standard) infinite alternate;
}

.glow-b {
  width: 720px;
  height: 720px;
  right: -220px;
  bottom: -280px;
  background: radial-gradient(circle, var(--tint-b) 0%, transparent 70%);
  opacity: 0.26;
  animation: breathe-b 15s var(--ease-standard) infinite alternate;
}

@keyframes breathe-a {
  from {
    transform: translate3d(0, 0, 0) scale(1);
    opacity: 0.26;
  }
  to {
    transform: translate3d(46px, 28px, 0) scale(1.14);
    opacity: 0.4;
  }
}

@keyframes breathe-b {
  from {
    transform: translate3d(0, 0, 0) scale(1.06);
    opacity: 0.18;
  }
  to {
    transform: translate3d(-52px, -34px, 0) scale(1);
    opacity: 0.32;
  }
}

/* 细网格：32px 一格，双色叠加营造纵深感 */
.grid {
  position: absolute;
  inset: 0;
  opacity: 0.5;
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--line) 42%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--line) 42%, transparent) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(120% 100% at 50% 40%, #000 20%, transparent 78%);
  -webkit-mask-image: radial-gradient(120% 100% at 50% 40%, #000 20%, transparent 78%);
}

.backdrop:not(.has-grid) .grid {
  display: none;
}

/* 横向扫描线，3px 一条，极低对比 —— 只在标题页用 */
.scan {
  position: absolute;
  inset: 0;
  opacity: 0.16;
  background: repeating-linear-gradient(
    to bottom,
    color-mix(in srgb, var(--fg-1) 30%, transparent) 0px,
    color-mix(in srgb, var(--fg-1) 30%, transparent) 1px,
    transparent 1px,
    transparent 3px
  );
  pointer-events: none;
}

.backdrop:not(.has-scan) .scan {
  display: none;
}

/* 暗角：把注意力压向画面中心 */
.vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(110% 96% at 50% 46%, transparent 44%, rgba(2, 3, 6, 0.72) 100%);
  pointer-events: none;
}

/* ---------- 色调 ---------- */
.t-neutral {
  --tint-a: #2b3a52;
  --tint-b: #1a2532;
}

.t-brand {
  --tint-a: color-mix(in srgb, var(--brand) 30%, #21301a);
  --tint-b: #16202c;
}

.t-warm {
  --tint-a: color-mix(in srgb, var(--p2) 34%, #2a1a12);
  --tint-b: #241820;
}
</style>
