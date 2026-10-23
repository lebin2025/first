<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/** 通用确认对话框（删除等危险操作） */
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    busy?: boolean
  }>(),
  {
    description: '',
    confirmLabel: '确认',
    cancelLabel: '取消',
    danger: false,
    busy: false,
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm'): void
}>()

const panelRef = ref<HTMLElement | null>(null)
let lastActive: HTMLElement | null = null

function close(): void {
  emit('update:modelValue', false)
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.modelValue) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    panelRef.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      lastActive = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      panelRef.value?.querySelector<HTMLButtonElement>('button')?.focus()
    } else if (lastActive) {
      lastActive.focus()
      lastActive = null
    }
  },
)

document.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="modelValue" class="dialog-root">
        <div class="dialog__backdrop" @click="close"></div>
        <div
          ref="panelRef"
          class="glass glass--strong dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
          :aria-describedby="description ? 'dialog-desc' : undefined"
        >
          <h2 id="dialog-title" class="dialog__title">{{ title }}</h2>
          <p v-if="description" id="dialog-desc" class="dialog__desc">{{ description }}</p>
          <div class="dialog__actions">
            <button type="button" class="btn btn--ghost" :disabled="busy" @click="close">
              {{ cancelLabel }}
            </button>
            <button
              type="button"
              class="btn"
              :class="danger ? 'btn--danger' : 'btn--primary'"
              :disabled="busy"
              @click="emit('confirm')"
            >
              {{ busy ? '处理中…' : confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-root {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: var(--space-4);
}

.dialog__backdrop {
  position: absolute;
  inset: 0;
  background: var(--overlay);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.dialog {
  position: relative;
  width: min(420px, 94vw);
  padding: clamp(22px, 4vw, 30px);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.dialog__title {
  font-size: 19px;
}

.dialog__desc {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
}

.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}

.dialog-enter-active .dialog,
.dialog-leave-active .dialog {
  transition: transform var(--dur-base) var(--ease-spring);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog,
.dialog-leave-to .dialog {
  transform: scale(0.94) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .dialog-enter-from .dialog,
  .dialog-leave-to .dialog {
    transform: none;
  }
}
</style>
