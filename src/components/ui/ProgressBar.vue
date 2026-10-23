<script setup lang="ts">
import { computed } from 'vue'

/** 进度条：value 为 0 ~ 1 */
const props = withDefaults(
  defineProps<{
    value: number
    label?: string
    /** 显示右侧百分比 */
    showValue?: boolean
    height?: number
    tone?: 'accent' | 'success' | 'warning' | 'danger'
    size?: 'sm' | 'md'
  }>(),
  {
    label: '',
    showValue: false,
    height: 8,
    tone: 'accent',
    size: 'md',
  },
)

const percent = computed(() => Math.round(Math.min(1, Math.max(0, props.value)) * 100))
</script>

<template>
  <div class="progress" :class="`progress--${tone}`">
    <div v-if="label || showValue" class="progress__head">
      <span v-if="label" class="progress__label">{{ label }}</span>
      <span v-if="showValue" class="progress__value numeric">{{ percent }}%</span>
    </div>
    <div
      class="progress__track"
      :class="`progress__track--${size}`"
      :style="{ height: `${height}px` }"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label || '进度'"
    >
      <span class="progress__fill" :style="{ width: `${percent}%` }"></span>
    </div>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.progress__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 12px;
  color: var(--text-muted);
}

.progress__value {
  color: var(--text-strong);
  font-weight: 600;
}

.progress__track {
  position: relative;
  width: 100%;
  border-radius: var(--radius-pill);
  background: var(--line-soft);
  overflow: hidden;
  box-shadow: inset 0 1px 2px var(--line);
}

.progress__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent) 0%, var(--accent-strong) 100%);
  transition: width var(--dur-slow) var(--ease-out);
  min-width: 0;
}

.progress--success .progress__fill {
  background: linear-gradient(
    90deg,
    var(--success) 0%,
    color-mix(in srgb, var(--success) 70%, var(--glass-highlight)) 100%
  );
}

.progress--warning .progress__fill {
  background: linear-gradient(
    90deg,
    var(--warning) 0%,
    color-mix(in srgb, var(--warning) 70%, var(--glass-highlight)) 100%
  );
}

.progress--danger .progress__fill {
  background: linear-gradient(
    90deg,
    var(--danger) 0%,
    color-mix(in srgb, var(--danger) 70%, var(--glass-highlight)) 100%
  );
}

.progress__track--sm {
  border-radius: var(--radius-pill);
}
</style>
