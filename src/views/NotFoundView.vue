<script setup lang="ts">
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'

/** 404：保持极简，只给一条回到首页的路 */
</script>

<template>
  <div class="notfound">
    <GlassCard tone="strong" class="notfound__card">
      <p class="eyebrow">404</p>
      <h1>这个页面不存在</h1>
      <p class="notfound__desc">
        可能是链接过期，或者计划已经被删除。回到总计划列表，继续拆解你的目标。
      </p>
      <div class="notfound__actions">
        <SpriteButton @click="$router.push('/')">回到总计划</SpriteButton>
      </div>
    </GlassCard>
  </div>
</template>

<style scoped>
.notfound {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-4);
}

.notfound__card {
  width: min(440px, 94vw);
  padding: clamp(28px, 5vw, 44px);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.notfound__desc {
  font-size: 13px;
  line-height: 1.75;
  color: var(--text-muted);
}

.notfound__actions {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-3);
}
</style>
