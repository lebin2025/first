<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import MenuOverlay from '@/components/layout/MenuOverlay.vue'
import { useSmartBack } from '@/composables/useSmartBack'

/**
 * 已登录区域的全局外壳。
 * 右上角菜单：悬停展开 / 移开收回 / 点击固定，点击遮罩关闭。
 */
const props = withDefaults(defineProps<{ minimal?: boolean; showFooter?: boolean }>(), {
  minimal: false,
  showFooter: true,
})

const menuOpen = ref(false)
const menuPinned = ref(false)
const openedByHover = ref(false)
const { goBack } = useSmartBack()

let openTimer: number | null = null
let closeTimer: number | null = null

const HOVER_OPEN_DELAY = 120
const HOVER_CLOSE_DELAY = 240

function clearOpenTimer(): void {
  if (openTimer !== null) {
    window.clearTimeout(openTimer)
    openTimer = null
  }
}

function clearCloseTimer(): void {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

function closeMenu(): void {
  clearOpenTimer()
  clearCloseTimer()
  menuOpen.value = false
  menuPinned.value = false
  openedByHover.value = false
}

function openPinned(): void {
  clearOpenTimer()
  clearCloseTimer()
  menuOpen.value = true
  menuPinned.value = true
  openedByHover.value = false
}

function scheduleHoverOpen(): void {
  if (menuOpen.value || menuPinned.value) return
  clearCloseTimer()
  if (openTimer !== null) return
  openTimer = window.setTimeout(() => {
    openTimer = null
    if (menuOpen.value) return
    menuOpen.value = true
    menuPinned.value = false
    openedByHover.value = true
  }, HOVER_OPEN_DELAY)
}

function scheduleHoverClose(): void {
  clearOpenTimer()
  if (menuPinned.value) return
  clearCloseTimer()
  closeTimer = window.setTimeout(() => {
    closeTimer = null
    if (!menuPinned.value) menuOpen.value = false
  }, HOVER_CLOSE_DELAY)
}

function onClusterEnter(): void {
  clearCloseTimer()
  if (!menuOpen.value) scheduleHoverOpen()
}

function onClusterLeave(): void {
  clearOpenTimer()
  scheduleHoverClose()
}

function toggleMenu(): void {
  clearOpenTimer()
  clearCloseTimer()
  if (!menuOpen.value) {
    openPinned()
    return
  }
  if (!menuPinned.value) {
    menuPinned.value = true
    openedByHover.value = false
    return
  }
  closeMenu()
}

watch(menuOpen, (open) => {
  if (!open) {
    menuPinned.value = false
    openedByHover.value = false
  }
})

onBeforeUnmount(() => {
  clearOpenTimer()
  clearCloseTimer()
})

const legalItems = [
  { label: '隐私政策', to: '/privacy' },
  { label: '用户协议', to: '/terms' },
]
</script>

<template>
  <div class="shell" :class="{ 'shell--minimal': props.minimal }">
    <header class="shell__top">
      <slot name="top">
        <button type="button" class="brand" aria-label="返回上一页；直接打开时回到总计划" @click="goBack">
          <span class="brand__mark" aria-hidden="true"></span>
          <span class="brand__text">
            拾光
            <small>Picked Light</small>
          </span>
        </button>
      </slot>

      <div
        class="menu-cluster"
        @mouseenter="onClusterEnter"
        @mouseleave="onClusterLeave"
      >
        <button
          type="button"
          class="menu-btn"
          aria-label="打开菜单"
          aria-haspopup="dialog"
          aria-controls="app-menu"
          :aria-expanded="menuOpen"
          @click="toggleMenu"
        >
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
        </button>

        <MenuOverlay
          v-model="menuOpen"
          :focus-on-open="!openedByHover"
        />
      </div>
    </header>

    <div v-if="menuOpen" class="menu-scrim" aria-hidden="true" @click="closeMenu"></div>

    <main class="shell__main">
      <slot />
    </main>

    <footer v-if="showFooter && !props.minimal" class="shell__foot">
      <span class="faint tiny">拾光 · Picked Light</span>
      <nav class="shell__foot-links" aria-label="法律信息">
        <RouterLink v-for="item in legalItems" :key="item.to" :to="item.to" class="tiny">
          {{ item.label }}
        </RouterLink>
      </nav>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.shell__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: clamp(16px, 3vw, 26px) clamp(16px, 3vw, 32px) 0;
}

.shell--minimal .shell__top {
  padding-top: clamp(14px, 3vw, 22px);
}

.shell__main {
  flex: 1;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  color: var(--text-primary);
  text-decoration: none;
  cursor: pointer;
}

.brand__mark {
  width: 26px;
  height: 26px;
  border-radius: 9px;
  background: linear-gradient(140deg, var(--accent) 0%, var(--accent-strong) 100%);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    0 8px 18px -10px var(--accent-strong);
}

.brand__text {
  display: flex;
  flex-direction: column;
  font-size: 14px;
  font-weight: 620;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

.brand__text small {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.menu-cluster {
  position: relative;
  z-index: 999;
  display: inline-flex;
  flex: 0 0 auto;
}

.menu-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.menu-btn span {
  display: block;
  width: 16px;
  height: 1.5px;
  border-radius: 2px;
  background: var(--text-primary);
  transition: transform var(--dur-base) var(--ease-spring);
}

.menu-btn:hover {
  transform: scale(1.06);
  background: var(--glass-bg-hover);
  box-shadow: var(--glass-shadow-hover);
}

.menu-btn:hover span:nth-child(1) {
  transform: translateY(-1px);
}

.menu-btn:hover span:nth-child(3) {
  transform: translateY(1px);
}

/* 点击遮罩关闭；透明到几乎看不见，只负责捕获外部点击 */
.menu-scrim {
  position: fixed;
  inset: 0;
  z-index: 998;
  background: color-mix(in srgb, var(--overlay) 22%, transparent);
}

.shell__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  width: min(1120px, calc(100% - clamp(32px, 6vw, 64px)));
  margin: 0 auto var(--space-4);
  padding: 14px clamp(16px, 2.4vw, 22px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  background: var(--glass-bg-soft);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
}

.shell__foot-links {
  display: flex;
  gap: var(--space-4);
}

.shell__foot-links a {
  color: var(--text-tertiary);
}

.shell__foot-links a:hover {
  color: var(--text-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .menu-btn:hover {
    transform: none;
  }
}
</style>
