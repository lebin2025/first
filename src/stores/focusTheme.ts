import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useAudioStore } from '@/stores/audio'

export type FocusThemeId = 'forest' | 'sunset' | 'snow' | 'moon'

export interface FocusThemeConfig {
  id: FocusThemeId
  label: string
  english: string
  description: string
  image: string
  dot: string
}

const STORAGE_KEY = 'shiguang.focus-theme'

export const FOCUS_THEMES: FocusThemeConfig[] = [
  {
    id: 'forest',
    label: '魔法森林',
    english: 'FOREST',
    description: '荧光孢子漂浮的深林，适合长时间专注。',
    image: `${import.meta.env.BASE_URL}bg-forest.jpg`,
    dot: '#7dffc4',
  },
  {
    id: 'sunset',
    label: '黄昏',
    english: 'SUNSET',
    description: '金色微尘与暖色天光，通透而温柔。',
    image: `${import.meta.env.BASE_URL}bg-sunset.jpg`,
    dot: '#e7b86a',
  },
  {
    id: 'snow',
    label: '粉彩雪景',
    english: 'SNOW',
    description: '粉彩雪景与缓慢落雪，安静而清透。',
    image: `${import.meta.env.BASE_URL}bg-snow.jpg`,
    dot: '#f2b8c6',
  },
  {
    id: 'moon',
    label: '月夜松林',
    english: 'MOON',
    description: '月夜松林与淡蓝萤火，适合夜间心流。',
    image: `${import.meta.env.BASE_URL}bg-moon.jpg`,
    dot: '#a9c5ff',
  },
]

function isFocusTheme(value: string | null): value is FocusThemeId {
  return value === 'forest' || value === 'sunset' || value === 'snow' || value === 'moon'
}

function readStoredTheme(): FocusThemeId {
  if (typeof window === 'undefined') return 'forest'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isFocusTheme(stored) ? stored : 'forest'
}

function applyRootTheme(theme: FocusThemeId): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-focus-theme', theme)
  const config = FOCUS_THEMES.find((item) => item.id === theme)
  if (config) {
    // CSS 变量不能读 import.meta.env，用运行时 URL 覆盖
    root.style.setProperty('--focus-bg-img', `url("${config.image}")`)
  }
}

/**
 * 四套沉浸主题状态机。
 * 主题切换会同步交叉淡入对应的全局音轨。
 */
export const useFocusThemeStore = defineStore('focus-theme', () => {
  const audio = useAudioStore()
  const theme = ref<FocusThemeId>(readStoredTheme())
  const current = computed(
    () => FOCUS_THEMES.find((item) => item.id === theme.value) ?? FOCUS_THEMES[0],
  )

  function setTheme(next: FocusThemeId): void {
    if (!FOCUS_THEMES.some((item) => item.id === next)) return
    theme.value = next
    applyRootTheme(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next)
    }
    // 主题与音乐深度绑定：点击主题即交叉淡入对应音轨
    void audio.switchTheme(next)
  }

  function cycle(): void {
    const index = FOCUS_THEMES.findIndex((item) => item.id === theme.value)
    const next = FOCUS_THEMES[(index + 1) % FOCUS_THEMES.length]
    if (next) setTheme(next.id)
  }

  function initialize(): void {
    applyRootTheme(theme.value)
    // 进入页面只对齐音轨，不自动播放，遵守浏览器自动播放策略
    if (audio.isPlaying) {
      void audio.switchTheme(theme.value)
    } else {
      audio.setTrack(theme.value)
    }
  }

  return {
    theme,
    current,
    themes: FOCUS_THEMES,
    setTheme,
    cycle,
    initialize,
  }
})
