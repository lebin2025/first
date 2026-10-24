<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import TaskCascadeModal from '@/components/focus/TaskCascadeModal.vue'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useSubPlans } from '@/composables/useSubPlans'
import { useTasks } from '@/composables/useTasks'
import { useSampleData } from '@/composables/useSampleData'
import { useToast } from '@/composables/useToast'
import { buildMasterPlanSummary } from '@/lib/summaries'
import { diffDays, formatCN, todayISO } from '@/lib/date'
import { MEASURE_TYPE_LABELS, type MasterPlanSummary } from '@/types/models'

/** 总计划列表：登录后的落地页（/），也是「总计划 → 分计划 → 专注」的起点 */
const router = useRouter()
const masterApi = useMasterPlans()
const subApi = useSubPlans()
const taskApi = useTasks()
const sample = useSampleData()
const toast = useToast()

const loading = ref(true)
const error = ref('')
const creatingSample = ref(false)
const summaries = ref<MasterPlanSummary[]>([])
const today = todayISO()
const heroPhrase = ref('Shoot for the moon.')
const cascadeOpen = ref(false)

const hasPlans = computed(() => summaries.value.length > 0)

function remainingDays(deadline: string): number {
  return Math.max(0, diffDays(today, deadline))
}

function statusTone(status: MasterPlanSummary['status']): 'accent' | 'success' | 'danger' {
  if (status === 'completed') return 'success'
  if (status === 'overdue') return 'danger'
  return 'accent'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [masters, subs, tasks] = await Promise.all([
      masterApi.fetchAll(),
      subApi.fetchAll(),
      taskApi.fetchAll(),
    ])
    error.value = masterApi.error.value || subApi.error.value || taskApi.error.value
    summaries.value = masters.map((master) => buildMasterPlanSummary(master, subs, tasks, today))
  } finally {
    loading.value = false
  }
}

/** 空状态的一次性示例：生成总计划 + 分计划 + 任务，便于直接体验完整层级 */
async function createSample(): Promise<void> {
  if (creatingSample.value) return
  creatingSample.value = true
  const ok = await sample.createSample()
  creatingSample.value = false
  if (!ok) {
    error.value = sample.error.value || '示例数据生成失败'
    return
  }
  toast.success('示例计划已生成')
  await load()
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">从这里开始</p>
          <h1 class="hero-phrase">{{ heroPhrase }}</h1>
          <p class="muted">选择一个最终成果，继续拆成可执行的分计划；进度由任务时长加权算出。</p>
        </div>
        <div class="page-head__actions">
          <SpriteButton size="sm" @click="router.push('/master-plans/new')">+ 新建总计划</SpriteButton>
        </div>
      </header>

      <div
        v-if="loading"
        class="plan-skeleton-grid"
        aria-busy="true"
        aria-label="正在加载总计划"
      >
        <div v-for="index in 3" :key="index" class="plan-skeleton">
          <span class="plan-skeleton__line plan-skeleton__line--eyebrow"></span>
          <span class="plan-skeleton__line plan-skeleton__line--title"></span>
          <span class="plan-skeleton__line plan-skeleton__line--desc"></span>
          <span class="plan-skeleton__line plan-skeleton__line--desc short"></span>
          <span class="plan-skeleton__bar"></span>
          <span class="plan-skeleton__line plan-skeleton__line--foot"></span>
        </div>
      </div>

      <GlassCard v-else-if="error" class="state-card">
        <p class="error-text">{{ error }}</p>
        <button type="button" class="btn btn--ghost btn--sm" @click="load">重新加载</button>
      </GlassCard>

      <GlassCard v-else-if="!hasPlans" class="state-card">
        <EmptyState
          title="还没有总计划"
          description="先写下一个最终成果，例如「三个月通过 N2」。之后再把目标拆成分计划，系统会带你一路走到今天的专注。"
        >
          <SpriteButton @click="router.push('/master-plans/new')">创建第一个总计划</SpriteButton>
          <button
            type="button"
            class="btn btn--ghost"
            :disabled="creatingSample"
            @click="createSample"
          >
            {{ creatingSample ? '正在生成…' : '一键示例' }}
          </button>
        </EmptyState>
      </GlassCard>

      <div v-else class="plan-grid">
        <RouterLink
          v-for="summary in summaries"
          :key="summary.masterPlan.id"
          :to="`/master-plans/${summary.masterPlan.id}`"
          class="plan-link"
        >
          <GlassCard interactive class="plan-card">
            <header class="plan-card__head">
              <div class="plan-card__title">
                <p class="eyebrow">{{ summary.masterPlan.measureDetail || MEASURE_TYPE_LABELS[summary.masterPlan.measureType] }}</p>
                <h2>{{ summary.masterPlan.name }}</h2>
              </div>
              <StatusTag kind="master" :status="summary.status" dot />
            </header>

            <p v-if="summary.masterPlan.description" class="plan-card__desc">
              {{ summary.masterPlan.description }}
            </p>

            <p v-if="summary.overdueSubPlanCount > 0" class="plan-card__warn">
              {{ summary.overdueSubPlanCount }} 个分计划已逾期，建议重新排期。
            </p>

            <div class="plan-card__bottom">
              <ProgressBar
                :value="summary.progress"
                label="整体进度"
                show-value
                :tone="statusTone(summary.status)"
              />

              <footer class="plan-card__foot">
                <span class="numeric">{{ summary.subPlanCount }} 个分计划</span>
                <span>{{ formatCN(summary.masterPlan.deadline) }} 截止</span>
                <span class="numeric">
                  {{ summary.status === 'overdue' ? '已逾期' : `剩 ${remainingDays(summary.masterPlan.deadline)} 天` }}
                </span>
              </footer>
            </div>
          </GlassCard>
        </RouterLink>
      </div>
    </div>

    <button
      type="button"
      class="quick-focus"
      aria-label="快速沉浸：依次选择总计划、分计划和任务"
      @click="cascadeOpen = true"
    >
      <span class="quick-focus__icon" aria-hidden="true">
        <span></span>
      </span>
      <span class="quick-focus__text">
        快速沉浸
        <small>逐级选择任务</small>
      </span>
    </button>

    <TaskCascadeModal v-model="cascadeOpen" />
  </AppShell>
</template>

<style scoped>
.hero-phrase {
  font-family: 'Playfair Display', Georgia, 'Times New Roman', serif;
  font-size: clamp(40px, 6.8vw, 72px);
  font-weight: 500;
  line-height: 1.02;
  letter-spacing: -0.025em;
  background: linear-gradient(
    100deg,
    var(--text-strong) 0%,
    var(--accent) 52%,
    var(--text-primary) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: none;
}

/* 右上角抽屉固定占用 340px 宽，桌面端把「新建总计划」让到抽屉左侧 */
@media (min-width: 900px) {
  .page-head__actions {
    margin-right: 380px;
  }
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

/* Skeleton 与真实卡片保持同一 Grid / 高度，避免 CLS */
.plan-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
  align-items: stretch;
}

.plan-skeleton {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: clamp(20px, 3vw, 28px);
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  overflow: hidden;
}

.plan-skeleton__line,
.plan-skeleton__bar {
  display: block;
  border-radius: var(--radius-pill);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--text-primary) 7%, transparent) 0%,
    color-mix(in srgb, var(--text-primary) 14%, transparent) 50%,
    color-mix(in srgb, var(--text-primary) 7%, transparent) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.45s ease-in-out infinite;
}

.plan-skeleton__line--eyebrow {
  width: 32%;
  height: 9px;
}

.plan-skeleton__line--title {
  width: 68%;
  height: 22px;
}

.plan-skeleton__line--desc {
  width: 92%;
  height: 11px;
}

.plan-skeleton__line--desc.short {
  width: 58%;
}

.plan-skeleton__bar {
  width: 100%;
  height: 7px;
  margin-top: auto;
}

.plan-skeleton__line--foot {
  width: 45%;
  height: 9px;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 120% 0;
  }
  100% {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .plan-skeleton__line,
  .plan-skeleton__bar {
    animation: none;
  }
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
  align-items: stretch;
}

.plan-link {
  display: block;
  height: 100%;
  color: inherit;
  text-decoration: none;
  border-radius: var(--radius-lg);
}

.plan-link .plan-card {
  border: 1px solid var(--glass-border);
  transition:
    transform var(--dur-base) var(--ease-spring),
    box-shadow var(--dur-base) var(--ease-out),
    background-color var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.plan-link:hover .plan-card,
.plan-link:focus-visible .plan-card {
  transform: translateY(-5px);
  background: var(--glass-bg-hover);
  border-color: var(--glass-highlight);
  box-shadow: var(--glass-shadow-hover);
}

.plan-link:focus-visible {
  outline-offset: 4px;
}

.plan-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
  min-height: 220px;
}

.plan-card__bottom {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: auto;
}

.plan-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.plan-card__title h2 {
  margin-top: 4px;
  font-size: 19px;
}

.plan-card__desc {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.plan-card__foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  font-size: 12px;
  color: var(--text-faint);
  padding-top: var(--space-2);
  border-top: 1px solid var(--line-soft);
}

.plan-card__warn {
  font-size: 12px;
  color: var(--danger);
  line-height: 1.6;
}

/* 全局快速沉浸入口 */
.quick-focus {
  position: fixed;
  right: clamp(16px, 3vw, 36px);
  bottom: clamp(18px, 3vw, 32px);
  z-index: 50;
  display: inline-flex;
  align-items: center;
  gap: 11px;
  padding: 10px 18px 10px 11px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  color: var(--text-primary);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
  animation: quick-focus-breathe 3.8s ease-in-out infinite;
  transition:
    transform var(--dur-base) var(--ease-spring),
    box-shadow var(--dur-base) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.quick-focus:hover {
  transform: translateY(-2px) scale(1.02);
  background: var(--glass-bg-hover);
  box-shadow: var(--glass-shadow-hover);
}

.quick-focus__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: linear-gradient(140deg, var(--accent) 0%, var(--accent-strong) 100%);
  box-shadow: 0 0 0 0 var(--accent-soft);
  animation: quick-focus-pulse 2.6s ease-out infinite;
}

.quick-focus__icon span {
  width: 0;
  height: 0;
  margin-left: 3px;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
  border-left: 11px solid var(--accent-contrast);
}

.quick-focus__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}

.quick-focus__text small {
  font-size: 9px;
  font-weight: 500;
  color: var(--text-tertiary);
}

@keyframes quick-focus-breathe {
  0%,
  100% {
    box-shadow: var(--glass-shadow);
  }
  50% {
    box-shadow:
      var(--glass-shadow),
      0 0 28px -8px var(--accent-soft);
  }
}

@keyframes quick-focus-pulse {
  0% {
    box-shadow: 0 0 0 0 var(--accent-soft);
  }
  70% {
    box-shadow: 0 0 0 12px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

@media (max-width: 640px) {
  .quick-focus {
    right: 14px;
    bottom: 14px;
    padding-right: 14px;
  }

  .quick-focus__text small {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .quick-focus,
  .quick-focus__icon {
    animation: none;
  }

  .quick-focus:hover {
    transform: none;
  }
}

@media (max-width: 640px) {
  .plan-grid {
    grid-template-columns: 1fr;
  }
}
</style>
