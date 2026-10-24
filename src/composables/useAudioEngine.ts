export type AudioTrackId = 'forest' | 'sunset' | 'snow' | 'moon'

/** 全局解码缓存：idle 预加载与点击播放共用同一份 AudioBuffer */
export const audioBufferCache = new Map<AudioTrackId, AudioBuffer>()

export const AUDIO_TRACKS: Array<{ id: AudioTrackId; label: string; src: string }> = [
  { id: 'forest', label: '魔法森林', src: `${import.meta.env.BASE_URL}audio/forest.mp3` },
  { id: 'sunset', label: '黄昏', src: `${import.meta.env.BASE_URL}audio/sunset.mp3` },
  { id: 'snow', label: '粉彩雪景', src: `${import.meta.env.BASE_URL}audio/snow.mp3` },
  { id: 'moon', label: '月夜松林', src: `${import.meta.env.BASE_URL}audio/moon.mp3` },
]

interface Voice {
  source: AudioBufferSourceNode
  gain: GainNode
  track: AudioTrackId
}

const FADE_SECONDS = 0.5
const RELEASE_GRACE_MS = 900

class AudioEngine {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private current: Voice | null = null
  private buffers = audioBufferCache
  private loading = new Map<AudioTrackId, Promise<AudioBuffer>>()
  private consumers = 0
  private releaseTimer: number | null = null
  private volume = 0.55
  private preloading: Promise<void> | null = null

  onStateChange: ((playing: boolean) => void) | null = null
  onBufferReady: ((track: AudioTrackId) => void) | null = null
  onPreloadError: ((track: AudioTrackId, cause: unknown) => void) | null = null

  hasBuffer(track: AudioTrackId): boolean {
    return this.buffers.has(track)
  }

  get isPlaying(): boolean {
    return this.current !== null && this.context?.state === 'running'
  }

  acquire(): void {
    this.consumers += 1
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer)
      this.releaseTimer = null
    }
  }

  release(): void {
    this.consumers = Math.max(0, this.consumers - 1)
    if (this.consumers > 0 || this.releaseTimer !== null) return
    this.releaseTimer = window.setTimeout(() => {
      this.releaseTimer = null
      if (this.consumers === 0) this.dispose()
    }, RELEASE_GRACE_MS)
  }

  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.context = new Ctor()
      this.master = this.context.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.context.destination)
    }
    if (this.context.state === 'suspended') {
      void this.context.resume()
    }
    return this.context
  }

  /** 必须在用户点击的同步调用栈里调用，满足浏览器自动播放策略 */
  unlock(): void {
    this.ensureContext()
  }

  private async loadBuffer(track: AudioTrackId): Promise<AudioBuffer> {
    const cached = this.buffers.get(track)
    if (cached) return cached

    const pending = this.loading.get(track)
    if (pending) return pending

    const source = AUDIO_TRACKS.find((item) => item.id === track)
    if (!source) throw new Error(`未知音频主题：${track}`)

    const promise = (async () => {
      const response = await fetch(source.src)
      if (!response.ok) {
        throw new Error(`音频加载失败：${source.src} (${response.status})`)
      }
      const arrayBuffer = await response.arrayBuffer()
      const context = this.ensureContext()
      const buffer = await context.decodeAudioData(arrayBuffer.slice(0))
      this.buffers.set(track, buffer)
      this.onBufferReady?.(track)
      return buffer
    })()

    this.loading.set(track, promise)
    try {
      return await promise
    } finally {
      this.loading.delete(track)
    }
  }

  async preload(track: AudioTrackId): Promise<void> {
    await this.loadBuffer(track)
  }

  /**
   * 串行预热四首音频；每首之间让出主线程，避免一次 decode 卡死 UI。
   * 失败只记录，不影响后续曲目。
   */
  async preloadAll(): Promise<void> {
    if (this.preloading) return this.preloading

    this.preloading = (async () => {
      for (const track of AUDIO_TRACKS) {
        try {
          await this.loadBuffer(track.id)
        } catch (cause) {
          this.onPreloadError?.(track.id, cause)
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }
    })()

    try {
      await this.preloading
    } finally {
      this.preloading = null
    }
  }

  async play(track: AudioTrackId, volume?: number): Promise<void> {
    const context = this.ensureContext()
    if (typeof volume === 'number') this.setVolume(volume)
    const buffer = await this.loadBuffer(track)

    if (this.current?.track === track) {
      // 同一首：只恢复被暂停的 context，不重启 source
      if (context.state === 'suspended') await context.resume()
      const gain = this.current.gain.gain
      const now = context.currentTime
      gain.cancelScheduledValues(now)
      gain.setValueAtTime(gain.value, now)
      gain.linearRampToValueAtTime(1, now + FADE_SECONDS)
      this.onStateChange?.(true)
      return
    }

    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true

    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    source.connect(gain)
    gain.connect(this.master ?? context.destination)

    const old = this.current
    source.start(now)
    gain.gain.linearRampToValueAtTime(1, now + FADE_SECONDS)

    if (old) {
      old.gain.gain.cancelScheduledValues(now)
      old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), now)
      old.gain.gain.linearRampToValueAtTime(0.0001, now + FADE_SECONDS)
      old.source.stop(now + FADE_SECONDS + 0.08)
    }

    this.current = { source, gain, track }
    this.onStateChange?.(true)
  }

  pause(): void {
    if (!this.current || !this.context) return
    const context = this.context
    const voice = this.current
    const now = context.currentTime
    this.current = null

    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now)
    voice.gain.gain.linearRampToValueAtTime(0.0001, now + FADE_SECONDS)
    try {
      voice.source.stop(now + FADE_SECONDS + 0.08)
    } catch {
      // 已停止的 source 不重复 stop
    }
    this.onStateChange?.(false)
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value))
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.05)
    }
  }

  dispose(): void {
    this.pause()
    if (this.master) {
      this.master.disconnect()
      this.master = null
    }
    if (this.context && this.context.state !== 'closed') {
      void this.context.close()
    }
    this.context = null
    this.buffers.clear()
    this.loading.clear()
    this.onStateChange?.(false)
  }
}

export const audioEngine = new AudioEngine()

export function useAudioEngine(): AudioEngine {
  return audioEngine
}
