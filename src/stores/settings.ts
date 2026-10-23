import { ref } from 'vue'
import { defineStore } from 'pinia'

interface PersistedSettings {
  defaultFocusBlock: number
  remindInApp: boolean
  remindEmail: boolean
}

const STORAGE_KEY = 'shiguang.settings'

const DEFAULTS: PersistedSettings = {
  defaultFocusBlock: 25,
  remindInApp: true,
  remindEmail: false,
}

function readSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>
    const focusBlock = [15, 25, 45].includes(Number(parsed.defaultFocusBlock))
      ? Number(parsed.defaultFocusBlock)
      : DEFAULTS.defaultFocusBlock
    return {
      defaultFocusBlock: focusBlock,
      remindInApp: parsed.remindInApp ?? DEFAULTS.remindInApp,
      remindEmail: parsed.remindEmail ?? DEFAULTS.remindEmail,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * 本地偏好设置。
 * 主题已迁移到 useThemeStore；这里只保留专注块与提醒偏好。
 */
export const useSettingsStore = defineStore('settings', () => {
  const initial = readSettings()
  const defaultFocusBlock = ref<number>(initial.defaultFocusBlock)
  const remindInApp = ref<boolean>(initial.remindInApp)
  const remindEmail = ref<boolean>(initial.remindEmail)

  function persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultFocusBlock: defaultFocusBlock.value,
          remindInApp: remindInApp.value,
          remindEmail: remindEmail.value,
        } satisfies PersistedSettings),
      )
    } catch {
      // 隐私模式下 localStorage 可能不可写，忽略即可
    }
  }

  function setDefaultFocusBlock(minutes: number): void {
    if (![15, 25, 45].includes(minutes)) return
    defaultFocusBlock.value = minutes
    persist()
  }

  function setRemindInApp(value: boolean): void {
    remindInApp.value = value
    persist()
  }

  function setRemindEmail(value: boolean): void {
    remindEmail.value = value
    persist()
  }

  return {
    defaultFocusBlock,
    remindInApp,
    remindEmail,
    setDefaultFocusBlock,
    setRemindInApp,
    setRemindEmail,
  }
})
