<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { formatCN } from '@/lib/date'
import type { MasterPlan } from '@/types/models'

/**
 * 新建分计划入口：先选择一个所属总计划，再进入分计划表单。
 * 菜单里的「新建分计划」直接指向 /sub-plans/new。
 */
const masterApi = useMasterPlans()
const masters = ref<MasterPlan[]>([])
const loading = ref(true)
const error = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  masters.value = await masterApi.fetchAll()
  error.value = masterApi.error.value
  loading.value = false
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap page-wrap--narrow">
      <nav class="crumb" aria-label="面包屑">
        <RouterLink to="/">我的总计划</RouterLink>
        <span aria-hidden="true">/</span>
        <span>新建分计划</span>
      </nav>

      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">拆解目标</p>
          <h1>选择所属总计划</h1>
          <p class="muted">分计划必须挂在一个最终成果下；选好后填写目标、任务与截止日期。</p>
        </div>
      </header>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在读取总计划…</p>
      </GlassCard>

      <GlassCard v-else-if="error" class="state-card">
        <p class="error-text">{{ error }}</p>
        <button type="button" class="btn btn--ghost btn--sm" @click="load">重新加载</button>
      </GlassCard>

      <GlassCard v-else-if="masters.length === 0" class="state-card">
        <EmptyState
          title="还没有总计划"
          description="先创建一个最终成果，再把它拆成可执行的分计划。"
        >
          <SpriteButton size="sm" @click="$router.push('/master-plans/new')">
            新建总计划
          </SpriteButton>
        </EmptyState>
      </GlassCard>

      <div v-else class="master-picker">
        <RouterLink
          v-for="master in masters"
          :key="master.id"
          :to="{ name: 'sub-plan-new', params: { masterId: master.id } }"
          class="master-choice"
        >
          <GlassCard class="master-choice__card" interactive>
            <span class="master-choice__eyebrow">MASTER PLAN</span>
            <strong>{{ master.name }}</strong>
            <span class="master-choice__meta">{{ formatCN(master.deadline) }} 截止</span>
            <span class="master-choice__arrow" aria-hidden="true">→</span>
          </GlassCard>
        </RouterLink>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--space-4);
  font-size: 12px;
  color: var(--text-tertiary);
}

.crumb a {
  color: var(--text-secondary);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.master-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}

.master-choice {
  color: inherit;
  text-decoration: none;
  border-radius: var(--radius-lg);
}

.master-choice__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 150px;
  border-radius: var(--radius-lg);
  justify-content: center;
}

.master-choice__eyebrow {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.master-choice__card strong {
  font-size: 19px;
  font-weight: 620;
  color: var(--text-strong);
}

.master-choice__meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.master-choice__arrow {
  position: absolute;
  right: 20px;
  bottom: 18px;
  color: var(--accent);
  transition: transform var(--dur-base) var(--ease-spring);
}

.master-choice:hover .master-choice__arrow {
  transform: translate(3px, -3px);
}

@media (max-width: 560px) {
  .master-picker {
    grid-template-columns: 1fr;
  }
}
</style>
