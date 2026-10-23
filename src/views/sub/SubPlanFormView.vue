<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useSubPlans } from '@/composables/useSubPlans'
import { useTasks } from '@/composables/useTasks'
import { useToast } from '@/composables/useToast'
import { useSettingsStore } from '@/stores/settings'
import { diagnoseSubPlan } from '@/engine/diagnostics'
import {
  appendNewTasks,
  buildInitialSchedule,
  collectAssignments,
  type ScheduleWindow,
} from '@/engine/schedule'
import { addDays, formatCN, isValidISODate, todayISO } from '@/lib/date'
import {
  MEASURE_STANDARD_OPTIONS,
  type MasterPlan,
  type MeasureStandard,
  type SubPlan,
  type TaskStatus,
} from '@/types/models'

/**
 * 分计划创建 / 编辑（核心表单）。
 * 区块 A：归属与目标信息；区块 B：任务拆解。
 * 保存时在前端完成「初始排期」，再把 scheduled_date 一起写入数据库。
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const masterApi = useMasterPlans()
const subApi = useSubPlans()
const taskApi = useTasks()
const settings = useSettingsStore()

const today = todayISO()
const isEdit = computed(() => route.name === 'sub-plan-edit')
const routeMasterId = computed(() =>
  typeof route.params.masterId === 'string' ? route.params.masterId : '',
)
const routeSubId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

interface TaskDraftRow {
  key: string
  id?: string
  name: string
  estMinutes: number
  measureStandard: MeasureStandard
  focusBlock: number
  status: TaskStatus
  actualMinutes: number
  scheduledDate: string | null
}

const masterPlan = ref<MasterPlan | null>(null)
const subPlan = ref<SubPlan | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notFound = ref(false)
const originalTaskIds = ref<string[]>([])

let keySeed = 0
function newKey(): string {
  keySeed += 1
  return `draft-${keySeed}`
}

function createRow(): TaskDraftRow {
  return {
    key: newKey(),
    name: '',
    estMinutes: 25,
    measureStandard: 'recall',
    focusBlock: settings.defaultFocusBlock,
    status: 'pending',
    actualMinutes: 0,
    scheduledDate: null,
  }
}

const form = reactive({
  name: '',
  deadline: '',
  weekdayMinutes: 60,
  weekendMinutes: 90,
  bufferDays: 1,
})

const rows = ref<TaskDraftRow[]>([])

const namedRows = computed(() => rows.value.filter((row) => row.name.trim().length > 0))
const totalMinutes = computed(() =>
  namedRows.value.reduce((sum, row) => sum + Math.max(0, Number(row.estMinutes) || 0), 0),
)

const report = computed(() =>
  diagnoseSubPlan({
    deadline: form.deadline,
    weekdayMinutes: Number(form.weekdayMinutes) || 0,
    weekendMinutes: Number(form.weekendMinutes) || 0,
    bufferDays: Number(form.bufferDays) || 0,
    tasks: namedRows.value.map((row) => ({
      name: row.name,
      estMinutes: Math.max(0, Number(row.estMinutes) || 0),
      measureStandard: row.measureStandard,
      focusBlock: Math.max(1, Number(row.focusBlock) || 25),
    })),
    masterDeadline: masterPlan.value?.deadline ?? '',
    masterName: masterPlan.value?.name ?? '',
    today,
  }),
)

const nameError = computed(() => (form.name.trim() ? '' : '分计划名称不能为空'))
const tasksError = computed(() => (namedRows.value.length > 0 ? '' : '至少添加一个任务'))
const durationError = computed(() =>
  namedRows.value.some((row) => Number(row.estMinutes) < 1) ? '任务预计时长至少 1 分钟' : '',
)
const availabilityError = computed(() =>
  Number(form.weekdayMinutes) + Number(form.weekendMinutes) > 0
    ? ''
    : '工作日与周末的可用时间不能同时为 0',
)
const canSave = computed(
  () =>
    !report.value.hasBlocking &&
    !nameError.value &&
    !tasksError.value &&
    !durationError.value &&
    !availabilityError.value &&
    isValidISODate(form.deadline) &&
    !saving.value,
)

function buildWindow(): ScheduleWindow {
  return {
    start: today,
    deadline: form.deadline,
    weekdayMinutes: Math.max(0, Number(form.weekdayMinutes) || 0),
    weekendMinutes: Math.max(0, Number(form.weekendMinutes) || 0),
    bufferDays: Number(form.bufferDays) || 0,
  }
}

function addRow(): void {
  rows.value = [...rows.value, createRow()]
}

function removeRow(key: string): void {
  rows.value = rows.value.filter((row) => row.key !== key)
}

function splitTask(rowKey: string, parts: number): void {
  const index = rows.value.findIndex((row) => row.key === rowKey)
  const row = rows.value[index]
  if (!row) return
  if (row.status === 'done') {
    toast.warning('已完成的任务无需拆分')
    return
  }
  const count = Math.max(2, Math.min(8, Math.round(parts)))
  const baseName = row.name.replace(/（\d+\/\d+）$/, '').trim() || '任务'
  const per = Math.max(1, Math.ceil(row.estMinutes / count))
  const replacement = Array.from({ length: count }, (_, partIndex) => ({
    ...row,
    key: newKey(),
    id: undefined,
    name: `${baseName}（${partIndex + 1}/${count}）`,
    estMinutes: per,
    status: 'pending' as TaskStatus,
    actualMinutes: 0,
    scheduledDate: null,
  }))
  rows.value.splice(index, 1, ...replacement)
  toast.push(`已拆成 ${count} 个任务`)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  notFound.value = false
  try {
    let masterId = routeMasterId.value

    if (isEdit.value) {
      const loaded = await subApi.fetchOne(routeSubId.value)
      if (!loaded) {
        notFound.value = true
        error.value = subApi.error.value || '分计划不存在，或你没有访问权限。'
        return
      }
      subPlan.value = loaded
      masterId = loaded.masterPlanId
      form.name = loaded.name
      form.deadline = loaded.deadline
      form.weekdayMinutes = loaded.weekdayMinutes
      form.weekendMinutes = loaded.weekendMinutes
      form.bufferDays = loaded.bufferDays

      const existingTasks = await taskApi.fetchBySubPlan(loaded.id)
      rows.value = existingTasks.map((task) => ({
        key: task.id,
        id: task.id,
        name: task.name,
        estMinutes: task.estMinutes,
        measureStandard: task.measureStandard,
        focusBlock: task.focusBlock,
        status: task.status,
        actualMinutes: task.actualMinutes,
        scheduledDate: task.scheduledDate,
      }))
      originalTaskIds.value = existingTasks.map((task) => task.id)
    }

    if (!masterId) {
      notFound.value = true
      error.value = '缺少所属总计划，请从总计划详情页进入。'
      return
    }

    const master = await masterApi.fetchOne(masterId)
    if (!master) {
      notFound.value = true
      error.value = masterApi.error.value || '所属总计划不存在。'
      return
    }
    masterPlan.value = master

    if (!isEdit.value) {
      const suggested = addDays(today, 30)
      form.deadline = suggested < master.deadline ? suggested : master.deadline
      form.weekdayMinutes = 60
      form.weekendMinutes = 90
      form.bufferDays = 1
      rows.value = [createRow(), createRow()]
    }
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (!canSave.value || !masterPlan.value) return
  saving.value = true
  error.value = ''

  const validRows = rows.value.filter((row) => row.name.trim().length > 0)
  const windowOptions = buildWindow()

  try {
    if (isEdit.value && subPlan.value) {
      const updated = await subApi.update(subPlan.value.id, {
        masterPlanId: subPlan.value.masterPlanId,
        name: form.name.trim(),
        deadline: form.deadline,
        weekdayMinutes: Number(form.weekdayMinutes),
        weekendMinutes: Number(form.weekendMinutes),
        bufferDays: Number(form.bufferDays),
      })
      if (!updated) {
        error.value = subApi.error.value || '保存失败'
        return
      }

      // 删除被移除的任务
      const keptIds = new Set(validRows.map((row) => row.id).filter((id): id is string => Boolean(id)))
      const removedIds = originalTaskIds.value.filter((id) => !keptIds.has(id))
      if (removedIds.length > 0) {
        const removed = await taskApi.deleteMany(removedIds)
        if (!removed) {
          error.value = taskApi.error.value || '删除任务失败'
          return
        }
      }

      // 更新保留的任务（不改动已有排期）
      for (const row of validRows) {
        if (!row.id) continue
        const savedTask = await taskApi.updateTask(row.id, {
          name: row.name.trim(),
          estMinutes: Number(row.estMinutes),
          measureStandard: row.measureStandard,
          focusBlock: Number(row.focusBlock),
        })
        if (!savedTask) {
          error.value = taskApi.error.value || '更新任务失败'
          return
        }
      }

      // 新增任务：占用剩余容量，不悄悄重排旧任务
      const newRows = validRows.filter((row) => !row.id)
      if (newRows.length > 0) {
        const existing = validRows
          .filter((row) => row.id && row.scheduledDate)
          .map((row) => ({
            scheduledDate: row.scheduledDate,
            estMinutes: Math.max(0, Number(row.estMinutes) || 0),
          }))
        const appended = appendNewTasks(
          existing,
          newRows.map((row) => ({
            id: row.key,
            name: row.name,
            estMinutes: Math.max(1, Number(row.estMinutes) || 1),
            oldDate: null,
          })),
          windowOptions,
        )
        const assignments = collectAssignments(appended.days)
        const created = await taskApi.createMany(
          updated.id,
          newRows.map((row) => ({
            name: row.name.trim(),
            estMinutes: Math.max(1, Number(row.estMinutes) || 1),
            measureStandard: row.measureStandard,
            focusBlock: Number(row.focusBlock),
            scheduledDate: assignments.get(row.key) ?? form.deadline,
          })),
        )
        if (created.length !== newRows.length) {
          error.value = taskApi.error.value || '新增任务失败'
          return
        }
      }

      toast.success('分计划已更新')
      await router.replace(`/sub-plans/${updated.id}`)
      return
    }

    /* 新建：先建分计划，再生成初始排期并批量插入任务 */
    const created = await subApi.create({
      masterPlanId: masterPlan.value.id,
      name: form.name.trim(),
      deadline: form.deadline,
      weekdayMinutes: Number(form.weekdayMinutes),
      weekendMinutes: Number(form.weekendMinutes),
      bufferDays: Number(form.bufferDays),
    })
    if (!created) {
      error.value = subApi.error.value || '创建分计划失败'
      return
    }

    const drafts = validRows.map((row) => ({
      id: row.key,
      name: row.name,
      estMinutes: Math.max(1, Number(row.estMinutes) || 1),
      oldDate: null,
    }))
    const schedule = buildInitialSchedule(drafts, windowOptions)
    const assignments = collectAssignments(schedule.days)

    const createdTasks = await taskApi.createMany(
      created.id,
      validRows.map((row) => ({
        name: row.name.trim(),
        estMinutes: Math.max(1, Number(row.estMinutes) || 1),
        measureStandard: row.measureStandard,
        focusBlock: Number(row.focusBlock),
        scheduledDate: assignments.get(row.key) ?? form.deadline,
      })),
    )

    if (createdTasks.length !== validRows.length) {
      // 补偿：任务写入失败时删除刚建的分计划，避免留下空壳
      await subApi.remove(created.id)
      error.value = taskApi.error.value || '任务创建失败，已回滚分计划'
      return
    }

    if (!schedule.feasible) {
      toast.warning('任务量超出可排期范围，已尽量安排，建议重新排期')
    }
    toast.success('分计划已创建并完成初始排期')
    await router.replace(`/sub-plans/${created.id}`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败'
  } finally {
    saving.value = false
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
        <span>{{ isEdit ? '编辑分计划' : '新建分计划' }}</span>
      </nav>

      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">可执行模块</p>
          <h1>{{ isEdit ? '编辑分计划' : '新建分计划' }}</h1>
          <p class="muted">
            分计划负责排每日任务。填写右侧信息时，诊断会实时计算可行性与风险。
          </p>
        </div>
      </header>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在读取…</p>
      </GlassCard>

      <GlassCard v-else-if="notFound" class="state-card">
        <p class="error-text">{{ error }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/">返回总计划列表</RouterLink>
      </GlassCard>

      <form v-else class="editor" novalidate @submit.prevent="save">
        <div class="editor__main">
          <!-- 区块 A -->
          <GlassCard class="form-card">
            <div class="section__head">
              <span class="section__title">A · 归属与目标</span>
              <span v-if="masterPlan" class="tiny faint">
                总计划截止 {{ formatCN(masterPlan.deadline) }}
              </span>
            </div>

            <div class="form-grid">
              <div class="field form-grid--full">
                <span class="field__label">所属总计划</span>
                <div class="locked-field">
                  <span class="locked-field__name">{{ masterPlan?.name ?? '—' }}</span>
                  <span class="tiny faint">分计划必须归属一个总计划</span>
                </div>
              </div>

              <div class="field form-grid--full">
                <label class="field__label" for="sub-name">分计划名称</label>
                <input
                  id="sub-name"
                  v-model="form.name"
                  class="input"
                  type="text"
                  maxlength="80"
                  placeholder="例如：N2 词汇"
                  :aria-invalid="Boolean(nameError)"
                  required
                />
                <span v-if="nameError" class="field__error">{{ nameError }}</span>
              </div>

              <div class="field">
                <label class="field__label" for="sub-deadline">截止日期</label>
                <input
                  id="sub-deadline"
                  v-model="form.deadline"
                  class="input"
                  type="date"
                  :min="today"
                  :max="masterPlan?.deadline"
                  required
                />
                <span class="field__hint">不能晚于总计划截止日期。</span>
              </div>

              <div class="field">
                <label class="field__label" for="sub-buffer">每周缓冲日</label>
                <select id="sub-buffer" v-model.number="form.bufferDays" class="select">
                  <option :value="0">0 天</option>
                  <option :value="1">1 天（推荐）</option>
                  <option :value="2">2 天</option>
                </select>
                <span class="field__hint">延误时优先消耗缓冲日。</span>
              </div>

              <div class="field">
                <label class="field__label" for="sub-weekday">工作日每日可用（分钟）</label>
                <input
                  id="sub-weekday"
                  v-model.number="form.weekdayMinutes"
                  class="input numeric"
                  type="number"
                  min="0"
                  max="720"
                  step="5"
                />
              </div>

              <div class="field">
                <label class="field__label" for="sub-weekend">周末每日可用（分钟）</label>
                <input
                  id="sub-weekend"
                  v-model.number="form.weekendMinutes"
                  class="input numeric"
                  type="number"
                  min="0"
                  max="720"
                  step="5"
                />
              </div>
            </div>
            <p v-if="availabilityError" class="field__error">{{ availabilityError }}</p>
          </GlassCard>

          <!-- 区块 B -->
          <GlassCard class="form-card">
            <div class="section__head">
              <span class="section__title">B · 任务拆解</span>
              <span class="tiny faint">
                {{ namedRows.length }} 个任务 · 共 {{ totalMinutes }} 分钟
              </span>
            </div>

            <div class="task-list">
              <div class="task-editor__head" aria-hidden="true">
                <span>#</span>
                <span>任务名</span>
                <span>预计时长</span>
                <span>衡量标准</span>
                <span>专注块</span>
                <span></span>
              </div>

              <div v-for="(row, index) in rows" :key="row.key" class="task-editor">
                <span class="task-editor__index numeric">{{ index + 1 }}</span>
                <div class="field task-editor__name">
                  <label class="sr-only" :for="`task-name-${row.key}`">任务名</label>
                  <input
                    :id="`task-name-${row.key}`"
                    v-model="row.name"
                    class="input"
                    type="text"
                    maxlength="120"
                    placeholder="例如：N2 核心词汇 Unit 1（120 词）"
                  />
                </div>
                <div class="field">
                  <label class="sr-only" :for="`task-min-${row.key}`">预计时长（分钟）</label>
                  <input
                    :id="`task-min-${row.key}`"
                    v-model.number="row.estMinutes"
                    class="input numeric"
                    type="number"
                    min="1"
                    max="1440"
                  />
                </div>
                <div class="field">
                  <label class="sr-only" :for="`task-measure-${row.key}`">衡量标准</label>
                  <select :id="`task-measure-${row.key}`" v-model="row.measureStandard" class="select">
                    <option v-for="option in MEASURE_STANDARD_OPTIONS" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </div>
                <div class="field">
                  <label class="sr-only" :for="`task-block-${row.key}`">单次专注块</label>
                  <select :id="`task-block-${row.key}`" v-model.number="row.focusBlock" class="select">
                    <option :value="15">15 分钟</option>
                    <option :value="25">25 分钟</option>
                    <option :value="45">45 分钟</option>
                  </select>
                </div>
                <div class="task-editor__actions">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="删除这一行"
                    @click="removeRow(row.key)"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <button type="button" class="btn btn--ghost btn--sm add-row" @click="addRow">+ 添加任务</button>

            <p v-if="durationError" class="field__error">{{ durationError }}</p>
            <p v-else-if="tasksError" class="field__error">{{ tasksError }}</p>
          </GlassCard>

          <p v-if="error" class="error-text" role="alert">{{ error }}</p>

          <div class="editor__actions">
            <SpriteButton type="submit" :disabled="!canSave" :loading="saving">
              {{ isEdit ? '保存修改' : '保存并排期' }}
            </SpriteButton>
            <RouterLink
              class="btn btn--ghost"
              :to="isEdit && subPlan ? `/sub-plans/${subPlan.id}` : masterPlan ? `/master-plans/${masterPlan.id}` : '/'"
            >
              取消
            </RouterLink>
            <span v-if="report.hasBlocking" class="tiny faint">阻断项未清零，保存已禁用。</span>
          </div>
        </div>
      </form>
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

.editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.editor__main {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.form-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.locked-field {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  background: var(--glass-bg-soft);
  border: 1px solid var(--line-soft);
}

.locked-field__name {
  font-size: 14px;
  font-weight: 560;
  color: var(--text-strong);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-editor__head,
.task-editor {
  display: grid;
  grid-template-columns: 26px minmax(180px, 2.2fr) minmax(90px, 0.8fr) minmax(110px, 1fr) minmax(100px, 0.8fr) 72px;
  gap: 8px;
  align-items: center;
}

.task-editor__head {
  padding: 0 4px;
  font-size: 11px;
  color: var(--text-faint);
}

.task-editor {
  padding: 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: var(--glass-bg-soft);
  animation: row-in var(--dur-base) var(--ease-out);
}

.task-editor .input,
.task-editor .select {
  min-height: 38px;
  font-size: 13px;
  padding: 6px 10px;
}

.task-editor__index {
  font-size: 11px;
  color: var(--text-faint);
  text-align: center;
}

.task-editor__name {
  min-width: 0;
}

.task-editor__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-faint);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.icon-btn:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.add-row {
  align-self: flex-start;
}

.editor__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

@keyframes row-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1080px) {
  .editor {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 820px) {
  .task-editor__head {
    display: none;
  }

  .task-editor {
    grid-template-columns: 1fr 1fr;
  }

  .task-editor__index {
    display: none;
  }

  .task-editor__name {
    grid-column: 1 / -1;
  }

  .task-editor__actions {
    grid-column: 1 / -1;
    justify-content: space-between;
  }
}
</style>
