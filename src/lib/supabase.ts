import { createClient } from '@supabase/supabase-js'

/**
 * Supabase 客户端（单例）。
 *
 * 环境变量：
 * - VITE_SUPABASE_URL
 * - VITE_SUPABASE_PUBLISHABLE_KEY（也可填 anon key，二者都是前端公开密钥）
 *
 * 缺少环境变量时不要直接抛错让整页白屏，而是给出可读的提示，
 * 由各页面在请求失败时展示「配置缺失」。
 */
const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const rawPublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/**
 * 环境变量防御性清洗：
 * 某些平台（尤其是 GitHub Actions / Vercel）注入的 secret 可能带尾部换行，
 * 直接传给 createClient 会生成 ...%0A 的 WebSocket URL。
 */
function cleanEnv(value: string | undefined): string {
  return (value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\r\n\t]/g, '')
    .replace(/%0A|%0D/gi, '')
    .trim()
}

const url = cleanEnv(rawUrl)
const publishableKey = cleanEnv(rawPublishableKey)

export const isSupabaseConfigured = Boolean(url && publishableKey)

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] 缺少 VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY，请在 .env.local 中配置后重启开发服务器。',
  )
}

/**
 * 使用占位配置创建客户端，保证模块导入永远成功；
 * 真正的网络请求会在未配置时返回可读错误。
 */
export const supabase = createClient(
  url || 'http://localhost:54321',
  publishableKey || 'missing-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'shiguang.auth',
    },
  },
)
