<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore, type ThemeName } from '@/stores/theme'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { todayISO } from '@/lib/date'

/** 设置页：账户、资料、偏好、数据导出、法律信息 */
const auth = useAuthStore()
const theme = useThemeStore()
const settings = useSettingsStore()
const toast = useToast()
const router = useRouter()

const exporting = ref(false)
const signingOut = ref(false)
const exportError = ref('')
const profileNickname = ref('')
const profileBio = ref('')
const profileSaving = ref(false)
const profileMessage = ref('')
const profileError = ref('')

const shortUserId = computed(() => {
  const id = auth.userId
  if (!id) return '—'
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
})

const themeOptions: Array<{ value: ThemeName; label: string; hint: string }> =
  theme.themes.map((option) => ({
    value: option.id,
    label: option.label,
    hint: option.hint,
  }))

async function loadProfile(): Promise<void> {
  const ok = await auth.loadProfile()
  if (!ok) {
    profileError.value = auth.error || '资料读取失败'
    return
  }
  profileNickname.value = auth.profile?.nickname ?? ''
  profileBio.value = auth.profile?.bio ?? ''
}

async function saveProfile(): Promise<void> {
  if (profileSaving.value) return
  profileSaving.value = true
  profileMessage.value = ''
  profileError.value = ''
  const ok = await auth.updateProfile(profileNickname.value, profileBio.value)
  profileSaving.value = false
  if (!ok) {
    profileError.value = auth.error || '保存资料失败'
    return
  }
  profileMessage.value = '资料已保存'
  toast.success('资料已更新')
  profileNickname.value = auth.profile?.nickname ?? ''
  profileBio.value = auth.profile?.bio ?? ''
}

onMounted(loadProfile)

async function signOut(): Promise<void> {
  signingOut.value = true
  await auth.signOut()
  signingOut.value = false
  toast.push('已退出登录')
  await router.replace('/login')
}

async function exportData(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  exportError.value = ''
  try {
    const [masters, subs, tasks, logs] = await Promise.all([
      supabase.from('master_plans').select('*'),
      supabase.from('sub_plans').select('*'),
      supabase.from('tasks').select('*'),
      supabase.from('study_logs').select('*'),
    ])
    const firstError = masters.error ?? subs.error ?? tasks.error ?? logs.error
    if (firstError) {
      exportError.value = describeError(firstError)
      return
    }
    const payload = {
      app: 'Shiguang · Picked Light',
      exportedAt: new Date().toISOString(),
      account: auth.email,
      master_plans: masters.data ?? [],
      sub_plans: subs.data ?? [],
      tasks: tasks.data ?? [],
      study_logs: logs.data ?? [],
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shiguang-export-${todayISO()}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success('数据已导出为 JSON')
  } catch (cause) {
    exportError.value = describeError(cause)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <AppShell>
    <div class="page-wrap page-wrap--narrow">
      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">支撑页</p>
          <h1>设置</h1>
        </div>
      </header>

      <div class="settings">
        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">资料</span>
            <span class="tiny faint">会显示在自习室座位</span>
          </div>

          <form class="profile-form" novalidate @submit.prevent="saveProfile">
            <div class="field">
              <label class="field__label" for="profile-nickname">昵称</label>
              <input
                id="profile-nickname"
                v-model="profileNickname"
                class="input"
                type="text"
                maxlength="40"
                placeholder="你的昵称"
              />
            </div>

            <div class="field">
              <label class="field__label" for="profile-bio">自我介绍</label>
              <textarea
                id="profile-bio"
                v-model="profileBio"
                class="input profile-textarea"
                maxlength="240"
                rows="3"
                placeholder="一句话介绍自己，最多 240 字"
              ></textarea>
              <span class="field__hint">{{ profileBio.length }}/240</span>
            </div>

            <p v-if="profileError" class="error-text" role="alert">{{ profileError }}</p>
            <p v-if="profileMessage" class="success-text" role="status">{{ profileMessage }}</p>

            <div class="row">
              <SpriteButton type="submit" size="sm" :loading="profileSaving">
                保存资料
              </SpriteButton>
            </div>
          </form>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">账户</span>
          </div>
          <dl class="account">
            <div>
              <dt>邮箱</dt>
              <dd>{{ auth.email || '未登录' }}</dd>
            </div>
            <div>
              <dt>用户 ID</dt>
              <dd class="account__id" :title="auth.userId">{{ shortUserId }}</dd>
            </div>
            <div>
              <dt>登录状态</dt>
              <dd>{{ auth.isAuthenticated ? '已登录' : '未登录' }}</dd>
            </div>
          </dl>
          <div class="row">
            <button type="button" class="btn btn--ghost btn--sm" :disabled="signingOut" @click="signOut">
              {{ signingOut ? '正在退出…' : '退出登录' }}
            </button>
          </div>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">外观</span>
          </div>
          <div class="theme-options" role="radiogroup" aria-label="主题">
            <label
              v-for="option in themeOptions"
              :key="option.value"
              class="theme-option"
              :class="{ 'is-active': theme.theme === option.value }"
            >
              <input
                type="radio"
                name="theme"
                :value="option.value"
                :checked="theme.theme === option.value"
                @change="theme.setTheme(option.value)"
              />
              <span class="theme-option__dot" :class="`theme-option__dot--${option.value}`" aria-hidden="true"></span>
              <span class="theme-option__label">{{ option.label }}</span>
              <span class="theme-option__hint">{{ option.hint }}</span>
            </label>
          </div>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">专注</span>
          </div>
          <div class="field">
            <label class="field__label" for="focus-block">默认单次专注块长度</label>
            <select
              id="focus-block"
              class="select"
              :value="settings.defaultFocusBlock"
              @change="settings.setDefaultFocusBlock(Number(($event.target as HTMLSelectElement).value))"
            >
              <option :value="15">15 分钟</option>
              <option :value="25">25 分钟（推荐）</option>
              <option :value="45">45 分钟</option>
            </select>
            <span class="field__hint">新建分计划时作为每个任务专注块的默认值。</span>
          </div>

          <div class="switch-row">
            <label class="switch">
              <input
                type="checkbox"
                :checked="settings.remindInApp"
                @change="settings.setRemindInApp(($event.target as HTMLInputElement).checked)"
              />
              <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
              <span class="switch__text">
                站内提醒
                <small>到了计划时间在页面内提示</small>
              </span>
            </label>

            <label class="switch">
              <input
                type="checkbox"
                :checked="settings.remindEmail"
                @change="settings.setRemindEmail(($event.target as HTMLInputElement).checked)"
              />
              <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
              <span class="switch__text">
                邮件提醒
                <small>第一版仅保存偏好，不会真正发送邮件</small>
              </span>
            </label>
          </div>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">数据</span>
          </div>
          <p class="muted settings__desc">
            导出包含总计划、分计划、任务与学习记录的 JSON 文件。这是个人项目，建议定期备份。
          </p>
          <div class="row">
            <SpriteButton size="sm" variant="ghost" :loading="exporting" @click="exportData">
              导出我的数据
            </SpriteButton>
            <span v-if="exportError" class="field__error" role="alert">{{ exportError }}</span>
          </div>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">关于</span>
          </div>
          <p class="muted settings__desc">
            拾光 · Picked Light 是一个免费的学习计划工具。动态排期与效率系数只提供参考性建议，不构成学习效果承诺。
          </p>
          <nav class="legal-links" aria-label="法律信息">
            <RouterLink to="/privacy">隐私政策</RouterLink>
            <RouterLink to="/terms">用户协议</RouterLink>
            <a href="mailto:2658116631@qq.com">联系我们</a>
          </nav>
        </GlassCard>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.settings__card {
  padding: clamp(20px, 3vw, 28px);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.profile-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.profile-textarea {
  min-height: 86px;
  resize: vertical;
  line-height: 1.6;
}

.account {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
  margin: 0;
}

.account dt {
  font-size: 11px;
  color: var(--text-faint);
}

.account dd {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--text-strong);
  word-break: break-all;
}

.account__id {
  font-family: var(--font-mono);
  font-size: 11px !important;
  color: var(--text-muted) !important;
}

.theme-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-3);
}

.theme-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: var(--glass-bg-soft);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.theme-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.theme-option.is-active {
  border-color: var(--accent);
  background: var(--accent-softer);
}

.theme-option:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.theme-option__dot {
  width: 16px;
  height: 16px;
  margin-bottom: 7px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  box-shadow: 0 2px 8px -2px var(--overlay);
}

.theme-option__dot--ride {
  background: var(--theme-dot-ride);
}

.theme-option__dot--sakura {
  background: var(--theme-dot-sakura);
}

.theme-option__dot--winter {
  background: var(--theme-dot-winter);
}

.theme-option__label {
  font-size: 13px;
  font-weight: 560;
  color: var(--text-strong);
}

.theme-option__hint {
  font-size: 11px;
  color: var(--text-faint);
}

.switch-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.switch {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch__track {
  position: relative;
  width: 42px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--line);
  transition: background-color var(--dur-fast) var(--ease-out);
}

.switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--text-inverse);
  box-shadow: 0 1px 3px var(--overlay);
  transition: transform var(--dur-base) var(--ease-spring);
}

.switch input:checked + .switch__track {
  background: var(--accent);
}

.switch input:checked + .switch__track .switch__thumb {
  transform: translateX(18px);
}

.switch input:focus-visible + .switch__track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.switch__text {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  color: var(--text);
}

.switch__text small {
  font-size: 11px;
  color: var(--text-faint);
}

.settings__desc {
  font-size: 13px;
  line-height: 1.7;
}

.legal-links {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  font-size: 13px;
}
</style>
