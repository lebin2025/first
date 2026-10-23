<script setup lang="ts">
/**
 * 精灵式按钮。
 * 待机：主体 3s 呼吸 + 文字层 4.7s 辅助浮动（两个错峰关键帧叠加，避免机械感）。
 * 悬停：暂停呼吸，弹簧放大。点击：下压后回弹。
 * 全部动效只作用于 transform / opacity；prefers-reduced-motion 下静止。
 */
withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset'
    variant?: 'primary' | 'ghost' | 'plain' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    disabled?: boolean
    loading?: boolean
    block?: boolean
  }>(),
  {
    type: 'button',
    variant: 'primary',
    size: 'md',
    disabled: false,
    loading: false,
    block: false,
  },
)

const emit = defineEmits<{ (event: 'click', payload: MouseEvent): void }>()

function onClick(event: MouseEvent): void {
  emit('click', event)
}
</script>

<template>
  <button
    :type="type"
    class="sprite"
    :class="[`sprite--${variant}`, `sprite--${size}`, { 'sprite--block': block, 'is-loading': loading }]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <span class="sprite__sheen" aria-hidden="true"></span>
    <span class="sprite__label">
      <slot />
    </span>
    <span v-if="loading" class="sprite__spinner" aria-hidden="true"></span>
  </button>
</template>

<style scoped>
.sprite {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 28px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-pill);
  background: var(--glass-bg);
  color: var(--text-strong);
  font-size: 15px;
  font-weight: 580;
  letter-spacing: 0.01em;
  cursor: pointer;
  overflow: hidden;
  isolation: isolate;
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  transform: translateZ(0);
  animation: sprite-breathe var(--breathe-duration) var(--ease-out) infinite;
  transition:
    transform var(--dur-base) var(--ease-spring),
    box-shadow var(--dur-base) var(--ease-out),
    background-color var(--dur-base) var(--ease-out),
    filter var(--dur-base) var(--ease-out);
}

.sprite__label {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  animation: sprite-float var(--breathe-secondary-duration) var(--ease-out) infinite;
  animation-delay: -1.4s;
}

/* 悬停时掠过的高光，只动 opacity */
.sprite__sheen {
  position: absolute;
  inset: -40% -20%;
  z-index: 1;
  background: radial-gradient(
    60% 60% at 30% 0%,
    color-mix(in srgb, var(--glass-highlight) 55%, transparent),
    transparent 70%
  );
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-out);
  pointer-events: none;
}

.sprite--primary {
  border-color: transparent;
  background: linear-gradient(140deg, var(--accent) 0%, var(--accent-strong) 100%);
  color: var(--accent-contrast);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--glass-highlight) 72%, transparent),
    0 18px 36px -20px var(--accent-strong);
}

.sprite--ghost {
  background: var(--glass-bg-soft);
  color: var(--text-strong);
}

.sprite--plain {
  background: transparent;
  border-color: var(--line);
  box-shadow: none;
  color: var(--text-muted);
  animation: none;
}

.sprite--danger {
  background: var(--danger-soft);
  border-color: var(--danger-soft);
  color: var(--danger);
  box-shadow: none;
}

.sprite--sm {
  min-height: 38px;
  padding: 0 18px;
  font-size: 13px;
}

.sprite--lg {
  min-height: 58px;
  padding: 0 40px;
  font-size: 17px;
}

.sprite--block {
  width: 100%;
}

.sprite:hover:not(:disabled) {
  animation: none;
  transform: scale(var(--hover-scale));
  box-shadow: var(--glass-shadow-hover);
}

.sprite:hover:not(:disabled) .sprite__sheen {
  opacity: 1;
}

.sprite--primary:hover:not(:disabled) {
  filter: brightness(1.05);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--glass-highlight) 78%, transparent),
    0 24px 48px -22px var(--accent-strong);
}

.sprite:active:not(:disabled) {
  transform: scale(var(--press-scale));
  box-shadow: var(--glass-shadow-pressed);
  transition:
    transform var(--dur-instant) var(--ease-in),
    box-shadow var(--dur-fast) var(--ease-out);
}

.sprite:disabled {
  cursor: not-allowed;
  opacity: 0.42;
  animation: none;
  transform: none;
  box-shadow: none;
}

.sprite__spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: sprite-spin 700ms linear infinite;
}

@keyframes sprite-breathe {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(calc(var(--breathe-lift) * -1)) scale(var(--breathe-scale));
  }
}

@keyframes sprite-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(1px);
  }
}

@keyframes sprite-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sprite,
  .sprite__label,
  .sprite__spinner {
    animation: none;
  }

  .sprite:hover:not(:disabled),
  .sprite:active:not(:disabled) {
    transform: none;
  }
}
</style>
