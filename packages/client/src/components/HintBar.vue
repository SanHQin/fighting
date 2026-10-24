<script setup lang="ts">
/**
 * 底部提示条。文案一律用中文动词「确认 / 返回」，不画 ✕○ 图标——
 * Switch 的 A/B 与 Xbox 相反，画图形只会让人按错（见 04 第 4 章）。
 * 中间留 slot 给页面自己的状态（如「已选：磨刀匠·砺」）。
 */
withDefaults(
  defineProps<{
    hints?: { key: string; label: string }[]
    version?: string
  }>(),
  {
    hints: () => [
      { key: 'Enter', label: '确认' },
      { key: 'Esc', label: '返回' },
    ],
    version: 'v0.1.0-dev',
  },
)
</script>

<template>
  <footer class="hint-bar">
    <div class="left">
      <span v-for="h in hints" :key="h.key" class="hint">
        <kbd>{{ h.key }}</kbd>
        <span class="hl">{{ h.label }}</span>
      </span>
    </div>
    <div class="mid">
      <slot />
    </div>
    <div class="right">
      <span class="ver">{{ version }}</span>
    </div>
  </footer>
</template>

<style scoped>
.hint-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-5);
  height: 40px;
  padding: 0 var(--s-5);
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--bg-1) 84%, transparent);
  backdrop-filter: blur(8px);
}

/* 顶部一道极淡的品牌色渐变，让底栏跟画面有联系而不是"贴了条灰带" */
.hint-bar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -1px;
  height: 1px;
  background: linear-gradient(
    to right,
    transparent,
    color-mix(in srgb, var(--brand) 42%, transparent) 26%,
    color-mix(in srgb, var(--brand) 12%, transparent) 64%,
    transparent
  );
}

.left {
  display: flex;
  gap: var(--s-5);
  flex: none;
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
}

kbd {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1;
  color: var(--fg-1);
  background: linear-gradient(180deg, var(--bg-3) 0%, color-mix(in srgb, var(--bg-3) 70%, #000) 100%);
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: var(--r-1);
}

.hl {
  font-size: var(--fs-tiny);
  color: var(--fg-2);
}

.mid {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-3);
  font-size: var(--fs-tiny);
  color: var(--fg-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.right {
  flex: none;
}

.ver {
  padding: 1px 7px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--fg-2);
  border: 1px solid var(--line);
  border-radius: 999px;
}
</style>
