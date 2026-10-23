import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  AUDIO_TRACKS,
  audioEngine,
  type AudioTrackId,
} from '@/composables/useAudioEngine'

const TRACK_STORAGE_KEY = 'shiguang.audio-track'
const VOLUME_STORAGE_KEY = 'shiguang.audio-volume'

function readTrack(): AudioTrackId {
  if (typeof window === 'undefined') return 'forest'
  const stored = window.localStorage.getItem(TRACK_STORAGE_KEY)
  return AUDIO_TRACKS.some((item) => item.id === stored)
    ? (stored as AudioTrackId)
    : 'forest'
}

function readVolume(): number {
  if (typeof window === 'undefined') return 0.55
  const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY)
  if (raw === null) return 0.55
  const stored = Number(raw)
  return Number.isFinite(stored) ? Math.max(0, Math.min(1, stored)) : 0.55
}

/**
 * 全局音频状态。所有页面共用同一个 AudioEngine 实例，
 * 组件只负责 acquire/release，真正节点清理由 engine 延迟执行。
 */
export const useAudioStore = defineStore('audio', () => {
  const currentTrack = ref<AudioTrackId>(readTrack())
  const isPlaying = ref(false)
  const loading = ref(false)
  const error = ref('')
  const volume = ref(readVolume())

  let initialized = false
  let requestId = 0

  const currentLabel = computed(
    () => AUDIO_TRACKS.find((item) => item.id === currentTrack.value)?.label ?? '环境音',
  )
  const tracks = AUDIO_TRACKS

  function initialize(): void {
    if (initialized) return
    initialized = true
    audioEngine.setVolume(volume.value)
    audioEngine.onStateChange = (playing) => {
      isPlaying.value = playing
      if (!playing) loading.value = false
    }
  }

  function persistTrack(track: AudioTrackId): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TRACK_STORAGE_KEY, track)
    }
  }

  function persistVolume(): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume.value))
    }
  }

  function setVolume(next: number): void {
    volume.value = Math.max(0, Math.min(1, next))
    audioEngine.setVolume(volume.value)
    persistVolume()
  }

  async function play(track: AudioTrackId = currentTrack.value): Promise<boolean> {
    initialize()
    const id = ++requestId
    currentTrack.value = track
    persistTrack(track)
    error.value = ''
    loading.value = true

    // 必须在用户手势的同步栈内创建/恢复 AudioContext
    audioEngine.unlock()

    try {
      await audioEngine.play(track, volume.value)
      if (id !== requestId) return false
      isPlaying.value = true
      return true
    } catch (cause) {
      if (id === requestId) {
        error.value = cause instanceof Error ? cause.message : '音频加载失败'
        isPlaying.value = false
      }
      return false
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  function pause(): void {
    audioEngine.pause()
    isPlaying.value = false
    loading.value = false
  }

  async function toggle(): Promise<void> {
    if (loading.value) return
    if (isPlaying.value) {
      pause()
      return
    }
    await play()
  }

  /** 主题切换：自动交叉淡入到对应音轨 */
  async function switchTheme(track: AudioTrackId): Promise<void> {
    await play(track)
  }

  /** 只同步 UI 音轨，不自动播放（用于进入页面时对齐当前主题） */
  function setTrack(track: AudioTrackId, autoplay = false): void {
    currentTrack.value = track
    persistTrack(track)
    if (autoplay) void play(track)
  }

  function acquire(): void {
    audioEngine.acquire()
  }

  function release(): void {
    audioEngine.release()
  }

  function dispose(): void {
    requestId += 1
    audioEngine.dispose()
    isPlaying.value = false
    loading.value = false
  }

  return {
    currentTrack,
    currentLabel,
    tracks,
    isPlaying,
    loading,
    error,
    volume,
    initialize,
    play,
    pause,
    toggle,
    switchTheme,
    setTrack,
    setVolume,
    acquire,
    release,
    dispose,
  }
})
