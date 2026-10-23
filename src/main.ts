import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { useThemeStore } from './stores/theme'

import './assets/styles/tokens.css'
import './assets/styles/focus-themes.css'
import './assets/styles/base.css'

/**
 * 启动流程：
 * 1. 先创建 Pinia（路由守卫里要用 store）；
 * 2. 应用本地主题（三套水彩主题）；
 * 3. 恢复 Supabase 登录态，再挂载路由，避免受保护页面闪一下登录页。
 */
async function bootstrap(): Promise<void> {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  useThemeStore().initialize()

  const auth = useAuthStore()
  await auth.initialize()

  app.use(router)
  await router.isReady()
  app.mount('#app')
}

void bootstrap()
