<script setup lang="ts">
import { useFocusThemeStore, type FocusThemeId } from '@/stores/focusTheme'

const store = useFocusThemeStore()
const themes = store.themes

function select(id: FocusThemeId): void {
  store.setTheme(id)
}
</script>

<template>
  <div class="focus-theme-switcher" role="group" aria-label="沉浸主题">
    <button
      v-for="item in themes"
      :key="item.id"
      type="button"
      class="focus-theme-dot"
      :class="{ 'is-active': store.theme === item.id }"
      :style="{ '--dot-color': item.dot }"
      :aria-label="`切换到${item.label}主题：${item.description}`"
      :aria-pressed="store.theme === item.id"
      :title="item.label"
      @click="select(item.id)"
    >
      <span class="focus-theme-dot__core" aria-hidden="true"></span>
      <span class="focus-theme-dot__label">{{ item.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.focus-theme-switcher {
  position: fixed;
  right: clamp(16px, 3vw, 32px);
  bottom: clamp(18px, 3vw, 30px);
  z-index: 24;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--focus-border);
  background: var(--focus-glass);
  box-shadow: 0 10px 30px -22px var(--focus-halo);
  -webkit-backdrop-filter: blur(18px) saturate(130%);
  backdrop-filter: blur(18px) saturate(130%);
}

.focus-theme-dot {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.focus-theme-dot__core {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--dot-color);
  box-shadow: 0 0 14px color-mix(in srgb, var(--dot-color) 55%, transparent);
  opacity: 0.55;
  transition:
    transform 0.4s var(--ease-spring),
    opacity 0.4s ease;
}

.focus-theme-dot:hover .focus-theme-dot__core,
.focus-theme-dot.is-active .focus-theme-dot__core {
  transform: scale(1.28);
  opacity: 1;
}

.focus-theme-dot.is-active {
  border-color: color-mix(in srgb, var(--dot-color) 50%, transparent);
  background: color-mix(in srgb, var(--dot-color) 13%, transparent);
}

.focus-theme-dot__label {
  position: absolute;
  right: 50%;
  bottom: calc(100% + 8px);
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--focus-border);
  background: var(--focus-panel);
  color: var(--focus-text);
  font-size: 9px;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0;
  transform: translate(50%, 4px);
  pointer-events: none;
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.focus-theme-dot:hover .focus-theme-dot__label,
.focus-theme-dot:focus-visible .focus-theme-dot__label {
  opacity: 1;
  transform: translate(50%, 0);
}

.focus-theme-dot:focus-visible {
  outline: 2px solid var(--focus-accent);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .focus-theme-switcher {
    right: 14px;
    bottom: 76px;
  }

  .focus-theme-dot {
    width: 27px;
    height: 27px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .focus-theme-dot__core,
  .focus-theme-dot__label {
    transition: none;
  }
}
</style>
