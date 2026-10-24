<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import ArtBackground from '@/components/layout/ArtBackground.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useAudioStore } from '@/stores/audio'

/** 应用根：三主题水彩插画 + 路由页面 + 全局提示 */
const route = useRoute()
const audio = useAudioStore()

let idleHandle: number | null = null
let fallbackTimer: number | null = null

function cancelPreloadSchedule(): void {
  if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(idleHandle)
    idleHandle = null
  }
  if (fallbackTimer !== null) {
    window.clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
}

onMounted(() => {
  audio.initialize()
  const start = (): void => {
    idleHandle = null
    fallbackTimer = null
    void audio.preloadAll()
  }

  if (typeof window.requestIdleCallback === 'function') {
    idleHandle = window.requestIdleCallback(start, { timeout: 3000 })
  } else {
    fallbackTimer = window.setTimeout(start, 3000)
  }
})

onBeforeUnmount(cancelPreloadSchedule)
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
