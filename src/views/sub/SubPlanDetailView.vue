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
import TaskSelectionModal from '@/components/focus/TaskSelectionModal.vue'
import TaskRow from '@/components/plan/TaskRow.vue'
import { useFocusStore } from '@/stores/focus'
import { useSubPlans } from '@/composables/useSubPlans'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useTasks } from '@/composables/useTasks'
import { useToast } from '@/composables/useToast'
import { calcProgress, deriveSubPlanStatus } from '@/engine/progress'
import { addDays, diffDays, formatCNFull, todayISO } from '@/lib/date'
import { MEASURE_STANDARD_LABELS, type MasterPlan, type SubPlan, type Task } from '@/types/models'

/** 分计划详情：按天分组的任务列表 + 重新排期入口 */
const route = useRoute()
const router = useRouter()
const toast = useToast()

const subApi = useSubPlans()
const masterApi = useMasterPlans()
const taskApi = useTasks()
const focusStore = useFocusStore()

const subPlan = ref<SubPlan | null>(null)
const masterPlan = ref<MasterPlan | null>(null)
const tasks = ref<Task[]>([])
const loading = ref(true)
const error = ref('')
const showDeletePlan = ref(false)
const deletingPlan = ref(false)
const taskToDelete = ref<Task | null>(null)
const deletingTask = ref(false)
const isTaskModalOpen = ref(false)
const today = todayISO()

const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

const progress = computed(() => calcProgress(tasks.value))
const pendingTasks = computed(() => tasks.value.filter((task) => task.status !== 'done'))
const ringRadius = 98
const ringCircumference = 2 * Math.PI * ringRadius
const ringOffset = computed(() => ringCircumference * (1 - Math.min(1, Math.max(0, progress.value.progress))))
const status = computed(() =>
  subPlan.value ? deriveSubPlanStatus(progress.value, subPlan.value.deadline, today) : 'active',
)
const remainingDays = computed(() =>
  subPlan.value ? Math.max(0, diffDays(today, subPlan.value.deadline)) : 0,
)

/** 系统自动挑选的下一个任务：未完成里排期最早的（无排期排最后） */
const nextTask = computed<Task | null>(() => {
  const candidates = tasks.value
    .filter((task) => task.status === 'pending' || task.status === 'partial')
    .slice()
    .sort((a, b) => {
      const aDate = a.scheduledDate ?? '9999-12-31'
      const bDate = b.scheduledDate ?? '9999-12-31'
      if (aDate !== bDate) return aDate < bDate ? -1 : 1
      return a.createdAt < b.createdAt ? -1 : 1
    })
  return candidates[0] ?? null
})

const focusHeadline = computed(() => {
  if (nextTask.value) return nextTask.value.name
  return tasks.value.length > 0 ? '这个分计划已经完成' : '还没有可专注的任务'
})

const focusDetail = computed(() => {
  const task = nextTask.value
  if (task) {
    return `预计 ${task.estMinutes} 分钟 · 本次专注 ${task.focusBlock} 分钟 · 衡量标准：${MEASURE_STANDARD_LABELS[task.measureStandard]}`
  }
  return tasks.value.length > 0
    ? '所有任务都完成了，可以重新排期或添加新任务。'
    : '先编辑分计划，添加任务后会自动生成排期。'
})

interface TaskGroup {
  key: string
  label: string
  hint: string
  tasks: Task[]
}

const groups = computed<TaskGroup[]>(() => {
  const buckets: Record<string, Task[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    done: [],
  }

  for (const task of tasks.value) {
    if (task.status === 'done' || task.status === 'skipped') {
      buckets.done?.push(task)
      continue
    }
    if (!task.scheduledDate) {
      buckets.later?.push(task)
      continue
    }
    if (task.scheduledDate < today) buckets.overdue?.push(task)
    else if (task.scheduledDate === today) buckets.today?.push(task)
    else if (task.scheduledDate === addDays(today, 1)) buckets.tomorrow?.push(task)
    else if (task.scheduledDate <= addDays(today, 7)) buckets.week?.push(task)
    else buckets.later?.push(task)
  }

  const definitions: Array<{ key: string; label: string; hint: string }> = [
    { key: 'overdue', label: '已逾期', hint: '这些任务没有按原计划完成，重新排期时会被优先安排。' },
    { key: 'today', label: '今天', hint: '' },
    { key: 'tomorrow', label: '明天', hint: '' },
    { key: 'week', label: '本周', hint: '' },
    { key: 'later', label: '之后', hint: '' },
    { key: 'done', label: '已完成 / 已跳过', hint: '' },
  ]

  return definitions
    .map((definition) => ({
      ...definition,
      tasks: buckets[definition.key] ?? [],
    }))
    .filter((group) => group.tasks.length > 0)
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const plan = await subApi.fetchOne(id.value)
    if (!plan) {
      error.value = subApi.error.value || '分计划不存在，或你没有访问权限。'
      return
    }
    subPlan.value = plan
    masterPlan.value = await masterApi.fetchOne(plan.masterPlanId)
    tasks.value = await taskApi.fetchBySubPlan(plan.id)
    error.value = taskApi.error.value
  } finally {
    loading.value = false
  }
}

function onTaskUpdated(updated: Task): void {
  tasks.value = tasks.value.map((task) => (task.id === updated.id ? updated : task))
  toast.success('任务已更新')
}

function requestDeleteTask(task: Task): void {
  taskToDelete.value = task
}

async function confirmDeleteTask(): Promise<void> {
  if (!taskToDelete.value || deletingTask.value) return
  deletingTask.value = true
  const ok = await taskApi.deleteMany([taskToDelete.value.id])
  deletingTask.value = false
  if (!ok) {
    error.value = taskApi.error.value || '删除任务失败'
    return
  }
  tasks.value = tasks.value.filter((task) => task.id !== taskToDelete.value?.id)
  taskToDelete.value = null
  toast.success('任务已删除')
}

async function confirmDeletePlan(): Promise<void> {
  if (!subPlan.value || deletingPlan.value) return
  deletingPlan.value = true
  const masterId = subPlan.value.masterPlanId
  const ok = await subApi.remove(subPlan.value.id)
  deletingPlan.value = false
  showDeletePlan.value = false
  if (!ok) {
    error.value = subApi.error.value || '删除分计划失败'
    return
  }
  toast.success('分计划已删除')
  await router.replace(`/master-plans/${masterId}`)
}

/**
 * 唯一主操作：先打开任务选择弹窗；用户选中任务后把 taskId 存入 Pinia，
 * 再通过声明式导航进入 /focus。
 */
function openTaskModal(): void {
  if (pendingTasks.value.length === 0) {
    toast.warning('这个分计划暂时没有待做任务')
    return
  }
  isTaskModalOpen.value = true
}

async function onSelectTask(task: Task): Promise<void> {
  focusStore.selectTask(task.id)
  isTaskModalOpen.value = false
  await router.push('/focus')
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <nav class="crumb" aria-label="面包屑">
        <RouterLink to="/">我的总计划</RouterLink>
        <span aria-hidden="true">/</span>
        <RouterLink v-if="masterPlan" :to="`/master-plans/${masterPlan.id}`">
          {{ masterPlan.name }}
        </RouterLink>
        <span aria-hidden="true">/</span>
        <span>{{ subPlan?.name ?? '分计划' }}</span>
      </nav>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在读取…</p>
      </GlassCard>

      <GlassCard v-else-if="error && !subPlan" class="state-card">
        <p class="error-text">{{ error }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/">返回总计划</RouterLink>
      </GlassCard>

      <template v-else-if="subPlan">
        <header class="sub-head">
          <div class="sub-head__text">
            <p class="eyebrow">可执行模块</p>
            <h1>{{ subPlan.name }}</h1>
            <div class="sub-head__meta">
              <StatusTag kind="sub" :status="status" dot />
              <span class="tiny faint">{{ formatCNFull(subPlan.deadline) }} 截止</span>
              <span class="tiny faint">
                {{ status === 'overdue' ? '已逾期' : `剩余 ${remainingDays} 天` }}
              </span>
              <span class="tiny faint numeric">
                {{ progress.doneCount }}/{{ progress.taskCount }} 个任务
              </span>
            </div>
          </div>
          <div class="sub-head__actions">
            <SpriteButton
              variant="primary"
              size="sm"
              class="sub-action sub-action--primary"
              :disabled="pendingTasks.length === 0"
              @click="openTaskModal"
            >
              进入沉浸
            </SpriteButton>
            <RouterLink
              :to="`/sub-plans/${subPlan.id}/calendar`"
              class="btn btn--ghost btn--sm sub-action"
            >
              日历视图
            </RouterLink>
            <button
              type="button"
              class="btn btn--ghost btn--sm sub-action"
              @click="router.push(`/sub-plans/${subPlan.id}/reschedule`)"
            >
              重新排期
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm sub-action"
              @click="router.push(`/sub-plans/${subPlan.id}/edit`)"
            >
              编辑分计划
            </button>
          </div>
        </header>

        <div class="sub-hero">
          <div class="sub-hero__info">
            <GlassCard class="overview">
              <div class="overview__row">
                <div class="overview__progress">
                  <ProgressBar
                    :value="progress.progress"
                    label="分计划进度（已完成时长 / 总时长）"
                    show-value
                    :tone="status === 'completed' ? 'success' : status === 'overdue' ? 'danger' : 'accent'"
                  />
                </div>
                <dl class="overview__stats">
                  <div>
                    <dt>已投入</dt>
                    <dd class="numeric">{{ progress.earnedMinutes }} 分钟</dd>
                  </div>
                  <div>
                    <dt>总时长</dt>
                    <dd class="numeric">{{ progress.totalMinutes }} 分钟</dd>
                  </div>
                  <div>
                    <dt>每日可用</dt>
                    <dd class="numeric">{{ subPlan.weekdayMinutes }} / {{ subPlan.weekendMinutes }}</dd>
                  </div>
                </dl>
              </div>
            </GlassCard>

            <div class="sub-hero__note">
              <div>
                <span>截止日期</span>
                <strong>{{ formatCNFull(subPlan.deadline) }}</strong>
              </div>
              <div>
                <span>剩余时间</span>
                <strong>{{ status === 'overdue' ? '已逾期' : `${remainingDays} 天` }}</strong>
              </div>
              <div>
                <span>缓冲日</span>
                <strong>每周 {{ subPlan.bufferDays }} 天</strong>
              </div>
            </div>
          </div>

          <!-- 右侧大圆盘：系统自动挑选当前任务 -->
          <GlassCard class="focus-cta">
            <div class="focus-cta__copy">
              <p class="eyebrow">下一步</p>
              <h2>{{ focusHeadline }}</h2>
              <p class="tiny muted">{{ focusDetail }}</p>
            </div>
            <div class="focus-orbit">
              <span class="focus-orbit__halo" aria-hidden="true"></span>
              <svg class="focus-orbit__svg" viewBox="0 0 220 220" aria-hidden="true">
                <defs>
                  <linearGradient id="orbit-gradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="var(--accent)" />
                    <stop offset="0.55" stop-color="var(--accent-strong)" />
                    <stop offset="1" stop-color="var(--accent)" />
                  </linearGradient>
                </defs>
                <circle class="focus-orbit__track" cx="110" cy="110" :r="ringRadius" />
                <circle
                  class="focus-orbit__progress"
                  cx="110"
                  cy="110"
                  :r="ringRadius"
                  :stroke-dasharray="ringCircumference"
                  :stroke-dashoffset="ringOffset"
                  transform="rotate(-90 110 110)"
                />
              </svg>
              <div class="focus-orbit__core">
                <span>待做任务</span>
                <strong class="numeric">{{ pendingTasks.length }}</strong>
                <small>从右上角进入沉浸</small>
              </div>
            </div>
            <p class="focus-cta__note tiny faint">
              点击右上角「进入沉浸」选择这次要做的任务；进入后只保留计时。
            </p>
          </GlassCard>
        </div>

        <p v-if="error" class="error-text" role="alert">{{ error }}</p>

        <GlassCard v-if="tasks.length === 0" class="state-card">
          <EmptyState
            compact
            title="这个分计划还没有任务"
            description="编辑分计划，添加可执行的任务后会自动生成排期。"
          >
            <SpriteButton size="sm" @click="router.push(`/sub-plans/${subPlan.id}/edit`)">
              编辑分计划
            </SpriteButton>
          </EmptyState>
        </GlassCard>

        <section v-else class="task-groups">
          <div v-for="group in groups" :key="group.key" class="task-group">
            <header class="task-group__head">
              <h2 class="task-group__title">
                {{ group.label }}
                <span class="task-group__count numeric">{{ group.tasks.length }}</span>
              </h2>
              <p v-if="group.hint" class="tiny faint">{{ group.hint }}</p>
            </header>
            <ul class="task-list">
              <TaskRow
                v-for="task in group.tasks"
                :key="task.id"
                :task="task"
                @updated="onTaskUpdated"
                @request-delete="requestDeleteTask"
              />
            </ul>
          </div>

          <p class="buffer-note">
            缓冲日：每周 {{ subPlan.bufferDays }} 天（不排任务，延误时优先消耗）。
            {{ subPlan.bufferDays === 0 ? '当前没有缓冲，一次延误会导致整体顺延。' : `约合 ${Math.max(1, Math.round((diffDays(today, subPlan.deadline) / 7) * subPlan.bufferDays))} 天缓冲。` }}
          </p>
        </section>

        <div class="foot-actions">
          <RouterLink class="btn btn--ghost btn--sm" :to="`/master-plans/${subPlan.masterPlanId}`">
            返回 {{ masterPlan?.name ?? '总计划' }}
          </RouterLink>
          <div class="foot-actions__right">
            <span class="tiny faint">总计划 → 分计划 → 专注</span>
            <button type="button" class="link-btn foot-actions__delete" @click="showDeletePlan = true">
              删除分计划
            </button>
          </div>
        </div>
      </template>
    </div>

    <TaskSelectionModal
      v-model="isTaskModalOpen"
      :tasks="tasks"
      :title="`选择「${subPlan?.name ?? '分计划'}」的一个任务`"
      subtitle="只显示未完成任务；选中后把 taskId 交给 useFocusStore，再进入沉浸页。"
      @select="onSelectTask"
    />

    <ConfirmDialog
      v-model="showDeletePlan"
      title="删除这个分计划？"
      :description="`「${subPlan?.name ?? ''}」下的 ${tasks.length} 个任务与全部学习记录都会一并删除。`"
      confirm-label="删除"
      danger
      :busy="deletingPlan"
      @confirm="confirmDeletePlan"
    />

    <ConfirmDialog
      :model-value="Boolean(taskToDelete)"
      title="删除这个任务？"
      :description="`「${taskToDelete?.name ?? ''}」及其学习记录会被删除，无法恢复。`"
      confirm-label="删除"
      danger
      :busy="deletingTask"
      @update:model-value="taskToDelete = null"
      @confirm="confirmDeleteTask"
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
  flex-wrap: wrap;
}

.crumb a {
  color: var(--text-muted);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.sub-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-5);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.sub-head__text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  text-shadow: var(--heading-shadow, none);
}

.sub-head__meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: 2px;
}

.sub-head__actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.sub-action {
  min-height: 38px;
}

.sub-action--primary {
  animation: action-pulse 2.8s ease-in-out infinite;
}

@keyframes action-pulse {
  0%,
  100% {
    box-shadow:
      inset 0 1px 0 var(--glass-highlight),
      0 10px 24px -16px var(--accent-strong);
  }
  50% {
    box-shadow:
      inset 0 1px 0 var(--glass-highlight),
      0 0 0 5px var(--accent-soft),
      0 14px 32px -18px var(--accent-strong);
  }
}

/* 非对称主区：左侧信息微雕，右侧大圆盘专注入口 */
.sub-hero {
  display: grid;
  grid-template-columns: minmax(0, 35fr) minmax(0, 65fr);
  align-items: stretch;
  gap: var(--space-4);
  margin-top: var(--space-2);
}

.sub-hero__info {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.overview {
  flex: 1;
  display: flex;
  align-items: center;
}

.overview__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-wrap: wrap;
}

.sub-hero__note {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  padding: 12px 16px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--glass-bg-soft);
  box-shadow: var(--glass-shadow);
}

.sub-hero__note div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sub-hero__note span {
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-tertiary);
}

.sub-hero__note strong {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 巨大的圆形「开始专注」入口 */
.focus-cta {
  position: relative;
  overflow: hidden;
  margin-top: 0;
  padding: clamp(22px, 3vw, 34px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  text-align: center;
}

.focus-cta::before {
  content: '';
  position: absolute;
  top: -140px;
  right: -80px;
  width: 340px;
  height: 340px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft), transparent 68%);
  filter: blur(18px);
  pointer-events: none;
}

.focus-cta > * {
  position: relative;
  z-index: 1;
}

.focus-cta__copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: 34ch;
}

.focus-cta__copy h2 {
  font-size: clamp(20px, 2.6vw, 27px);
  line-height: 1.28;
}

.focus-orbit__core {
  position: relative;
  z-index: 2;
  width: clamp(150px, 12vw, 184px);
  height: clamp(150px, 12vw, 184px);
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(var(--glass-blur-strong));
  backdrop-filter: blur(var(--glass-blur-strong));
}

.focus-orbit__core span {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.focus-orbit__core strong {
  font-size: clamp(36px, 4vw, 48px);
  font-weight: 300;
  line-height: 1;
  color: var(--text-strong);
}

.focus-orbit__core small {
  font-size: 9px;
  color: var(--text-tertiary);
}

.focus-orbit {
  position: relative;
  display: grid;
  place-items: center;
  width: clamp(204px, 17vw, 250px);
  height: clamp(204px, 17vw, 250px);
  margin: clamp(8px, 1.8vw, 18px) auto;
}

.focus-orbit__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  animation: orbit-breathe 4.8s ease-in-out infinite;
}

.focus-orbit__track {
  fill: none;
  stroke: var(--line);
  stroke-width: 1.2;
}

.focus-orbit__progress {
  fill: none;
  stroke: url(#orbit-gradient);
  stroke-width: 2;
  stroke-linecap: round;
  filter: drop-shadow(0 0 6px var(--accent-soft));
  transition: stroke-dashoffset var(--dur-slow) var(--ease-out);
}

.focus-orbit__halo {
  position: absolute;
  inset: 8%;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft) 0%, transparent 68%);
  filter: blur(18px);
  animation: orbit-halo 5.2s ease-in-out infinite;
  pointer-events: none;
}

@keyframes orbit-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.72;
  }
  42% {
    transform: scale(1.05);
    opacity: 1;
  }
  70% {
    transform: scale(1.02);
    opacity: 0.82;
  }
}

@keyframes orbit-halo {
  0%,
  100% {
    transform: scale(0.96);
    opacity: 0.45;
  }
  40% {
    transform: scale(1.05);
    opacity: 0.8;
  }
  72% {
    transform: scale(0.99);
    opacity: 0.55;
  }
}

.focus-cta__note {
  max-width: 32ch;
  line-height: 1.6;
}

@media (max-width: 860px) {
  .sub-hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .focus-cta {
    min-height: 280px;
  }

  .focus-orbit__core {
    width: 140px;
    height: 140px;
  }
}

@media (max-width: 520px) {
  .sub-hero__note {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
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

.task-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin-top: var(--space-6);
}

.task-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.task-group__head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.task-group__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  font-weight: 600;
}

.task-group__count {
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--line-soft);
  color: var(--text-faint);
  font-size: 11px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.buffer-note {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--line);
  background: var(--glass-bg-soft);
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.7;
}

.foot-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-7);
  padding-top: var(--space-5);
  border-top: 1px solid var(--line-soft);
}

.foot-actions__right {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.foot-actions__delete {
  color: var(--danger);
  background: transparent;
  border: 0;
  font-size: 12px;
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  .focus-orbit__svg,
  .focus-orbit__halo {
    animation: none;
  }
}
</style>
