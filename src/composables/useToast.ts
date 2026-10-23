import { ref } from 'vue'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
  leaving: boolean
}

/**
 * 轻量提示。模块级状态，任意组件调用 useToast() 都能操作同一组提示。
 */
const toasts = ref<ToastItem[]>([])
let sequence = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function dismiss(id: number): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  const item = toasts.value.find((toast) => toast.id === id)
  if (item) item.leaving = true
  // 等退场动画结束再移除
  setTimeout(() => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }, 220)
}

function push(message: string, type: ToastType = 'info', duration = 2600): number {
  sequence += 1
  const id = sequence
  toasts.value = [...toasts.value, { id, message, type, leaving: false }]
  if (duration > 0) {
    const timer = setTimeout(() => dismiss(id), duration)
    timers.set(id, timer)
  }
  return id
}

export function useToast() {
  return {
    toasts,
    push,
    dismiss,
    success: (message: string) => push(message, 'success'),
    warning: (message: string) => push(message, 'warning', 3200),
    error: (message: string) => push(message, 'error', 4000),
  }
}
