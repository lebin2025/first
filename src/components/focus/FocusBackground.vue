<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useFocusThemeStore } from '@/stores/focusTheme'

/** 图片背景：new Image() 预加载 -> 淡入；Ken Burns 30s；Mask 单独一层。 */
const themeStore = useFocusThemeStore()

const IMAGE_VERSION = '20261024-3'
const displayed = ref('')
const loading = ref(true)
const failed = ref(false)
let preloadToken = 0

const imageSrc = computed(
  () => `/bg-${themeStore.theme}.jpg?v=${IMAGE_VERSION}`,
)

function preload(src: string, token: number): void {
  const image = new Image()
  image.decoding = 'async'
  image.src = src

  const commit = (): void => {
    if (token !== preloadToken) return
    displayed.value = src
    loading.value = false
    failed.value = false
  }

  image.onload = commit
  image.onerror = (): void => {
    if (token !== preloadToken) return
    loading.value = false
    failed.value = true
  }
}

watch(
  imageSrc,
  (src) => {
    preloadToken += 1
    loading.value = true
    failed.value = false
    preload(src, preloadToken)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  preloadToken += 1
})
</script>

<template>
  <div
    class="focus-backdrop"
    :class="[`focus-backdrop--${themeStore.theme}`, { 'is-loading': loading }]"
    aria-hidden="true"
  >
    <Transition name="focus-bg-fade">
      <img
        v-if="displayed"
        :key="displayed"
        class="focus-backdrop__image"
        :src="displayed"
        alt=""
        draggable="false"
      />
    </Transition>

    <div v-if="!displayed || failed" class="focus-backdrop__fallback"></div>

    <div class="focus-backdrop__mask"></div>

    <div v-if="loading" class="focus-backdrop__loading">
      <span></span>
    </div>
  </div>
</template>

<style scoped>
.focus-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: var(--focus-bg);
  pointer-events: none;
}

.focus-backdrop__image {
  position: absolute;
  inset: -4%;
  width: 108%;
  height: 108%;
  max-width: none;
  object-fit: cover;
  object-position: center;
  will-change: transform;
  animation: focus-ken-burns 30s ease-in-out infinite alternate;
}

.focus-backdrop--sunset .focus-backdrop__image {
  object-position: center 42%;
}

.focus-backdrop__mask {
  position: absolute;
  inset: 0;
  background: var(--focus-bg-mask);
  -webkit-backdrop-filter: var(--focus-mask-backdrop);
  backdrop-filter: var(--focus-mask-backdrop);
}

.focus-backdrop--sunset .focus-backdrop__mask {
  background: var(--focus-bg-mask);
}

.focus-backdrop__fallback {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(80% 70% at 50% 20%, var(--focus-halo), transparent 70%),
    var(--focus-bg);
}

.focus-backdrop__loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}

.focus-backdrop__loading span {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--focus-border);
  border-top-color: var(--focus-accent);
  animation: focus-bg-spin 0.9s linear infinite;
}

.focus-bg-fade-enter-active,
.focus-bg-fade-leave-active {
  transition: opacity 0.8s ease-in-out;
}

.focus-bg-fade-enter-from,
.focus-bg-fade-leave-to {
  opacity: 0;
}

@keyframes focus-ken-burns {
  0% {
    transform: scale(1) translate3d(0, 0, 0);
  }
  50% {
    transform: scale(1.025) translate3d(-0.7%, -0.5%, 0);
  }
  100% {
    transform: scale(1.05) translate3d(-1.2%, 0.8%, 0);
  }
}

@keyframes focus-bg-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .focus-backdrop__image {
    animation: none;
    transform: none;
  }

  .focus-backdrop__loading span {
    animation: none;
  }

  .focus-bg-fade-enter-active,
  .focus-bg-fade-leave-active {
    transition: none;
  }
}
</style>
