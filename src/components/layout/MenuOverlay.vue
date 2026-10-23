<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useRoomStore } from '@/stores/room'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/composables/useToast'

/**
 * 右上角悬停抽屉。
 *
 * - 卡片固定在 top:60px / right:20px，从按钮右下方弹出；
 * - 鼠标进入按钮或卡片时展开，离开两者时收回；
 * - 点击按钮后由父组件固定展开，点击遮罩/再次点击按钮关闭；
 * - 菜单项使用 TransitionGroup + Shimmer 流光。
 */
const props = withDefaults(
  defineProps<{ modelValue: boolean; focusOnOpen?: boolean }>(),
  { focusOnOpen: true },
)

const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()

const auth = useAuthStore()
const room = useRoomStore()
const theme = useThemeStore()
const router = useRouter()
const route = useRoute()
const toast = useToast()

const drawerRef = ref<HTMLElement | null>(null)
const rendered = ref(props.modelValue)
const signingOut = ref(false)

let hideTimer: number | null = null
let lastActive: HTMLElement | null = null

const leaving = computed(() => !props.modelValue)

const menuItems = computed(() => [
  { label: '总计划', hint: '所有最终成果', to: '/' },
  { label: '新建分计划', hint: '先选择所属总计划', to: '/sub-plans/new' },
  {
    label: '自习室',
    hint: room.roomId ? '回到当前房间' : '和大家一起专注',
    to: room.roomId
      ? { name: 'StudyRoom', params: { id: room.roomId } }
      : '/study-room',
  },
  { label: '统计', hint: '本周节奏与效率系数', to: '/stats' },
  { label: '设置', hint: '账户、偏好与数据', to: '/settings' },
])

const legalItems = [
  { label: '隐私政策', to: '/privacy' },
  { label: '用户协议', to: '/terms' },
]

function close(): void {
  emit('update:modelValue', false)
}

function isActive(to: string | { name?: string; params?: Record<string, string> }): boolean {
  if (typeof to !== 'string') {
    return route.path.startsWith('/study-room')
  }
  if (to === '/') {
    return (
      route.path === '/' ||
      (route.path.startsWith('/sub-plans') && route.path !== '/sub-plans/new' && !route.path.endsWith('/calendar')) ||
      (route.path.startsWith('/master-plans') && route.path !== '/master-plans/new')
    )
  }
  if (to === '/sub-plans/new') {
    return route.path === '/sub-plans/new' || route.path.endsWith('/sub-plans/new')
  }
  return route.path === to || route.path.startsWith(`${to}/`)
}

function clearHideTimer(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
}

function getFocusable(): HTMLElement[] {
  const root = drawerRef.value
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null)
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.modelValue) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const panel = drawerRef.value
  const active = document.activeElement
  if (!panel || !(active instanceof Node) || !panel.contains(active)) return
  const focusable = getFocusable()
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      clearHideTimer()
      rendered.value = true
      lastActive = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.addEventListener('keydown', onKeydown)
      if (props.focusOnOpen) {
        await nextTick()
        drawerRef.value?.querySelector<HTMLElement>('.drawer-item')?.focus()
      }
    } else {
      document.removeEventListener('keydown', onKeydown)
      if (drawerRef.value?.contains(document.activeElement)) lastActive?.focus()
      lastActive = null
      clearHideTimer()
      hideTimer = window.setTimeout(() => {
        rendered.value = false
        hideTimer = null
      }, 200)
    }
  },
)

watch(
  () => route.fullPath,
  () => {
    if (props.modelValue) close()
  },
)

onBeforeUnmount(() => {
  clearHideTimer()
  document.removeEventListener('keydown', onKeydown)
})

async function handleSignOut(): Promise<void> {
  if (signingOut.value) return
  signingOut.value = true
  await auth.signOut()
  signingOut.value = false
  close()
  toast.push('已退出登录')
  await router.replace('/login')
}
</script>

<template>
  <div v-if="rendered" class="drawer-layer">
    <aside
      ref="drawerRef"
      class="menu-drawer"
      :class="{ 'is-leaving': leaving }"
      role="dialog"
      aria-modal="false"
      aria-label="主菜单"
      tabindex="-1"
    >
      <header class="menu-drawer__head">
        <div class="menu-drawer__heading">
          <span class="menu-drawer__eyebrow">MENU / 菜单</span>
          <span class="menu-drawer__status">{{ leaving ? '收起中' : '在线' }}</span>
        </div>
        <button type="button" class="menu-drawer__close" aria-label="关闭菜单" @click="close">
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
        </button>
      </header>

      <TransitionGroup name="drawer-list" tag="nav" class="drawer-list" appear>
        <RouterLink
          v-for="(item, index) in menuItems"
          :key="item.label"
          :to="item.to"
          class="drawer-item"
          :class="{ 'is-active': isActive(item.to) }"
          :aria-current="isActive(item.to) ? 'page' : undefined"
          @click="close"
        >
          <span class="drawer-item__index" aria-hidden="true">
            {{ String(index + 1).padStart(2, '0') }}
          </span>
          <span class="drawer-item__body">
            <span class="drawer-item__label">{{ item.label }}</span>
            <span class="drawer-item__hint">{{ item.hint }}</span>
          </span>
          <span class="drawer-item__arrow" aria-hidden="true">↗</span>
          <span class="drawer-item__shimmer" aria-hidden="true"></span>
        </RouterLink>
      </TransitionGroup>

      <footer class="menu-drawer__foot">
        <section class="drawer-theme" aria-label="切换主题">
          <span class="drawer-theme__label">主题 / THEME</span>
          <div class="drawer-theme__options">
            <button
              v-for="option in theme.themes"
              :key="option.id"
              type="button"
              class="drawer-theme__option"
              :class="{ 'is-active': theme.theme === option.id }"
              :aria-pressed="theme.theme === option.id"
              @click="theme.setTheme(option.id)"
            >
              <span class="drawer-theme__dot" :class="`drawer-theme__dot--${option.id}`" aria-hidden="true"></span>
              {{ option.label }}
            </button>
          </div>
        </section>

        <div class="menu-drawer__meta">
          <span class="menu-drawer__email">{{ auth.email || '未登录' }}</span>
          <div class="menu-drawer__links">
            <RouterLink v-for="item in legalItems" :key="item.to" :to="item.to" @click="close">
              {{ item.label }}
            </RouterLink>
            <button type="button" :disabled="signingOut" @click="handleSignOut">
              {{ signingOut ? '退出中…' : '退出登录' }}
            </button>
          </div>
        </div>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.drawer-layer {
  position: fixed;
  inset: 0;
  z-index: 999;
  width: 100%;
  max-width: 100vw;
  overflow-x: hidden;
  pointer-events: none;
}

/* 右上角玻璃悬浮卡片：纵向 Flex，内容增长时向下呼吸 */
.menu-drawer {
  position: absolute;
  top: 60px;
  right: 20px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(340px, calc(100vw - 40px));
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 120px);
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px;
  border-radius: 24px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  box-shadow:
    0 24px 60px -28px var(--overlay),
    0 8px 22px -14px var(--overlay),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(24px) saturate(145%);
  backdrop-filter: blur(24px) saturate(145%);
  transform-origin: top right;
  animation: drawer-in 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  pointer-events: auto;
}

.menu-drawer.is-leaving {
  animation: drawer-out 0.18s ease forwards;
  pointer-events: none;
}

@supports not ((backdrop-filter: blur(4px)) or (-webkit-backdrop-filter: blur(4px))) {
  .menu-drawer {
    background: var(--glass-fallback);
  }
}

.menu-drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 6px 9px;
}

.menu-drawer__heading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.menu-drawer__eyebrow {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: var(--text-tertiary);
}

.menu-drawer__status {
  font-size: 9px;
  color: var(--text-tertiary);
}

.menu-drawer__close {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.menu-drawer__close:hover {
  background: var(--glass-bg);
  transform: rotate(90deg);
}

.menu-drawer__close span {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 11px;
  height: 1.4px;
  border-radius: 2px;
  background: var(--text-primary);
}

.menu-drawer__close span:first-child {
  transform: translate(-50%, -50%) rotate(45deg);
}

.menu-drawer__close span:last-child {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.drawer-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
  max-width: 100%;
  overflow-x: clip;
  padding: 2px 2px 2px;
}

.drawer-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 9px 10px;
  border-radius: 14px;
  color: var(--text-primary);
  text-decoration: none;
  overflow: hidden;
  box-sizing: border-box;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.drawer-item:hover,
.drawer-item:focus-visible {
  outline: none;
  transform: translateX(10px) scale(1.035);
  background: var(--glass-bg-soft);
  box-shadow: 0 8px 20px -14px var(--overlay);
}

.drawer-item.is-active {
  background: var(--accent-softer);
}

.drawer-item__index {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.drawer-item__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.drawer-item__label {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--text-strong);
  transition: text-shadow var(--dur-base) var(--ease-out);
}

.drawer-item__hint {
  font-size: 10px;
  color: var(--text-tertiary);
}

.drawer-item__arrow {
  font-size: 14px;
  color: var(--text-tertiary);
  transition:
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.drawer-item:hover .drawer-item__arrow,
.drawer-item:focus-visible .drawer-item__arrow {
  color: var(--accent);
  transform: translate(2px, -2px);
}

.drawer-item:hover .drawer-item__label,
.drawer-item:focus-visible .drawer-item__label {
  text-shadow: 0 0 18px var(--accent-soft);
}

/* 流光扫过 */
.drawer-item__shimmer {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: linear-gradient(
    105deg,
    transparent 28%,
    color-mix(in srgb, var(--glass-highlight) 58%, transparent) 48%,
    transparent 68%
  );
  transform: translateX(-130%);
  opacity: 0;
}

.drawer-item:hover .drawer-item__shimmer,
.drawer-item:focus-visible .drawer-item__shimmer {
  opacity: 1;
  animation: shimmer-sweep 0.75s var(--ease-out);
}

.menu-drawer__foot {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 9px 4px 2px;
  border-top: 1px solid var(--line-soft);
}

.drawer-theme {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.drawer-theme__label {
  font-size: 8px;
  letter-spacing: 0.2em;
  color: var(--text-tertiary);
}

.drawer-theme__options {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
}

.drawer-theme__option {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.drawer-theme__option.is-active {
  border-color: var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
}

.drawer-theme__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
}

.drawer-theme__dot--ride { background: var(--theme-dot-ride); }
.drawer-theme__dot--sakura { background: var(--theme-dot-sakura); }
.drawer-theme__dot--winter { background: var(--theme-dot-winter); }

.menu-drawer__meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.menu-drawer__email {
  font-size: 10px;
  color: var(--text-tertiary);
  word-break: break-all;
}

.menu-drawer__links {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.menu-drawer__links a,
.menu-drawer__links button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  text-decoration: none;
  cursor: pointer;
}

.menu-drawer__links a:hover,
.menu-drawer__links button:hover:not(:disabled) {
  color: var(--accent);
}

.menu-drawer__links button:disabled {
  opacity: 0.5;
  cursor: wait;
}

/* 入场：从按钮位置 scale(.8) 弹出 */
@keyframes drawer-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.8);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes drawer-out {
  to {
    opacity: 0;
    transform: translateY(-6px) scale(0.94);
  }
}

@keyframes shimmer-sweep {
  from { transform: translateX(-130%); }
  to { transform: translateX(130%); }
}

.drawer-list-enter-from {
  opacity: 0;
  transform: translateX(24px) translateY(-8px) scale(0.8);
}

.drawer-list-enter-active {
  transition: all 0.42s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.drawer-list-enter-to {
  opacity: 1;
  transform: translateX(0) translateY(0) scale(1);
}

.drawer-list-enter-active:nth-child(2) { transition-delay: 45ms; }
.drawer-list-enter-active:nth-child(3) { transition-delay: 90ms; }
.drawer-list-enter-active:nth-child(4) { transition-delay: 135ms; }
.drawer-list-enter-active:nth-child(5) { transition-delay: 180ms; }

.drawer-list-leave-active {
  transition: all 0.18s ease;
  position: absolute;
  width: 100%;
  max-width: 100%;
}

.drawer-list-leave-to {
  opacity: 0;
  transform: scale(0.94);
}

@media (max-width: 600px) {
  .menu-drawer {
    top: 64px;
    right: 12px;
    width: min(340px, calc(100vw - 24px));
    max-height: calc(100vh - 76px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .menu-drawer,
  .menu-drawer.is-leaving {
    animation: none;
  }

  .drawer-list-enter-active,
  .drawer-list-enter-active:nth-child(n),
  .drawer-list-leave-active {
    transition-duration: 0.01ms;
    transition-delay: 0ms;
  }

  .drawer-list-enter-from,
  .drawer-list-leave-to,
  .drawer-item:hover,
  .drawer-item:focus-visible {
    transform: none;
  }

  .drawer-item__shimmer {
    display: none;
  }
}
</style>
