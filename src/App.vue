<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useThemeStore } from '@/stores/theme'

/** 应用根：背景 Canvas 独立分包，避免阻塞首屏 JS */
const ArtBackground = defineAsyncComponent(
  () => import('@/components/layout/ArtBackground.vue'),
)

const route = useRoute()
const theme = useThemeStore()

let cancelAudioPreload: (() => void) | null = null

const heroPreloads = new Set<string>()

function preloadHeroImage(src: string): void {
  if (!src || heroPreloads.has(src)) return
  heroPreloads.add(src)

  const link = document.createElement('link')
  link.rel = 'preload'
  link.as = 'image'
  link.href = src
  link.setAttribute('fetchpriority', 'high')
  link.dataset.heroPreload = 'true'
  document.head.appendChild(link)
}

watch(
  () => theme.current.image,
  (src) => preloadHeroImage(src),
  { immediate: true },
)

onMounted(() => {
  // 音频 Store 动态加载，不进入首屏关键 bundle
  void import('@/stores/audio')
    .then(({ useAudioStore }) => {
      const audio = useAudioStore()
      audio.initialize()
      cancelAudioPreload = audio.schedulePreload(5000)
    })
    .catch((cause) => {
      console.warn('[app] 音频预加载初始化失败', cause)
    })
})

onBeforeUnmount(() => {
  cancelAudioPreload?.()
  cancelAudioPreload = null
})
</script>

<template>
  <ArtBackground />
  <div class="app-root">
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.fullPath" />
      </Transition>
    </RouterView>
  </div>
  <ToastHost />
</template>

<style scoped>
.app-root {
  position: relative;
  z-index: 1;
  min-height: 100vh;
}

.page-enter-active,
.page-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
}
</style>
