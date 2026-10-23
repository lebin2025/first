import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type ThemeName = 'ride' | 'sakura' | 'winter'

export interface ThemeOption {
  id: ThemeName
  label: string
  hint: string
  image: string
  /** 浏览器原生控件/滚动条使用的明暗模式 */
  scheme: 'light' | 'dark'
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'ride',
    label: '星夜骑行',
    hint: '深空、星轨与夜骑剪影',
    image: '/bg-ride.jpg',
    scheme: 'dark',
  },
  {
    id: 'sakura',
    label: '樱落',
    hint: '浪漫、治愈，粉色花瓣',
    image: '/bg-sakura.jpg',
    scheme: 'light',
  },
  {
    id: 'winter',
    label: '冬日蓝调',
    hint: '明亮蓝色手绘雪景',
    image: '/bg-winter.jpg',
    scheme: 'light',
  },
]

const STORAGE_KEY = 'shiguang.theme'
const DEFAULT_THEME: ThemeName = 'ride'

function isThemeName(value: unknown): value is ThemeName {
  return value === 'ride' || value === 'sakura' || value === 'winter'
}

/** 旧版本 localStorage 迁移：forest -> ride，snow -> winter */
function migrateStoredTheme(value: string | null): ThemeName {
  if (value === 'forest') return 'ride'
  if (value === 'snow') return 'winter'
  return isThemeName(value) ? value : DEFAULT_THEME
}

function readTheme(): ThemeName {
  try {
    return migrateStoredTheme(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

let transitionTimer: number | null = null

/**
 * 三套全局水彩主题的唯一来源。
 * - ride：星夜骑行（默认暗色）
 * - sakura：樱落（保留的明亮主题）
 * - winter：冬日蓝调（明亮高亮）
 */
export const useThemeStore = defineStore('theme', () => {
  const theme = ref<ThemeName>(readTheme())
  const themes = THEME_OPTIONS

  const current = computed<ThemeOption>(
    () => themes.find((option) => option.id === theme.value) ?? themes[0]!,
  )

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, theme.value)
    } catch {
      // 隐私模式不可写，忽略
    }
  }

  function apply(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.dataset.theme = theme.value
    root.style.colorScheme = current.value.scheme
  }

  function setTheme(next: ThemeName): void {
    if (!isThemeName(next)) return
    theme.value = next
    persist()
    apply()

    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.classList.add('theme-transition')
    if (transitionTimer !== null) window.clearTimeout(transitionTimer)
    transitionTimer = window.setTimeout(() => {
      root.classList.remove('theme-transition')
      transitionTimer = null
    }, 800)
  }

  function initialize(): void {
    apply()
  }

  return {
    theme,
    themes,
    current,
    setTheme,
    initialize,
  }
})
