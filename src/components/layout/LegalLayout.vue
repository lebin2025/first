<script setup lang="ts">
import GlassCard from '@/components/ui/GlassCard.vue'

/** 法律页通用外壳（隐私政策 / 用户协议），无需登录 */
withDefaults(
  defineProps<{
    title: string
    effectiveDate: string
    kicker?: string
  }>(),
  { kicker: 'Shiguang · Picked Light' },
)
</script>

<template>
  <div class="legal">
    <header class="legal__top">
      <RouterLink to="/" class="legal__brand">
        <span class="legal__mark" aria-hidden="true"></span>
        拾光 · Picked Light
      </RouterLink>
      <RouterLink to="/" class="legal__back">返回首页</RouterLink>
    </header>

    <GlassCard class="legal__card">
      <p class="eyebrow">{{ kicker }}</p>
      <h1 class="legal__title">{{ title }}</h1>
      <p class="legal__date">生效日期：{{ effectiveDate }}</p>
      <div class="legal__body">
        <slot />
      </div>
      <footer class="legal__foot">
        <span class="tiny faint">如有疑问，请联系：2658116631@qq.com</span>
        <nav class="legal__links" aria-label="法律信息">
          <RouterLink to="/privacy">隐私政策</RouterLink>
          <RouterLink to="/terms">用户协议</RouterLink>
        </nav>
      </footer>
    </GlassCard>
  </div>
</template>

<style scoped>
.legal {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  padding: clamp(20px, 4vw, 40px) var(--space-4) clamp(40px, 6vw, 72px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-5);
}

.legal__top {
  width: min(820px, 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.legal__brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--text-strong);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.legal__mark {
  width: 20px;
  height: 20px;
  border-radius: 7px;
  background: linear-gradient(140deg, var(--accent) 0%, var(--aurora-two) 100%);
}

.legal__back {
  font-size: 12px;
  color: var(--text-muted);
}

.legal__card {
  width: min(820px, 100%);
  padding: clamp(24px, 4vw, 44px);
  border-radius: var(--radius-xl);
}

.legal__title {
  margin-top: 6px;
  font-size: clamp(26px, 4vw, 34px);
}

.legal__date {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-faint);
}

.legal__body {
  margin-top: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  font-size: 14px;
  line-height: 1.85;
  color: var(--text-muted);
}

.legal__body :deep(h2) {
  margin-top: var(--space-4);
  font-size: 16px;
  color: var(--text-strong);
  font-weight: 600;
}

.legal__body :deep(p) {
  margin: 0;
}

.legal__body :deep(ul) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 0;
}

.legal__body :deep(li) {
  position: relative;
  padding-left: 16px;
}

.legal__body :deep(li::before) {
  content: '';
  position: absolute;
  left: 2px;
  top: 0.78em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.7;
}

.legal__body :deep(strong) {
  color: var(--text);
  font-weight: 600;
}

.legal__foot {
  margin-top: var(--space-7);
  padding-top: var(--space-5);
  border-top: 1px solid var(--line-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.legal__links {
  display: flex;
  gap: var(--space-4);
  font-size: 12px;
}
</style>
