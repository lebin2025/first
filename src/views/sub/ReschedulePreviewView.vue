<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import { useSubPlans } from '@/composables/useSubPlans'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useTasks } from '@/composables/useTasks'
import { useStudyLogs } from '@/composables/useStudyLogs'
import { useToast } from '@/composables/useToast'
import {
  buildReschedule,
  summarizeManualSchedule,
  type RescheduleResult,
} from '@/engine/reschedule'
import { formatCN, todayISO, weekdayLabel } from '@/lib/date'
import type { MasterPlan, StudyLog, SubPlan, Task } from '@/types/models'

/**
 * 重排预览与确认。
 * 所有计算都在前端完成；只有点「确认生效」后才把新的 scheduled_date 写回数据库。
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()

const subApi = useSubPlans()
const masterApi = useMasterPlans()
const taskApi = useTasks()
const logApi = useStudyLogs()

const subPlan = ref<SubPlan | null>(null)
const masterPlan = ref<MasterPlan | null>(null)
const tasks = ref<Task[]>([])
const logs = ref<StudyLog[]>([])
const result = ref<RescheduleResult | null>(null)
const loading = ref(true)
const error = ref('')
const confirming = ref(false)
const manual = ref(false)
const assignments = ref<Record<string, string>>({})
const today = todayISO()

const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

const manualDays = computed(() => {
  if (!result.value) return []
  return summarizeManualSchedule(
    result.value.days.map((day) => ({
      date: day.date,
      isBuffer: day.isBuffer,
      capacity: day.capacity,
    })),
    result.value.placements,
    assignments.value,
  )
})

const hasOverload = computed(() => manualDays.value.some((day) => day.overloadMinutes > 0))
const overloadMinutes = computed(() =>
  manualDays.value.reduce((sum, day) => sum + day.overloadMinutes, 0),
)

const scheduledDayCount = computed(
  () => manualDays.value.filter((day) => day.tasks.length > 0).length,
)
const actualDailyAverage = computed(() => {
  if (!result.value || scheduledDayCount.value === 0) return 0
  return Math.round(result.value.remainingMinutes / scheduledDayCount.value)
})

const beforeGroups = computed(() => {
  const groups = new Map<string, { id: string; name: string; minutes: number }[]>()
  for (const task of tasks.value) {
    if (task.status === 'done' || task.status === 'skipped') continue
    const minutes =
      task.status === 'partial'
        ? Math.max(0, task.estMinutes - Math.min(task.actualMinutes, task.estMinutes))
        : task.estMinutes
    const key = task.scheduledDate ?? 'unscheduled'
    const bucket = groups.get(key) ?? []
    bucket.push({ id: task.id, name: task.name, minutes })
    groups.set(key, bucket)
  }
  return [...groups.entries()]
    .map(([date, items]) => ({
      date,
      label: date === 'unscheduled' ? '未排期' : `${formatCN(date)} ${weekdayLabel(date)}`,
      minutes: items.reduce((sum, item) => sum + item.minutes, 0),
      tasks: items,
    }))
    .sort((a, b) => {
      if (a.date === 'unscheduled') return 1
      if (b.date === 'unscheduled') return -1
      return a.date < b.date ? -1 : 1
    })
})

const afterGroups = computed(() =>
  manualDays.value
    .filter((day) => day.tasks.length > 0)
    .map((day) => ({
      date: day.date,
      label: `${formatCN(day.date)} ${weekdayLabel(day.date)}`,
      isBuffer: day.isBuffer,
      usedMinutes: day.usedMinutes,
      capacity: day.capacity,
      overloadMinutes: day.overloadMinutes,
      tasks: day.tasks,
    })),
)

const changeStats = computed(() => {
  const placements = result.value?.placements ?? []
  return {
    added: placements.filter((item) => item.change === 'added').length,
    postponed: placements.filter((item) => item.change === 'postponed').length,
    advanced: placements.filter((item) => item.change === 'advanced').length,
    unchanged: placements.filter((item) => item.change === 'unchanged').length,
  }
})

const dateOptions = computed(() => (result.value?.days ?? []).filter((day) => !day.isBuffer))

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
    logs.value = await logApi.fetchRecent(7)

    if (taskApi.error.value || logApi.error.value) {
      error.value = taskApi.error.value || logApi.error.value
    }

    result.value = buildReschedule({
      today,
      deadline: plan.deadline,
      subPlanName: plan.name,
      weekdayMinutes: plan.weekdayMinutes,
      weekendMinutes: plan.weekendMinutes,
      bufferDays: plan.bufferDays,
      tasks: tasks.value.map((task) => ({
        id: task.id,
        name: task.name,
        estMinutes: task.estMinutes,
        actualMinutes: task.actualMinutes,
        status: task.status,
        scheduledDate: task.scheduledDate,
      })),
      logs: logs.value.map((log) => ({
        plannedMinutes: log.plannedMinutes,
        actualMinutes: log.actualMinutes,
        loggedAt: log.loggedAt,
        status: log.status,
      })),
    })

    assignments.value = Object.fromEntries(
      result.value.placements.map((placement) => [placement.id, placement.newDate]),
    )
  } finally {
    loading.value = false
  }
}

async function confirm(): Promise<void> {
  if (!result.value || !subPlan.value || confirming.value || !result.value.feasible) return
  confirming.value = true
  error.value = ''

  const updates = Object.entries(assignments.value)
    .map(([taskId, date]) => {
      const original = tasks.value.find((task) => task.id === taskId)
      return { id: taskId, scheduledDate: date, original: original?.scheduledDate ?? null }
    })
    .filter((item) => item.scheduledDate !== item.original)
    .map(({ id: taskId, scheduledDate }) => ({ id: taskId, scheduledDate }))

  if (updates.length === 0) {
    confirming.value = false
    toast.push('没有需要变更的任务')
    await router.replace(`/sub-plans/${subPlan.value.id}`)
    return
  }

  const ok = await taskApi.updateSchedule(updates)
  confirming.value = false
  if (!ok) {
    error.value = taskApi.error.value || '写回排期失败，请重试。'
    return
  }
  toast.success(`已更新 ${updates.length} 个任务的排期`)
  await router.replace(`/sub-plans/${subPlan.value.id}`)
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
        <RouterLink v-if="subPlan" :to="`/sub-plans/${subPlan.id}`">{{ subPlan.name }}</RouterLink>
        <span aria-hidden="true">/</span>
        <span>重新排期</span>
      </nav>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在计算新排期…</p>
      </GlassCard>

      <GlassCard v-else-if="error && !result" class="state-card">
        <p class="error-text">{{ error }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/">返回</RouterLink>
      </GlassCard>

      <template v-else-if="result && subPlan">
        <header class="page-head">
          <div class="page-head__text">
            <p class="eyebrow">重排预览 · 仅作用于本分计划</p>
            <h1>重新安排「{{ subPlan.name }}」</h1>
            <p class="muted reschedule-reason">
              分计划：{{ subPlan.name }}。{{ result.reason }}。
            </p>
          </div>
          <div class="page-head__actions">
            <button type="button" class="btn btn--ghost btn--sm" @click="manual = !manual">
              {{ manual ? '结束微调' : '手动微调' }}
            </button>
          </div>
        </header>

        <p v-if="!result.feasible" class="banner banner--danger" role="alert">
          <strong>剩余天数不足。</strong>{{ result.gapReason }}
          <RouterLink :to="`/sub-plans/${subPlan.id}/edit`">去编辑分计划</RouterLink>
        </p>

        <p v-else-if="result.delayedTaskCount > 0" class="banner banner--info">
          <strong>{{ result.delayedTaskCount }} 个任务延误（{{ result.delayedMinutes }} 分钟）。</strong>
          已优先消耗 {{ result.bufferDaysUsed }} 天缓冲，剩余 {{ result.bufferDaysReserved }} 天缓冲继续保持空白。
        </p>

        <section class="summary-grid">
          <GlassCard class="summary-card">
            <p class="section__title">剩余总时长</p>
            <p class="summary-card__value numeric">{{ result.remainingMinutes }} <small>分钟</small></p>
            <p class="tiny faint">{{ result.remainingTaskCount }} 个待完成 / 部分完成任务</p>
          </GlassCard>
          <GlassCard class="summary-card">
            <p class="section__title">剩余天数</p>
            <p class="summary-card__value numeric">{{ result.remainingDays }} <small>天</small></p>
            <p class="tiny faint">可排期 {{ result.effectiveDays }} 天 · 缓冲 {{ result.bufferDaysReserved }} 天</p>
          </GlassCard>
          <GlassCard class="summary-card">
            <p class="section__title">新每日均值</p>
            <p class="summary-card__value numeric">{{ result.dailyQuota }} <small>分钟</small></p>
            <p class="tiny faint">公式参考：剩余 {{ result.remainingMinutes }} ÷ {{ result.effectiveDays }} 天 ÷ 效率 {{ result.efficiency.coefficient }}</p>
            <p class="tiny faint">
              实际排布在 {{ scheduledDayCount }} 天，日均约 {{ actualDailyAverage }} 分钟
            </p>
          </GlassCard>
          <GlassCard class="summary-card">
            <p class="section__title">个人效率系数</p>
            <p class="summary-card__value numeric">{{ result.efficiency.coefficient.toFixed(2) }}</p>
            <p class="tiny faint">
              {{
                result.efficiency.isDefault
                  ? `近 7 天有效记录 ${result.efficiency.sampleCount} 条，不足 3 条按 1.0 计算`
                  : `近 7 天 ${result.efficiency.sampleCount} 条记录：${result.efficiency.actualTotal}/${result.efficiency.plannedTotal} 分钟`
              }}
            </p>
          </GlassCard>
        </section>

        <div class="legend" aria-label="差异图例">
          <span class="legend__item"><i class="legend__dot legend__dot--added"></i>新增</span>
          <span class="legend__item"><i class="legend__dot legend__dot--postponed"></i>顺延</span>
          <span class="legend__item"><i class="legend__dot legend__dot--advanced"></i>提前</span>
          <span class="legend__item"><i class="legend__dot legend__dot--buffer"></i>缓冲日</span>
          <span class="legend__count tiny faint">
            新增 {{ changeStats.added }} · 顺延 {{ changeStats.postponed }} · 提前 {{ changeStats.advanced }} ·
            不变 {{ changeStats.unchanged }}
          </span>
        </div>

        <div class="compare">
          <!-- 变更前 -->
          <GlassCard class="compare__card">
            <div class="compare__head">
              <div>
                <p class="eyebrow">变更前</p>
                <h2>原每日分配</h2>
              </div>
              <span class="tiny faint">当前数据库排期</span>
            </div>
            <ul v-if="beforeGroups.length" class="compare__list">
              <li v-for="group in beforeGroups" :key="group.date" class="day-block">
                <div class="day-block__head">
                  <span class="day-block__date">{{ group.label }}</span>
                  <span class="tiny faint numeric">{{ group.minutes }} 分钟</span>
                </div>
                <ul class="day-tasks">
                  <li v-for="item in group.tasks" :key="item.id" class="day-task">
                    <span class="day-task__name">{{ item.name }}</span>
                    <span class="tiny faint numeric">{{ item.minutes }}′</span>
                  </li>
                </ul>
              </li>
            </ul>
            <p v-else class="tiny faint">没有待安排的任务。</p>
          </GlassCard>

          <!-- 变更后 -->
          <GlassCard class="compare__card compare__card--after">
            <div class="compare__head">
              <div>
                <p class="eyebrow">变更后</p>
                <h2>新每日分配</h2>
              </div>
              <span class="tiny faint">确认前不会写回数据库</span>
            </div>

            <div v-if="manual" class="manual-hint tiny faint">
              手动微调：调整任务所在日期，超载会实时提示。
            </div>

            <ul v-if="afterGroups.length" class="compare__list">
              <li v-for="day in afterGroups" :key="day.date" class="day-block">
                <div class="day-block__head">
                  <span class="day-block__date">{{ day.label }}</span>
                  <span class="tiny faint numeric">
                    {{ day.usedMinutes }} / {{ day.capacity }} 分钟
                  </span>
                </div>
                <p v-if="day.overloadMinutes > 0" class="overload">该日已超载 {{ day.overloadMinutes }} 分钟</p>
                <ul class="day-tasks">
                  <li
                    v-for="item in day.tasks"
                    :key="item.id"
                    class="day-task"
                    :class="`day-task--${item.change}`"
                  >
                    <span class="day-task__name">{{ item.name }}</span>
                    <template v-if="manual">
                      <select
                        v-model="assignments[item.id]"
                        class="select day-task__select"
                        aria-label="调整任务日期"
                      >
                        <option v-for="option in dateOptions" :key="option.date" :value="option.date">
                          {{ formatCN(option.date) }}{{ option.isBuffer ? '（缓冲）' : '' }}
                        </option>
                      </select>
                    </template>
                    <span v-else class="day-task__change">
                      <span v-if="item.change === 'added'" class="tag tag--active">新增</span>
                      <span v-else-if="item.change === 'postponed'" class="tag tag--partial">
                        顺延 {{ item.oldDate ? formatCN(item.oldDate) : '' }}
                      </span>
                      <span v-else-if="item.change === 'advanced'" class="tag tag--completed">提前</span>
                      <span v-else class="tiny faint numeric">{{ item.minutes }}′</span>
                    </span>
                  </li>
                </ul>
              </li>
            </ul>
            <p v-else class="tiny faint">没有需要安排的任务。</p>

            <div v-if="result.days.some((day) => day.isBuffer)" class="buffer-days">
              缓冲日 {{ result.days.filter((day) => day.isBuffer).length }} 天：
              {{ result.days.filter((day) => day.isBuffer).map((day) => formatCN(day.date)).join('、') }}
            </div>

            <p v-if="result.unplaced.length" class="overload">
              有 {{ result.unplaced.length }} 个任务仍排不进剩余天数，共 {{ result.gapMinutes }} 分钟。
            </p>
          </GlassCard>
        </div>

        <p v-if="hasOverload" class="banner banner--warning" role="status">
          手动调整后有 {{ overloadMinutes }} 分钟超载。仍可生效，但建议把任务移到更空的日子。
        </p>

        <p v-if="error" class="error-text" role="alert">{{ error }}</p>

        <div class="actions">
          <SpriteButton :disabled="!result.feasible || confirming" :loading="confirming" @click="confirm">
            确认生效
          </SpriteButton>
          <button type="button" class="btn btn--ghost" @click="manual = !manual">
            {{ manual ? '取消微调' : '手动微调' }}
          </button>
          <RouterLink class="btn btn--ghost" :to="`/sub-plans/${subPlan.id}`">取消</RouterLink>
          <span class="tiny faint">确认后会覆盖本分计划的排期，其他分计划不受影响。</span>
        </div>
      </template>
    </div>
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

.reschedule-reason {
  max-width: 760px;
  line-height: 1.7;
}

.banner {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  line-height: 1.7;
  margin-bottom: var(--space-4);
}

.banner strong {
  font-weight: 620;
}

.banner a {
  margin-left: 6px;
  font-weight: 560;
}

.banner--danger {
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 28%, transparent);
}

.banner--info {
  color: var(--info);
  background: var(--info-soft);
  border: 1px solid color-mix(in srgb, var(--info) 24%, transparent);
}

.banner--warning {
  color: var(--warning);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 26%, transparent);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.summary-card {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-card__value {
  font-size: 26px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: -0.02em;
}

.summary-card__value small {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-faint);
}

.legend {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.legend__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.legend__dot--added {
  background: var(--accent);
}

.legend__dot--postponed {
  background: var(--warning);
}

.legend__dot--advanced {
  background: var(--success);
}

.legend__dot--buffer {
  background: var(--text-faint);
}

.legend__count {
  margin-left: auto;
}

.compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  align-items: start;
}

.compare__card {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.compare__card--after {
  background: var(--glass-bg-strong);
}

.compare__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.compare__head h2 {
  margin-top: 4px;
  font-size: 18px;
}

.compare__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-height: 560px;
  overflow-y: auto;
  padding-right: 4px;
}

.day-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.day-block__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--line-soft);
}

.day-block__date {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.day-tasks {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.day-task {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 6px 10px;
  border-radius: var(--radius-xs);
  background: var(--glass-bg-soft);
  font-size: 12px;
}

.day-task__name {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.day-task--added {
  box-shadow: inset 2px 0 0 var(--accent);
}

.day-task--postponed {
  box-shadow: inset 2px 0 0 var(--warning);
}

.day-task--advanced {
  box-shadow: inset 2px 0 0 var(--success);
}

.day-task__change {
  flex: 0 0 auto;
}

.day-task__select {
  min-height: 30px;
  width: 132px;
  font-size: 11px;
  padding: 3px 24px 3px 8px;
}

.manual-hint {
  padding: 8px 10px;
  border-radius: var(--radius-xs);
  background: var(--accent-softer);
  color: var(--accent-strong);
}

.overload {
  font-size: 11px;
  color: var(--danger);
}

.buffer-days {
  padding-top: var(--space-3);
  border-top: 1px dashed var(--line);
  font-size: 11px;
  color: var(--text-faint);
  line-height: 1.7;
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-5);
  padding-top: var(--space-5);
  border-top: 1px solid var(--line-soft);
}

@media (max-width: 860px) {
  .compare {
    grid-template-columns: 1fr;
  }

  .compare__list {
    max-height: none;
  }
}
</style>
