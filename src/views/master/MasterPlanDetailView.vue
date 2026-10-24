<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useSubPlans } from '@/composables/useSubPlans'
import { useTasks } from '@/composables/useTasks'
import { buildMasterPlanSummary, isMasterPlanAtRisk } from '@/lib/summaries'
import { diffDays, formatCN, formatCNFull, todayISO } from '@/lib/date'
import {
  MEASURE_TYPE_LABELS,
  type MasterPlan,
  type MasterPlanSummary,
} from '@/types/models'
import { useToast } from '@/composables/useToast'

/** 总计划详情：总计划 → 分计划的跳转点 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const masterApi = useMasterPlans()
const subApi = useSubPlans()
const taskApi = useTasks()

const masterPlan = ref<MasterPlan | null>(null)
const summary = ref<MasterPlanSummary | null>(null)
const loading = ref(true)
const error = ref('')
const showDelete = ref(false)
const deleting = ref(false)
const today = todayISO()

const risk = computed(() => {
  if (!masterPlan.value || !summary.value) return { atRisk: false, elapsedRatio: 0 }
  return isMasterPlanAtRisk({
    createdAt: masterPlan.value.createdAt,
    deadline: masterPlan.value.deadline,
    today,
    progress: summary.value.progress,
  })
})

const remainingDays = computed(() =>
  masterPlan.value ? diffDays(today, masterPlan.value.deadline) : 0,
)

const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const plan = await masterApi.fetchOne(id.value)
    if (!plan) {
      error.value = masterApi.error.value || '总计划不存在，或你没有访问权限。'
      return
    }
    masterPlan.value = plan
    const [subs, tasks] = await Promise.all([subApi.fetchByMaster(plan.id), taskApi.fetchAll()])
    summary.value = buildMasterPlanSummary(plan, subs, tasks, today)
  } finally {
    loading.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!masterPlan.value || deleting.value) return
  deleting.value = true
  const ok = await masterApi.remove(masterPlan.value.id)
  deleting.value = false
  showDelete.value = false
  if (!ok) {
    error.value = masterApi.error.value || '删除失败'
    return
  }
  toast.success('总计划已删除')
  await router.replace('/')
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <nav class="crumb" aria-label="面包屑">
        <RouterLink to="/">我的总计划</RouterLink>
        <span aria-hidden="true">/</span>
        <span>{{ masterPlan?.name ?? '详情' }}</span>
      </nav>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在读取…</p>
      </GlassCard>

      <GlassCard v-else-if="error && !masterPlan" class="state-card">
        <p class="error-text">{{ error }}</p>
        <div class="row">
          <button type="button" class="btn btn--ghost btn--sm" @click="load">重试</button>
          <RouterLink class="btn btn--ghost btn--sm" to="/">返回总计划</RouterLink>
        </div>
      </GlassCard>

      <template v-else-if="masterPlan && summary">
        <header class="master-head">
          <div class="master-head__text">
            <p class="eyebrow">{{ masterPlan.measureDetail || MEASURE_TYPE_LABELS[masterPlan.measureType] }}</p>
            <h1>{{ masterPlan.name }}</h1>
            <p v-if="masterPlan.description" class="master-head__desc">{{ masterPlan.description }}</p>
            <div class="master-head__meta">
              <StatusTag kind="master" :status="summary.status" dot />
              <span class="tiny faint">{{ formatCNFull(masterPlan.deadline) }} 截止</span>
              <span class="tiny faint">
                {{ summary.status === 'overdue' ? '已逾期' : `剩余 ${Math.max(0, remainingDays)} 天` }}
              </span>
              <span class="tiny faint numeric">{{ summary.subPlanCount }} 个分计划</span>
            </div>
          </div>
          <div class="master-head__actions">
            <SpriteButton size="sm" @click="router.push(`/master-plans/${masterPlan.id}/sub-plans/new`)">
              + 新建分计划
            </SpriteButton>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              @click="router.push(`/master-plans/${masterPlan.id}/edit`)"
            >
              编辑总计划
            </button>
            <button type="button" class="btn btn--danger btn--sm" @click="showDelete = true">删除</button>
          </div>
        </header>

        <p v-if="risk.atRisk" class="risk-banner" role="status">
          按当前进度，总计划可能无法在 {{ formatCN(masterPlan.deadline) }} 前完成：时间已过
          {{ Math.round(risk.elapsedRatio * 100) }}%，整体进度 {{ Math.round(summary.progress * 100) }}%。
        </p>
        <p v-if="summary.status === 'overdue'" class="risk-banner" role="status">
          已超过截止日期，建议调整总计划或重新分配各分计划的截止日期。
        </p>

        <GlassCard class="overview">
          <div class="overview__row">
            <div class="overview__progress">
              <ProgressBar :value="summary.progress" label="整体进度（按任务时长加权）" show-value />
            </div>
            <dl class="overview__stats">
              <div>
                <dt>已投入</dt>
                <dd class="numeric">{{ Math.round(summary.earnedMinutes) }} 分钟</dd>
              </div>
              <div>
                <dt>总时长</dt>
                <dd class="numeric">{{ Math.round(summary.totalMinutes) }} 分钟</dd>
              </div>
              <div>
                <dt>截止</dt>
                <dd>{{ formatCN(masterPlan.deadline) }}</dd>
              </div>
            </dl>
          </div>
        </GlassCard>

        <section class="section">
          <div class="section__head">
            <span class="section__title">分计划 · 可执行模块</span>
            <span class="tiny faint">{{ summary.subPlanCount }} 个</span>
          </div>

          <GlassCard v-if="summary.subPlanCount === 0" class="state-card">
            <EmptyState
              compact
              title="还没有分计划"
              description="分计划才是排每日任务的地方。把目标拆成 2-4 个模块，每个模块有自己的截止日期与每日可用时间。"
            >
              <SpriteButton
                size="sm"
                @click="router.push(`/master-plans/${masterPlan.id}/sub-plans/new`)"
              >
                创建分计划
              </SpriteButton>
            </EmptyState>
          </GlassCard>

          <div v-else class="sub-grid">
            <div v-for="item in summary.subPlans" :key="item.subPlan.id" class="sub-card-wrap">
              <GlassCard interactive class="sub-card">
                <RouterLink
                  class="sub-card__cover"
                  :to="`/sub-plans/${item.subPlan.id}`"
                  :aria-label="`查看分计划 ${item.subPlan.name}`"
                ></RouterLink>

                <header class="sub-card__head">
                  <h3>{{ item.subPlan.name }}</h3>
                  <StatusTag kind="sub" :status="item.status" />
                </header>

                <ProgressBar :value="item.progress" show-value size="sm" label="进度" />

                <footer class="sub-card__foot">
                  <span class="numeric">{{ item.doneCount }}/{{ item.taskCount }} 个任务</span>
                  <span>{{ formatCN(item.subPlan.deadline) }} 截止</span>
                  <span v-if="item.overdueTaskCount > 0" class="sub-card__warn">
                    {{ item.overdueTaskCount }} 个任务逾期
                  </span>
                  <RouterLink class="sub-card__edit" :to="`/sub-plans/${item.subPlan.id}/edit`">
                    编辑
                  </RouterLink>
                </footer>
              </GlassCard>
            </div>
          </div>
        </section>

        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      </template>
    </div>

    <ConfirmDialog
      v-model="showDelete"
      title="删除这个总计划？"
      :description="`「${masterPlan?.name ?? ''}」下的所有分计划与任务都会一并删除，无法恢复。`"
      confirm-label="删除"
      danger
      :busy="deleting"
      @confirm="confirmDelete"
    />
  </AppShell>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: var(--space-4);
}

.crumb a {
  color: var(--text-muted);
}

.crumb a:hover {
  color: var(--text-strong);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.master-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-5);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.master-head__text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.master-head__desc {
  max-width: 620px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
}

.master-head__meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: 4px;
}

.master-head__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.risk-banner {
  margin-bottom: var(--space-4);
  padding: 12px 16px;
  border-radius: var(--radius-md);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 26%, transparent);
  color: var(--danger);
  font-size: 13px;
  line-height: 1.7;
}

.overview__row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-wrap: wrap;
}

.overview__progress {
  flex: 1;
  min-width: 220px;
}

.overview__stats {
  display: flex;
  gap: var(--space-6);
  margin: 0;
  flex-wrap: wrap;
}

.overview__stats dt {
  font-size: 11px;
  color: var(--text-faint);
}

.overview__stats dd {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 560;
  color: var(--text-strong);
}

.sub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
}

.sub-card-wrap {
  position: relative;
  border-radius: var(--radius-lg);
}

.sub-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
}

/* 整卡可点击的透明覆盖链接，编辑按钮浮在它上面 */
.sub-card__cover {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
}

.sub-card__cover:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.sub-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.sub-card__head h3 {
  font-size: 16px;
}

.sub-card__foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  font-size: 12px;
  color: var(--text-faint);
  padding-top: var(--space-2);
  border-top: 1px solid var(--line-soft);
}

.sub-card__warn {
  color: var(--danger);
}

.sub-card__edit {
  position: relative;
  z-index: 2;
  margin-left: auto;
  font-size: 12px;
  font-weight: 560;
  color: var(--accent-strong);
}

.sub-card__edit:hover {
  color: var(--accent);
  text-decoration: underline;
}

@media (max-width: 640px) {
  .sub-grid {
    grid-template-columns: 1fr;
  }
}
</style>
