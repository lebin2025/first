<script setup lang="ts">
import { useToast } from '@/composables/useToast'

/** 全局轻提示：底部居中，自动退场 */
const { toasts, dismiss } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="toast-host" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="toast">
        <button
          v-for="toast in toasts"
          :key="toast.id"
          type="button"
          class="glass toast"
          :class="[`toast--${toast.type}`, { 'toast--leaving': toast.leaving }]"
          @click="dismiss(toast.id)"
        >
          <span class="toast__dot" aria-hidden="true"></span>
          <span class="toast__text">{{ toast.message }}</span>
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  bottom: max(24px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  width: min(92vw, 480px);
}

.toast {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  padding: 11px 18px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  color: var(--text-strong);
  font-size: 13px;
  text-align: left;
}

.toast__dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--accent);
}

.toast--success .toast__dot {
  background: var(--success);
}

.toast--warning .toast__dot {
  background: var(--warning);
}

.toast--error .toast__dot {
  background: var(--danger);
}

.toast__text {
  line-height: 1.4;
}

.toast-enter-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.toast-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-in),
    transform var(--dur-fast) var(--ease-in);
}

.toast-enter-from,
.toast-leave-to,
.toast--leaving {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-from,
  .toast-leave-to,
  .toast--leaving {
    transform: none;
  }
}
</style>
