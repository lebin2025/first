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
  const readyTracks = ref<AudioTrackId[]>([])
  const preloadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const preloadError = ref('')
  const audioLoadingState = computed(() => preloadState.value)

  let initialized = false
  let requestId = 0
  let preloadPromise: Promise<void> | null = null

  const isReady = computed(
    () => readyTracks.value.length === AUDIO_TRACKS.length,
  )
  const currentReady = computed(() =>
    readyTracks.value.includes(currentTrack.value),
  )
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
    audioEngine.onBufferReady = (track) => {
      if (!readyTracks.value.includes(track)) {
        readyTracks.value = [...readyTracks.value, track]
      }
    }
    audioEngine.onPreloadError = (track, cause) => {
      preloadError.value =
        cause instanceof Error ? cause.message : `音频 ${track} 预加载失败`
    }

    readyTracks.value = AUDIO_TRACKS.filter((track) =>
      audioEngine.hasBuffer(track.id),
    ).map((track) => track.id)
  }

  /** 页面空闲时串行预热四首音频，失败只记录，不阻塞界面 */
  async function preloadAll(): Promise<void> {
    initialize()
    if (preloadPromise) return preloadPromise
    if (readyTracks.value.length === AUDIO_TRACKS.length) {
      preloadState.value = 'ready'
      return
    }

    preloadState.value = 'loading'
    preloadError.value = ''
    preloadPromise = audioEngine
      .preloadAll()
      .then(() => {
        preloadState.value = 'ready'
      })
      .catch((cause) => {
        preloadState.value = 'error'
        preloadError.value =
          cause instanceof Error ? cause.message : '音频预加载失败'
      })
      .finally(() => {
        preloadPromise = null
      })

    return preloadPromise
  }

  /** 把预加载排入浏览器空闲队列，返回取消函数 */
  function schedulePreload(fallbackMs = 5000): () => void {
    initialize()
    return audioEngine.scheduleIdlePreload(fallbackMs)
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
    // 已预加载的音频不显示 Loading，点击直接播放
    loading.value = !readyTracks.value.includes(track)

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
    readyTracks,
    isReady,
    currentReady,
    preloadState,
    audioLoadingState,
    preloadError,
    initialize,
    preloadAll,
    schedulePreload,
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
