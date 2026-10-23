import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'

/**
 * 认证状态（Pinia）。
 * - initialize() 幂等：路由守卫、main.ts、页面都可以调用；
 * - 通过 onAuthStateChange 同步刷新 session（含 token 自动续期、跨标签页登出）。
 */
export interface Profile {
  userId: string
  nickname: string
  bio: string
  avatarUrl: string | null
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const user = ref<User | null>(null)
  const profile = ref<Profile | null>(null)
  const initializing = ref(true)
  const loading = ref(false)
  const error = ref('')

  let initPromise: Promise<void> | null = null
  let subscribed = false

  const isAuthenticated = computed(() => session.value !== null)
  const email = computed(() => user.value?.email ?? '')
  const userId = computed(() => user.value?.id ?? '')

  function applySession(next: Session | null): void {
    session.value = next
    user.value = next?.user ?? null
    if (!next) profile.value = null
  }

  function fallbackNickname(): string {
    const metadata = user.value?.user_metadata as { nickname?: string } | undefined
    if (metadata?.nickname && metadata.nickname.trim()) return metadata.nickname.trim()
    return email.value.split('@')[0] || '拾光同学'
  }

  async function loadProfile(): Promise<boolean> {
    if (!user.value) return false
    try {
      const { data, error: loadError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.value.id)
        .maybeSingle()
      if (loadError) {
        error.value = describeError(loadError)
        return false
      }
      if (data) {
        profile.value = {
          userId: data.user_id,
          nickname: data.nickname ?? '',
          bio: data.bio ?? '',
          avatarUrl: data.avatar_url ?? null,
        }
        return true
      }

      const { data: created, error: createError } = await supabase
        .from('profiles')
        .insert({
          user_id: user.value.id,
          nickname: fallbackNickname(),
          bio: '',
        })
        .select()
        .single()
      if (createError) {
        error.value = describeError(createError)
        return false
      }
      profile.value = {
        userId: created.user_id,
        nickname: created.nickname ?? '',
        bio: created.bio ?? '',
        avatarUrl: created.avatar_url ?? null,
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    }
  }

  async function updateProfile(nickname: string, bio: string): Promise<boolean> {
    if (!user.value) return false
    loading.value = true
    error.value = ''
    try {
      const safeNickname = nickname.trim().slice(0, 40)
      const safeBio = bio.trim().slice(0, 240)
      const { data, error: updateError } = await supabase
        .from('profiles')
        .upsert(
          {
            user_id: user.value.id,
            nickname: safeNickname || fallbackNickname(),
            bio: safeBio,
          },
          { onConflict: 'user_id' },
        )
        .select()
        .single()
      if (updateError) {
        error.value = describeError(updateError)
        return false
      }
      profile.value = {
        userId: data.user_id,
        nickname: data.nickname ?? '',
        bio: data.bio ?? '',
        avatarUrl: data.avatar_url ?? null,
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    } finally {
      loading.value = false
    }
  }

  /** 恢复登录态；重复调用共享同一个 Promise */
  function initialize(): Promise<void> {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) error.value = describeError(sessionError)
        applySession(data.session)
      } catch (cause) {
        error.value = describeError(cause)
      } finally {
        initializing.value = false
      }

      if (!subscribed) {
        subscribed = true
        supabase.auth.onAuthStateChange((_event, nextSession) => {
          applySession(nextSession)
          initializing.value = false
        })
      }
    })()
    return initPromise
  }

  async function signIn(emailInput: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: emailInput.trim(),
        password,
      })
      if (signInError) {
        error.value = describeError(signInError)
        return false
      }
      applySession(data.session)
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    } finally {
      loading.value = false
    }
  }

  async function signUp(
    emailInput: string,
    password: string,
  ): Promise<{ ok: boolean; needsConfirmation: boolean }> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: emailInput.trim(),
        password,
      })
      if (signUpError) {
        error.value = describeError(signUpError)
        return { ok: false, needsConfirmation: false }
      }
      applySession(data.session)
      // 项目开启「邮箱确认」时，session 为空，需要用户去收件箱点确认链接
      return { ok: true, needsConfirmation: data.session === null }
    } catch (cause) {
      error.value = describeError(cause)
      return { ok: false, needsConfirmation: false }
    } finally {
      loading.value = false
    }
  }

  async function signOut(): Promise<void> {
    loading.value = true
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) error.value = describeError(signOutError)
    } finally {
      applySession(null)
      loading.value = false
    }
  }

  /** 发送重置密码邮件（设置页可选能力） */
  async function sendPasswordReset(emailInput: string): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(emailInput.trim(), {
        redirectTo: `${window.location.origin}/login`,
      })
      if (resetError) {
        error.value = describeError(resetError)
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  function clearError(): void {
    error.value = ''
  }

  return {
    session,
    user,
    profile,
    initializing,
    loading,
    error,
    isAuthenticated,
    email,
    userId,
    initialize,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    loadProfile,
    updateProfile,
    clearError,
  }
})
