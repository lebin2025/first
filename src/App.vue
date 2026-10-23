<script setup lang="ts">
import { useRoute } from 'vue-router'
import ArtBackground from '@/components/layout/ArtBackground.vue'
import ToastHost from '@/components/ui/ToastHost.vue'

/** 应用根：三主题水彩插画 + 路由页面 + 全局提示 */
const route = useRoute()
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
