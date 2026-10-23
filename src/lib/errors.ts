import type { PostgrestError } from '@supabase/supabase-js'

/**
 * 把 Supabase / Auth 的错误翻译成用户能看懂的中文。
 * 数据库表尚未创建时给出明确引导（最常见的首次部署问题）。
 */
export function describeError(error: unknown): string {
  if (!error) return '未知错误'

  if (typeof error === 'string') return error

  if (typeof error === 'object') {
    const err = error as Partial<PostgrestError> & { message?: string; status?: number; code?: string }
    const message = err.message ?? ''
    const code = err.code ?? ''

    if (message.includes('relation') && message.includes('does not exist')) {
      return '数据库尚未初始化：请先在 Supabase SQL Editor 中执行 supabase/schema.sql。'
    }
    if (message.includes('Invalid login credentials')) {
      return '邮箱或密码不正确。'
    }
    if (message.includes('Email not confirmed')) {
      return '邮箱尚未验证，请先点击确认邮件中的链接。'
    }
    if (message.includes('User already registered')) {
      return '该邮箱已注册，请直接登录。'
    }
    if (message.includes('Password should be at least')) {
      return '密码长度不足，至少需要 6 位。'
    }
    if (message.includes('JWT') && message.includes('expired')) {
      return '登录状态已过期，请重新登录。'
    }
    if (
      message.includes('Failed to fetch') ||
      message.includes('NetworkError') ||
      message.includes('fetch failed') ||
      message.includes('Load failed')
    ) {
      return '网络连接失败：请检查网络，或确认 .env.local 中的 Supabase 地址是否正确。'
    }
    if (code === '23514') {
      return message || '数据不满足约束条件（例如分计划截止日期晚于总计划）。'
    }
    if (code === '42501' || err.status === 403) {
      return '没有权限访问该数据，请确认已登录。'
    }
    if (message) return message
  }

  return '请求失败，请稍后重试。'
}

/** 上线前的第一道自检：环境变量是否齐全 */
export function envHint(): string {
  return '请检查 .env.local 中的 VITE_SUPABASE_URL 与 VITE_SUPABASE_PUBLISHABLE_KEY，修改后需要重启 npm run dev。'
}
