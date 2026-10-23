<script setup lang="ts">
/** 空状态：首页、列表页共用 */
withDefaults(
  defineProps<{
    title: string
    description?: string
    compact?: boolean
  }>(),
  { description: '', compact: false },
)
</script>

<template>
  <div class="empty" :class="{ 'empty--compact': compact }">
    <div class="empty__glow" aria-hidden="true"></div>
    <h3 class="empty__title">{{ title }}</h3>
    <p v-if="description" class="empty__desc">{{ description }}</p>
    <div v-if="$slots.default" class="empty__actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: clamp(28px, 6vw, 56px) var(--space-5);
  overflow: hidden;
}

.empty--compact {
  padding: var(--space-6) var(--space-4);
}

.empty__glow {
  position: absolute;
  top: -30%;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft), transparent 70%);
  filter: blur(24px);
  pointer-events: none;
}

.empty__title {
  position: relative;
  font-size: 17px;
  color: var(--text-strong);
  font-weight: 600;
}

.empty__desc {
  position: relative;
  max-width: 380px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.7;
}

.empty__actions {
  position: relative;
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  justify-content: center;
  margin-top: var(--space-3);
}
</style>
