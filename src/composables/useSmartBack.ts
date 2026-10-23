import { computed } from 'vue'
import { useRouter } from 'vue-router'

/**
 * 智能返回：
 * - 优先检查 Vue Router 4 的 history.state.back；
 * - 直接访问/新标签页（没有上级路由）回退到首页；
 * - 其余情况执行 router.back()，保留浏览器真实来路。
 */
export function useSmartBack(fallback = '/') {
  const router = useRouter()

  const canGoBack = computed(() => {
    if (typeof window === 'undefined') return false
    const state = router.options.history.state as { back?: string | null } | undefined
    return Boolean(state?.back) || window.history.length > 1
  })

  function goBack(): void {
    if (typeof window === 'undefined') return
    const state = router.options.history.state as { back?: string | null } | undefined
    if (state?.back || window.history.length > 1) {
      router.back()
      return
    }
    void router.push(fallback)
  }

  return {
    canGoBack,
    goBack,
  }
}
