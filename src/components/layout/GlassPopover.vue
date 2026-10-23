<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 隐藏式 Popover：从触发按钮位置弹出，用于任务行的小操作。
 * 点击外部 / Esc 关闭，关闭后焦点回到触发按钮。
 */
const props = withDefaults(
  defineProps<{
    align?: 'left' | 'right'
    label?: string
  }>(),
  { align: 'right', label: '更多操作' },
)

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)

function toggle(): void {
  open.value = !open.value
}

async function openPanel(): Promise<void> {
  open.value = true
  await nextTick()
  panelRef.value?.querySelector<HTMLElement>('button, a[href]')?.focus()
}

function close(restoreFocus = true): void {
  open.value = false
  if (restoreFocus) triggerRef.value?.focus()
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!open.value) return
  const target = event.target as Node | null
  if (target && rootRef.value?.contains(target)) return
  close(false)
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

watch(open, (value) => {
  if (value) {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})

defineExpose({ close })
</script>

<template>
  <div ref="rootRef" class="popover">
    <button
      ref="triggerRef"
      type="button"
      class="popover__trigger"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open ? close() : openPanel()"
    >
      <slot name="trigger" :open="open">
        <span class="popover__dots" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
      </slot>
    </button>

    <Transition name="pop">
      <div
        v-if="open"
        ref="panelRef"
        class="glass glass--strong popover__panel"
        :class="`popover__panel--${align}`"
        role="menu"
        tabindex="-1"
      >
        <slot :close="close" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.popover {
  position: relative;
  display: inline-flex;
}

.popover__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.popover__trigger:hover {
  background: var(--glass-bg-soft);
  border-color: var(--glass-border-soft);
}

.popover__dots {
  display: inline-flex;
  gap: 3px;
}

.popover__dots i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
}

.popover__panel {
  position: absolute;
  top: calc(100% + 10px);
  z-index: 40;
  min-width: 184px;
  padding: 8px;
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 2px;
  transform-origin: top right;
}

.popover__panel--right {
  right: 0;
}

.popover__panel--left {
  left: 0;
  transform-origin: top left;
}

.popover__panel :deep(button),
.popover__panel :deep(a) {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.popover__panel :deep(button:hover),
.popover__panel :deep(a:hover) {
  background: var(--accent-softer);
  color: var(--text-strong);
}

.popover__panel :deep(.is-danger) {
  color: var(--danger);
}

.pop-enter-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-in),
    transform var(--dur-fast) var(--ease-in);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: scale(0.92) translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .pop-enter-from,
  .pop-leave-to {
    transform: none;
  }
}
</style>
