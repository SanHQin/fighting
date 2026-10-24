<script setup lang="ts">
/**
 * 菜单项。焦点由父级 focusedId 驱动，不用 :focus。
 * 焦点态 = 左 4px 强调条 + 渐变扫过 + scale 1.02，见 04 第 4 章主菜单线框。
 */
withDefaults(
  defineProps<{
    label: string
    sub?: string
    focused?: boolean
    disabled?: boolean
    danger?: boolean
    /** 序号，给了就显示 01 / 02；不传则不占位 */
    index?: number
    /** 禁用时的说明，替代 sub 显示 */
    note?: string
  }>(),
  { focused: false, disabled: false, danger: false, index: 0, note: '' },
)

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'hover'): void }>()
</script>

<template>
  <button
    class="menu-item"
    :class="{ 'is-focused': focused, 'is-danger': danger, 'is-off': disabled }"
    :disabled="disabled"
    @click="emit('confirm')"
    @mouseenter="emit('hover')"
  >
    <span class="bar" aria-hidden="true" />
    <span v-if="index > 0" class="idx ui-num" aria-hidden="true">
      {{ String(index).padStart(2, '0') }}
    </span>
    <span class="text">
      <span class="label">{{ label }}</span>
      <span v-if="note" class="sub note">{{ note }}</span>
      <span v-else-if="sub" class="sub">{{ sub }}</span>
    </span>
    <span class="chev" aria-hidden="true">›</span>
  </button>
</template>

<style scoped>
.menu-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  min-width: 240px;
  padding: var(--s-3) var(--s-4) var(--s-3) var(--s-5);
  text-align: left;
  border-radius: var(--r-2);
  background: transparent;
  overflow: hidden;
  transition:
    background var(--t-fast) var(--ease-standard),
    transform var(--t-fast) var(--ease-standard);
}

/* 悬停时的极淡底色，与焦点态区分开（焦点更强） */
.menu-item:hover:not(:disabled):not(.is-focused) {
  background: color-mix(in srgb, var(--bg-3) 46%, transparent);
}

.menu-item.is-focused {
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--bg-3) 96%, transparent) 0%,
    color-mix(in srgb, var(--bg-3) 42%, transparent) 72%,
    transparent 100%
  );
  transform: scale(1.02);
  transform-origin: left center;
  outline: none;
}

.menu-item.is-off {
  cursor: not-allowed;
}

/* 左侧强调条：焦点态从中间长出来 */
.bar {
  position: absolute;
  left: 0;
  top: 50%;
  width: 4px;
  height: 0;
  border-radius: 0 var(--r-1) var(--r-1) 0;
  background: var(--brand);
  box-shadow: 0 0 12px color-mix(in srgb, var(--brand) 70%, transparent);
  transform: translateY(-50%);
  transition: height var(--t-fast) var(--ease-standard);
}

.menu-item.is-focused .bar {
  height: 64%;
}

.is-danger .bar {
  background: var(--danger);
  box-shadow: 0 0 12px color-mix(in srgb, var(--danger) 70%, transparent);
}

/* 序号：等宽数字，焦点时点亮 */
.idx {
  width: 18px;
  flex: none;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--line-strong);
  transition: color var(--t-fast) var(--ease-standard);
}

.menu-item.is-focused .idx {
  color: var(--brand);
}

.is-danger .idx {
  color: color-mix(in srgb, var(--danger) 60%, var(--line-strong));
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.label {
  font-size: var(--fs-h3);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--fg-1);
  transition: color var(--t-fast) var(--ease-standard);
}

.menu-item.is-focused .label {
  color: var(--fg-0);
}

.is-danger .label {
  color: color-mix(in srgb, var(--danger) 82%, #fff);
}

.is-off .label {
  color: var(--fg-2);
}

.sub {
  font-size: var(--fs-tiny);
  color: var(--fg-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub.note {
  color: color-mix(in srgb, var(--warn) 70%, var(--fg-2));
}

.chev {
  font-size: 22px;
  line-height: 1;
  color: var(--brand);
  opacity: 0;
  transform: translateX(-6px);
  transition:
    opacity var(--t-fast) var(--ease-standard),
    transform var(--t-mid) var(--ease-out-soft);
}

.menu-item.is-focused .chev {
  opacity: 1;
  transform: translateX(0);
}
</style>
