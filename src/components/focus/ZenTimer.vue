<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import debounce from 'lodash.debounce'
import { formatClock } from '@/lib/date'

/**
 * 可复用的禅意计时器：环形进度 + 呼吸光晕。
 * 提供内置开始/暂停/重置，也可以通过 defineExpose 由父组件控制。
 */
const props = withDefaults(
  defineProps<{
    minutes?: number
    autoStart?: boolean
  }>(),
  { minutes: 25, autoStart: false },
)

const emit = defineEmits<{
  (event: 'complete'): void
  (event: 'update:minutes', value: number): void
  (event: 'update:running', value: boolean): void
}>()

const radius = 94
const circumference = 2 * Math.PI * radius
const duration = computed(() => Math.max(60, Math.round(props.minutes * 60)))
const elapsed = ref(0)
const running = ref(false)
const durationOpen = ref(false)
const minuteOptions = [15, 25, 45]
const customMinutes = ref(props.minutes)

let ticker: number | null = null
let anchor = 0
let baseElapsed = 0

const remaining = computed(() => Math.max(0, duration.value - elapsed.value))
const progress = computed(() => Math.min(1, elapsed.value / duration.value))
const dashOffset = computed(() => circumference * (1 - progress.value))
const display = computed(() => formatClock(remaining.value))

function clearTicker(): void {
  if (ticker !== null) {
    window.clearInterval(ticker)
    ticker = null
  }
}

function tick(): void {
  elapsed.value = Math.min(duration.value, baseElapsed + (performance.now() - anchor) / 1000)
  if (elapsed.value >= duration.value) {
    clearTicker()
    running.value = false
    emit('update:running', false)
    emit('complete')
  }
}

function start(): void {
  if (running.value) return
  if (elapsed.value >= duration.value) elapsed.value = 0
  anchor = performance.now()
  baseElapsed = elapsed.value
  running.value = true
  emit('update:running', true)
  clearTicker()
  ticker = window.setInterval(tick, 200)
}

function pause(): void {
  if (!running.value) return
  clearTicker()
  baseElapsed = elapsed.value
  running.value = false
  emit('update:running', false)
}

function toggle(): void {
  if (running.value) pause()
  else start()
}

function reset(): void {
  clearTicker()
  running.value = false
  elapsed.value = 0
  baseElapsed = 0
  emit('update:running', false)
}

function chooseMinutes(value: number): void {
  customMinutes.value = value
  emit('update:minutes', value)
  durationOpen.value = false
}

const commitCustomMinutes = debounce((value: number) => {
  const safe = Math.min(180, Math.max(1, Math.round(value) || 25))
  customMinutes.value = safe
  emit('update:minutes', safe)
}, 500)

function onCustomInput(): void {
  commitCustomMinutes(Number(customMinutes.value))
}

watch(
  () => props.minutes,
  () => {
    customMinutes.value = props.minutes
    reset()
  },
)

if (props.autoStart) start()

defineExpose({ start, pause, reset, running, remaining })
onBeforeUnmount(() => {
  clearTicker()
  commitCustomMinutes.cancel()
})
</script>

<template>
  <section class="zen-timer" aria-label="自习室计时器" @keydown.esc="durationOpen = false">
    <div class="zen-timer__halo" aria-hidden="true"></div>

    <div class="zen-timer__dial">
      <svg class="zen-timer__svg" viewBox="0 0 220 220" aria-hidden="true">
        <defs>
          <linearGradient id="zen-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="var(--accent)" />
            <stop offset="0.55" stop-color="var(--accent-strong)" />
            <stop offset="1" stop-color="var(--accent)" />
          </linearGradient>
        </defs>
        <circle class="zen-timer__track" cx="110" cy="110" :r="radius" />
        <circle
          class="zen-timer__progress"
          cx="110"
          cy="110"
          :r="radius"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="dashOffset"
          transform="rotate(-90 110 110)"
        />
      </svg>

      <div class="zen-timer__glass">
        <span class="zen-timer__label">{{ running ? '正在专注' : '准备开始' }}</span>
        <strong class="zen-timer__digits numeric">{{ display }}</strong>

        <div class="zen-timer__target-wrap">
          <button
            type="button"
            class="zen-timer__target"
            aria-haspopup="listbox"
            :aria-expanded="durationOpen"
            @click.stop="durationOpen = !durationOpen"
          >
            目标 {{ minutes }} 分钟
            <span aria-hidden="true">⌄</span>
          </button>

          <Transition name="time-pop">
            <div v-if="durationOpen" class="zen-time-pop" role="listbox" aria-label="选择专注时长">
              <button
                v-for="option in minuteOptions"
                :key="option"
                type="button"
                class="zen-time-pop__option"
                :class="{ 'is-active': option === minutes }"
                role="option"
                :aria-selected="option === minutes"
                @click.stop="chooseMinutes(option)"
              >
                {{ option }} min
              </button>

              <label class="zen-time-pop__custom">
                <span>自定义</span>
                <input
                  v-model.number="customMinutes"
                  type="number"
                  min="1"
                  max="180"
                  inputmode="numeric"
                  aria-label="自定义专注分钟数"
                  @input="onCustomInput"
                  @keydown.enter.prevent="commitCustomMinutes.flush()"
                />
              </label>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <div class="zen-timer__controls">
      <button type="button" class="zen-timer__btn zen-timer__btn--primary" @click="toggle">
        {{ running ? '暂停' : elapsed > 0 ? '继续' : '开始专注' }}
      </button>
      <button type="button" class="zen-timer__btn" @click="reset">重置</button>
    </div>
  </section>
</template>

<style scoped>
.zen-timer {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: 10px clamp(12px, 2vw, 24px);
}

.zen-timer__halo {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(48vw, 300px);
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft) 0%, transparent 68%);
  filter: blur(20px);
  transform: translate(-50%, -50%);
  animation: zen-breathe 5.6s ease-in-out infinite;
  pointer-events: none;
}

.zen-timer__dial {
  position: relative;
  width: min(48vw, 300px);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
}

.zen-timer__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  animation: zen-ring-breathe 5.6s ease-in-out infinite;
}

.zen-timer__track {
  fill: none;
  stroke: var(--line);
  stroke-width: 1.2;
}

.zen-timer__progress {
  fill: none;
  stroke: url(#zen-ring);
  stroke-width: 2.2;
  stroke-linecap: round;
  filter: drop-shadow(0 0 6px var(--accent-soft));
  transition: stroke-dashoffset var(--dur-slow) var(--ease-out);
}

.zen-timer__glass {
  width: 76%;
  height: 76%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(var(--glass-blur-strong));
  backdrop-filter: blur(var(--glass-blur-strong));
}

.zen-timer__label {
  font-size: 9px;
  letter-spacing: 0.2em;
  color: var(--text-tertiary);
}

.zen-timer__digits {
  font-size: clamp(42px, 8vw, 64px);
  font-weight: 300;
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}

.zen-timer__target {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 10px;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.zen-timer__target:hover {
  background: var(--glass-bg-soft);
  color: var(--text-secondary);
}

.zen-timer__target-wrap {
  position: relative;
  z-index: 5;
}

.zen-time-pop {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  width: 190px;
  padding: 7px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
  transform: translateX(-50%);
}

.zen-time-pop__option {
  padding: 7px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.zen-time-pop__option:hover,
.zen-time-pop__option.is-active {
  border-color: var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
}

.zen-time-pop__custom {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 3px;
  padding: 7px 3px 2px;
  border-top: 1px solid var(--line-soft);
  font-size: 9px;
  color: var(--text-tertiary);
}

.zen-time-pop__custom input {
  width: 64px;
  padding: 5px 7px;
  border: 1px solid var(--glass-border-soft);
  border-radius: var(--radius-xs);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 10px;
  text-align: center;
  outline: none;
}

.zen-time-pop__custom input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.time-pop-enter-active,
.time-pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.time-pop-enter-from,
.time-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px) scale(0.94);
}

.zen-timer__controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.zen-timer__btn {
  min-height: 40px;
  padding: 0 22px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out);
}

.zen-timer__btn:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--accent) 16%, var(--glass-bg-strong));
  color: var(--text-primary);
  border-color: var(--accent-soft);
  transition: all 0.3s ease;
}

.zen-timer__btn--primary:hover {
  color: var(--text-primary);
}

.zen-timer__btn--primary {
  border-color: transparent;
  background: linear-gradient(140deg, var(--accent), var(--accent-strong));
  color: var(--accent-contrast);
}

@keyframes zen-breathe {
  0%,
  100% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.5;
  }
  35% {
    transform: translate(-50%, -50%) scale(1.06);
    opacity: 0.85;
  }
  75% {
    transform: translate(-50%, -50%) scale(1.02);
    opacity: 0.62;
  }
}

@keyframes zen-ring-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.015);
  }
}

@media (prefers-reduced-motion: reduce) {
  .zen-timer__halo,
  .zen-timer__svg {
    animation: none;
  }

  .zen-timer__btn:hover {
    transform: none;
  }
}
</style>
