<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useAudioStore } from '@/stores/audio'

const props = withDefaults(defineProps<{ tone?: 'focus' | 'page' }>(), {
  tone: 'page',
})

const audio = useAudioStore()
const volumePercent = computed(() => Math.round(audio.volume * 100))

onMounted(() => {
  audio.initialize()
  audio.acquire()
})

onUnmounted(() => {
  // 释放消费者；最后一个播放器卸载后 engine 会延迟 dispose AudioContext
  audio.release()
})

function onVolume(event: Event): void {
  audio.setVolume(Number((event.target as HTMLInputElement).value) / 100)
}

function toggle(): void {
  void audio.toggle()
}
</script>

<template>
  <div class="audio-player" :class="`audio-player--${props.tone}`">
    <button
      type="button"
      class="audio-player__play"
      :aria-label="audio.isPlaying ? '暂停环境音' : '播放环境音'"
      :aria-pressed="audio.isPlaying"
      :disabled="audio.loading"
      @click="toggle"
    >
      <span v-if="audio.loading" class="audio-player__spinner" aria-hidden="true"></span>
      <span v-else-if="audio.isPlaying" class="audio-player__pause" aria-hidden="true">
        <i></i><i></i>
      </span>
      <span v-else class="audio-player__triangle" aria-hidden="true"></span>
    </button>

    <div class="audio-player__meta">
      <span class="audio-player__title">{{ audio.currentLabel }}</span>
      <span v-if="audio.error" class="audio-player__error" role="alert">{{ audio.error }}</span>
      <span v-else class="audio-player__hint">
        {{ audio.loading ? '正在加载音频…' : audio.isPlaying ? '播放中' : '环境音已暂停' }}
      </span>
    </div>

    <input
      class="audio-player__slider"
      type="range"
      min="0"
      max="100"
      :value="volumePercent"
      :aria-label="`音量 ${volumePercent}%`"
      @input="onVolume"
    />
    <span class="audio-player__value numeric">{{ volumePercent }}%</span>
  </div>
</template>

<style scoped>
.audio-player {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 6px 10px 6px 6px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: blur(16px) saturate(130%);
  backdrop-filter: blur(16px) saturate(130%);
}

.audio-player--focus {
  border-color: var(--focus-border);
  background: var(--focus-glass);
}

.audio-player__play {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  color: var(--text-primary);
  cursor: pointer;
}

.audio-player--focus .audio-player__play {
  border-color: var(--focus-border);
  background: var(--focus-panel);
  color: var(--focus-text);
}

.audio-player__play:disabled {
  opacity: 0.55;
  cursor: wait;
}

.audio-player__triangle {
  width: 0;
  height: 0;
  margin-left: 2px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid currentColor;
}

.audio-player__pause {
  display: inline-flex;
  gap: 3px;
}

.audio-player__pause i {
  width: 2px;
  height: 10px;
  border-radius: 2px;
  background: currentColor;
}

.audio-player__spinner {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  animation: audio-spin 0.8s linear infinite;
}

.audio-player__meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 82px;
}

.audio-player__title {
  font-size: 10px;
  color: var(--text-primary);
}

.audio-player--focus .audio-player__title {
  color: var(--focus-text-strong);
}

.audio-player__hint,
.audio-player__error {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 8px;
  color: var(--text-tertiary);
}

.audio-player--focus .audio-player__hint {
  color: var(--focus-text-faint);
}

.audio-player__error {
  color: var(--danger);
}

.audio-player__slider {
  width: 76px;
  height: 3px;
  accent-color: var(--accent);
  cursor: pointer;
}

.audio-player--focus .audio-player__slider {
  accent-color: var(--focus-accent);
}

.audio-player__value {
  min-width: 30px;
  font-size: 9px;
  color: var(--text-tertiary);
  text-align: right;
}

.audio-player--focus .audio-player__value {
  color: var(--focus-text-faint);
}

@keyframes audio-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 560px) {
  .audio-player__slider {
    width: 52px;
  }

  .audio-player__meta {
    min-width: 70px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .audio-player__spinner {
    animation: none;
  }
}
</style>
