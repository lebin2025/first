<script setup lang="ts">
/** 玻璃容器：所有卡片、表单容器的统一外壳 */
withDefaults(
  defineProps<{
    as?: string
    tone?: 'default' | 'strong' | 'soft'
    interactive?: boolean
    padded?: boolean
    flush?: boolean
  }>(),
  {
    as: 'div',
    tone: 'default',
    interactive: false,
    padded: true,
    flush: false,
  },
)
</script>

<template>
  <component
    :is="as"
    class="glass glass-card"
    :class="[
      tone === 'strong' ? 'glass--strong' : '',
      tone === 'soft' ? 'glass--soft' : '',
      { 'glass-card--interactive': interactive, 'glass-card--padded': padded, 'glass-card--flush': flush },
    ]"
  >
    <slot />
  </component>
</template>

<style scoped>
.glass-card {
  position: relative;
  border-radius: var(--radius-lg);
  transition:
    transform var(--dur-base) var(--ease-spring),
    box-shadow var(--dur-base) var(--ease-out),
    background-color var(--dur-base) var(--ease-out);
}

.glass-card--padded {
  padding: clamp(18px, 2.6vw, 28px);
}

.glass-card--flush {
  padding: 0;
  overflow: hidden;
}

.glass-card--interactive {
  cursor: pointer;
}

.glass-card--interactive:hover {
  transform: translateY(-3px);
  box-shadow: var(--glass-shadow-hover);
  background: var(--glass-bg-hover);
}

.glass-card--interactive:active {
  transform: translateY(-1px) scale(0.997);
}

@media (prefers-reduced-motion: reduce) {
  .glass-card--interactive:hover,
  .glass-card--interactive:active {
    transform: none;
  }
}
</style>
