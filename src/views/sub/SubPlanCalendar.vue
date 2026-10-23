<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useSubPlans } from '@/composables/useSubPlans'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useTasks } from '@/composables/useTasks'
import { formatCNFull, todayISO } from '@/lib/date'
import type { MasterPlan, SubPlan, Task } from '@/types/models'

/** 分计划日历：按 scheduled_date 聚合任务，7 列 CSS Grid 月视图 */
const route = useRoute()
const subApi = useSubPlans()
const masterApi = useMasterPlans()
const taskApi = useTasks()

const subPlan = ref<SubPlan | null>(null)
const masterPlan = ref<MasterPlan | null>(null)
const tasks = ref<Task[]>([])
const loading = ref(true)
const error = ref('')
const cursor = ref(startOfMonth(new Date()))
const today = todayISO()

const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

const weekdays = ['日', '一', '二', '三', '四', '五', '六']

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const monthLabel = computed(() =>
  `${cursor.value.getFullYear()} 年 ${cursor.value.getMonth() + 1} 月`,
)

/** reduce: 按 scheduled_date 分组 */
const tasksByDate = computed<Record<string, Task[]>>(() =>
  tasks.value.reduce<Record<string, Task[]>>((groups, task) => {
    if (!task.scheduledDate) return groups
    const list = groups[task.scheduledDate] ?? []
    list.push(task)
    groups[task.scheduledDate] = list
    return groups
  }, {}),
)

const unscheduledTasks = computed(() => tasks.value.filter((task) => !task.scheduledDate))

interface CalendarCell {
  key: string
  date: string
  day: number
  inMonth: boolean
  tasks: Task[]
}

const calendarCells = computed<CalendarCell[]>(() => {
  const year = cursor.value.getFullYear()
  const month = cursor.value.getMonth()
  const leading = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: CalendarCell[] = []

  for (let index = 0; index < leading; index += 1) {
    cells.push({ key: `blank-${index}`, date: '', day: 0, inMonth: false, tasks: [] })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({
      key: date,
      date,
      day,
      inMonth: true,
      tasks: tasksByDate.value[date] ?? [],
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, date: '', day: 0, inMonth: false, tasks: [] })
  }

  return cells
})

const doneCount = computed(() => tasks.value.filter((task) => task.status === 'done').length)

function moveMonth(delta: number): void {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1)
}

function statusClass(task: Task): string {
  if (task.status === 'done') return 'is-done'
  if (task.status === 'partial') return 'is-partial'
  if (task.status === 'skipped') return 'is-skipped'
  return 'is-pending'
}

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
        <RouterLink v-if="subPlan" :to="`/sub-plans/${subPlan.id}`">
          {{ subPlan.name }}
        </RouterLink>
        <span aria-hidden="true">/</span>
        <span>日历视图</span>
      </nav>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在展开日历…</p>
      </GlassCard>

      <GlassCard v-else-if="error && !subPlan" class="state-card">
        <p class="error-text">{{ error }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/">返回总计划</RouterLink>
      </GlassCard>

      <template v-else-if="subPlan">
        <header class="calendar-head">
          <div class="page-head__text">
            <p class="eyebrow">时间分布</p>
            <h1>{{ subPlan.name }} · 日历</h1>
            <p class="muted">
              {{ formatCNFull(subPlan.deadline) }} 截止 · 已完成 {{ doneCount }}/{{ tasks.length }} 个任务
            </p>
          </div>

          <div class="calendar-nav">
            <button type="button" class="calendar-nav__btn" aria-label="上个月" @click="moveMonth(-1)">←</button>
            <span class="calendar-nav__label">{{ monthLabel }}</span>
            <button type="button" class="calendar-nav__btn" aria-label="下个月" @click="moveMonth(1)">→</button>
          </div>
        </header>

        <p v-if="error" class="error-text" role="alert">{{ error }}</p>

        <GlassCard v-if="tasks.length === 0" class="state-card">
          <EmptyState
            compact
            title="还没有任务"
            description="先回到分计划，添加任务后会自动排期到日历。"
          >
            <RouterLink class="btn btn--ghost btn--sm" :to="`/sub-plans/${subPlan.id}`">
              返回分计划
            </RouterLink>
          </EmptyState>
        </GlassCard>

        <template v-else>
          <GlassCard class="calendar-card" :padded="false">
            <div class="calendar-grid" role="grid" aria-label="任务日历">
              <div v-for="weekday in weekdays" :key="weekday" class="calendar-weekday" role="columnheader">
                {{ weekday }}
              </div>

              <div
                v-for="cell in calendarCells"
                :key="cell.key"
                class="calendar-cell"
                :class="{ 'is-empty': !cell.inMonth, 'is-today': cell.date === today }"
                role="gridcell"
              >
                <div v-if="cell.inMonth" class="calendar-cell__head">
                  <span class="calendar-cell__day numeric">{{ cell.day }}</span>
                  <span v-if="cell.tasks.length" class="calendar-cell__count numeric">{{ cell.tasks.length }}</span>
                </div>

                <div v-if="cell.tasks.length" class="calendar-pills">
                  <span
                    v-for="task in cell.tasks"
                    :key="task.id"
                    class="calendar-pill"
                    :class="statusClass(task)"
                    :title="`${task.name} · ${task.estMinutes} 分钟`"
                  >
                    {{ task.name }}
                  </span>
                </div>
              </div>
            </div>
          </GlassCard>

          <section v-if="unscheduledTasks.length" class="unscheduled">
            <div class="section__head">
              <span class="section__title">未排期任务</span>
              <span class="tiny faint">{{ unscheduledTasks.length }} 个</span>
            </div>
            <div class="unscheduled__list">
              <span v-for="task in unscheduledTasks" :key="task.id" class="calendar-pill is-pending">
                {{ task.name }}
              </span>
            </div>
          </section>
        </template>
      </template>
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
  flex-wrap: wrap;
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

.calendar-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.calendar-nav {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
}

.calendar-nav__btn {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.calendar-nav__btn:hover {
  background: var(--glass-bg);
  color: var(--text-primary);
}

.calendar-nav__label {
  min-width: 94px;
  text-align: center;
  font-size: 12px;
  color: var(--text-primary);
}

.calendar-card {
  overflow: hidden;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-top: 1px solid var(--line-soft);
  border-left: 1px solid var(--line-soft);
}

.calendar-weekday {
  padding: 10px 8px;
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-align: center;
  color: var(--text-secondary);
}

.calendar-cell {
  min-height: 106px;
  padding: 7px;
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.calendar-cell:hover:not(.is-empty) {
  background: var(--glass-bg-soft);
}

.calendar-cell.is-empty {
  background: color-mix(in srgb, var(--line-soft) 30%, transparent);
}

.calendar-cell.is-today {
  background: var(--accent-softer);
  box-shadow: inset 0 0 0 1px var(--accent-soft);
}

.calendar-cell__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-bottom: 5px;
}

.calendar-cell__day {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
}

.calendar-cell.is-today .calendar-cell__day {
  color: var(--accent);
  font-weight: 700;
}

.calendar-cell__count {
  font-size: 8px;
  color: var(--text-tertiary);
}

.calendar-pills {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.calendar-pill {
  display: block;
  max-width: 100%;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: 9px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border: 1px solid transparent;
}

.calendar-pill.is-pending {
  background: var(--accent-softer);
  border-color: var(--accent-soft);
  color: var(--accent-strong);
}

.calendar-pill.is-done {
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success) 24%, transparent);
  color: var(--success);
  opacity: 0.8;
}

.calendar-pill.is-partial {
  background: var(--warning-soft);
  border-color: color-mix(in srgb, var(--warning) 24%, transparent);
  color: var(--warning);
}

.calendar-pill.is-skipped {
  background: var(--line-soft);
  color: var(--text-faint);
  text-decoration: line-through;
}

.unscheduled {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-5);
}

.unscheduled__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

@media (max-width: 720px) {
  .calendar-cell {
    min-height: 82px;
    padding: 5px;
  }

  .calendar-pill {
    font-size: 8px;
    padding: 2px 4px;
  }

  .calendar-weekday {
    font-size: 8px;
    padding: 8px 4px;
  }
}
</style>
