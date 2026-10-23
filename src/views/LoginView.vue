<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/composables/useToast'

/** 登录 / 注册：单卡片、极简、无营销模块 */
const auth = useAuthStore()
const theme = useThemeStore()
const router = useRouter()
const toast = useToast()

const mode = ref<'signin' | 'signup'>('signin')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const localError = ref('')
const notice = ref('')

const isSignup = computed(() => mode.value === 'signup')
const submitting = computed(() => auth.loading)

function switchMode(next: 'signin' | 'signup'): void {
  mode.value = next
  localError.value = ''
  notice.value = ''
  auth.clearError()
}

function validate(): boolean {
  if (!email.value.trim()) {
    localError.value = '请输入邮箱地址'
    return false
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    localError.value = '邮箱格式不正确'
    return false
  }
  if (password.value.length < 6) {
    localError.value = '密码至少 6 位'
    return false
  }
  if (isSignup.value && password.value !== confirmPassword.value) {
    localError.value = '两次输入的密码不一致'
    return false
  }
  return true
}

async function afterAuth(): Promise<void> {
  toast.success(isSignup.value ? '账户已创建' : '欢迎回来')
  // 登录后统一回到总计划列表，层级从「总计划 → 分计划 → 专注」开始
  await router.replace('/')
}

async function submit(): Promise<void> {
  localError.value = ''
  notice.value = ''
  if (!validate()) return

  if (isSignup.value) {
    const result = await auth.signUp(email.value, password.value)
    if (!result.ok) return
    if (result.needsConfirmation) {
      notice.value = '注册成功。请到邮箱点击确认链接，然后回到这里登录。'
      mode.value = 'signin'
      password.value = ''
      confirmPassword.value = ''
      return
    }
    await afterAuth()
    return
  }

  const ok = await auth.signIn(email.value, password.value)
  if (!ok) return
  await afterAuth()
}
</script>

<template>
  <div class="auth">
    <div class="auth__inner">
      <div class="auth__brand" aria-hidden="true">
        <span class="auth__mark"></span>
        <span>拾光 · Picked Light</span>
      </div>

      <GlassCard tone="strong" class="auth__card">
        <header class="auth__head">
          <p class="eyebrow">学习计划助手</p>
          <h1 class="auth__title">从一个目标，到一次专注</h1>
          <p class="auth__tagline">
            先写下最终成果，再拆成可执行的分计划。计划延误时自动重排，进入专注后只剩眼前这一块。
          </p>
        </header>

        <div class="auth__tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            class="auth__tab"
            :class="{ 'is-active': !isSignup }"
            :aria-selected="!isSignup"
            @click="switchMode('signin')"
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            class="auth__tab"
            :class="{ 'is-active': isSignup }"
            :aria-selected="isSignup"
            @click="switchMode('signup')"
          >
            注册
          </button>
        </div>

        <form class="auth__form" novalidate @submit.prevent="submit">
          <div class="field">
            <label class="field__label" for="auth-email">邮箱</label>
            <input
              id="auth-email"
              v-model="email"
              class="input"
              type="email"
              name="email"
              autocomplete="email"
              placeholder="you@example.com"
              :aria-invalid="Boolean(localError)"
              required
            />
          </div>

          <div class="field">
            <label class="field__label" for="auth-password">密码</label>
            <input
              id="auth-password"
              v-model="password"
              class="input"
              type="password"
              name="password"
              :autocomplete="isSignup ? 'new-password' : 'current-password'"
              placeholder="至少 6 位"
              minlength="6"
              required
            />
          </div>

          <div v-if="isSignup" class="field">
            <label class="field__label" for="auth-confirm">确认密码</label>
            <input
              id="auth-confirm"
              v-model="confirmPassword"
              class="input"
              type="password"
              name="confirm-password"
              autocomplete="new-password"
              placeholder="再输入一次"
              minlength="6"
              required
            />
          </div>

          <p v-if="localError || auth.error" class="error-text" role="alert">
            {{ localError || auth.error }}
          </p>
          <p v-if="notice" class="success-text" role="status">{{ notice }}</p>

          <SpriteButton type="submit" size="lg" block :loading="submitting">
            {{ isSignup ? '创建账户' : '进入拾光' }}
          </SpriteButton>
        </form>

        <p class="auth__legal tiny">
          继续即表示你已阅读并同意
          <RouterLink to="/terms">《用户协议》</RouterLink>
          与
          <RouterLink to="/privacy">《隐私政策》</RouterLink>
          。
        </p>
      </GlassCard>

      <div class="auth__themes" role="group" aria-label="切换主题">
        <button
          v-for="option in theme.themes"
          :key="option.id"
          type="button"
          class="auth__theme"
          :class="{ 'is-active': theme.theme === option.id }"
          :aria-pressed="theme.theme === option.id"
          @click="theme.setTheme(option.id)"
        >
          <span class="auth__theme-dot" :class="`auth__theme-dot--${option.id}`" aria-hidden="true"></span>
          {{ option.label }}
        </button>
      </div>

      <p class="auth__foot tiny faint">免费个人项目 · 不收集与学习无关的个人信息</p>
    </div>
  </div>
</template>

<style scoped>
.auth {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: clamp(24px, 5vw, 56px) var(--space-4);
}

.auth__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
}

.auth__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.auth__mark {
  width: 22px;
  height: 22px;
  border-radius: 8px;
  background: linear-gradient(140deg, var(--accent) 0%, var(--aurora-two) 100%);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}

.auth__card {
  width: min(440px, 94vw);
  padding: clamp(24px, 4vw, 36px);
  border-radius: 24px;
  border: 1px solid var(--glass-border);
  background: color-mix(in srgb, var(--glass-bg-strong) 88%, transparent);
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-highlight);
}

.auth__head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: var(--space-5);
}

.auth__title {
  font-size: clamp(24px, 5vw, 30px);
}

.auth__tagline {
  font-size: 13px;
  line-height: 1.75;
  color: var(--text-muted);
}

.auth__tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--glass-bg-soft);
  border: 1px solid var(--line-soft);
  margin-bottom: var(--space-5);
}

.auth__tab {
  padding: 8px 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 560;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.auth__tab.is-active {
  background: var(--glass-bg-strong);
  color: var(--text-strong);
  box-shadow: var(--glass-shadow);
}

.auth__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 极简输入：去掉盒子，只留一条底部细线 */
.auth__form .input {
  width: 100%;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--text-strong);
  font-size: 15px;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.auth__form .input::placeholder {
  color: var(--text-tertiary);
}

.auth__form .input:focus {
  outline: none;
  border-bottom-color: var(--accent);
  box-shadow:
    0 1px 0 var(--accent),
    0 12px 24px -18px var(--accent);
}

.auth__form .field {
  gap: 4px;
}

.auth__legal {
  margin-top: var(--space-4);
  color: var(--text-faint);
  line-height: 1.7;
  text-align: center;
}

.auth__themes {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-pill);
  background: var(--glass-bg-soft);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
}

.auth__theme {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.auth__theme:hover {
  color: var(--text-primary);
}

.auth__theme.is-active {
  border-color: var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-primary);
}

.auth__theme-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
}

.auth__theme-dot--ride {
  background: var(--theme-dot-ride);
}

.auth__theme-dot--sakura {
  background: var(--theme-dot-sakura);
}

.auth__theme-dot--winter {
  background: var(--theme-dot-winter);
}

.auth__foot {
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  background: var(--glass-bg-soft);
  color: var(--text-muted);
  text-align: center;
  text-shadow: var(--heading-shadow, none);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

@media (prefers-reduced-motion: reduce) {
  .auth__card {
    transition: none;
  }
}
</style>
