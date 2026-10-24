<script setup lang="ts">
/**
 * 页面标题块。五个二级页共用，保证标题的字号/间距/节奏一致。
 * 右侧留一个 slot 给页面自己的状态信息（如已选角色、地图编号）。
 */
withDefaults(
  defineProps<{
    kicker?: string
    title: string
    sub?: string
    /** 返回提示文案，传空则不显示 */
    back?: string
    /** 紧凑模式：标题压到一行、隐藏 kicker 与 sub。选人/选场这种密页面用 */
    compact?: boolean
  }>(),
  { kicker: '', sub: '', back: '', compact: false },
)
</script>

<template>
  <header class="ph" :class="{ compact }">
    <div class="ph-left">
      <span v-if="kicker && !compact" class="ui-kicker">{{ kicker }}</span>
      <h1 class="ui-h1 ph-title">{{ title }}</h1>
      <p v-if="sub && !compact" class="ui-sub ph-sub">{{ sub }}</p>
    </div>
    <div class="ph-right">
      <slot />
      <span v-if="back" class="ph-back">
        <span class="ui-key">ESC</span>
        <span>{{ back }}</span>
      </span>
    </div>
  </header>
</template>

<style scoped>
.ph {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--s-6);
  padding: var(--s-5) var(--s-7) var(--s-3);
}

/* 紧凑：标题与右侧信息同一基线，纵向只占 44px 左右 */
.ph.compact {
  align-items: center;
  padding: var(--s-4) var(--s-7) var(--s-2);
}

.ph-left {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  min-width: 0;
}

.ph.compact .ph-left {
  flex-direction: row;
  align-items: baseline;
  gap: var(--s-3);
}

.ph-title {
  font-size: 30px;
}

.ph.compact .ph-title {
  font-size: 22px;
  letter-spacing: 0.06em;
}

.ph-sub {
  max-width: 680px;
}

.ph-right {
  display: flex;
  align-items: center;
  gap: var(--s-5);
  flex: none;
}

.ph-back {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  font-size: var(--fs-tiny);
  color: var(--fg-2);
  white-space: nowrap;
}
</style>
