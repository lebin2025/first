<script setup lang="ts">
import { computed, ref } from 'vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import { useTasks } from '@/composables/useTasks'
import { useStudyLogs } from '@/composables/useStudyLogs'
import { formatCN, isoDateTimeToDate } from '@/lib/date'
import {
  MEASURE_STANDARD_LABELS,
  TASK_STATUS_LABELS,
  type StudyLog,
  type Task,
  type TaskStatus,
} from '@/types/models'

/** 任务行：折叠展示摘要，展开可改状态 / 预计时长 / 查看历史 */
const props = defineProps<{ task: Task }>()
const emit = defineEmits<{
  (event: 'updated', task: Task): void
  (event: 'request-delete', task: Task): void
}>()

const taskApi = useTasks()
const logsApi = useStudyLogs()

const expanded = ref(false)
const loadingLogs = ref(false)
const saving = ref(false)
const message = ref('')
const logs = ref<StudyLog[]>([])

const draft = ref({
  status: props.task.status as TaskStatus,
  estMinutes: props.task.estMinutes,
  actualMinutes: props.task.actualMinutes,
})

const hasHistory = computed(() => logs.value.length > 0)

function toggle(): void {
  expanded.value = !expanded.value
  if (expanded.value && logs.value.length === 0 && !loadingLogs.value) {
    void loadLogs()
  }
}

async function loadLogs(): Promise<void> {
  loadingLogs.value = true
  logs.value = await logsApi.fetchByTask(props.task.id)
  loadingLogs.value = false
}

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  message.value = ''
  const nextStatus = draft.value.status
  const nextActual =
    nextStatus === 'done' && draft.value.actualMinutes <= 0
      ? draft.value.estMinutes
      : Math.max(0, draft.value.actualMinutes)
  const updated = await taskApi.updateTask(props.task.id, {
    status: nextStatus,
    estMinutes: Math.max(1, draft.value.estMinutes),
    actualMinutes: nextActual,
  })
  saving.value = false
  if (!updated) {
    message.value = taskApi.error.value || '保存失败'
    return
  }
  emit('updated', updated)
  message.value = '已保存'
  await loadLogs()
}

function statusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status]
}
</script>

<template>
  <li class="task" :class="{ 'task--expanded': expanded, 'task--completed': task.status === 'done' }">
    <button type="button" class="task__summary" :aria-expanded="expanded" @click="toggle">
      <span class="task__dot" :class="`task__dot--${task.status}`" aria-hidden="true"></span>
      <span class="task__main">
        <span class="task__name">{{ task.name }}</span>
        <span class="task__meta">
          {{ task.estMinutes }} 分钟 · {{ MEASURE_STANDARD_LABELS[task.measureStandard] }} ·
          每块 {{ task.focusBlock }} 分钟
        </span>
      </span>
      <StatusTag :status="task.status" class="task__tag" />
      <span class="task__chevron" aria-hidden="true">⌄</span>
    </button>

    <div v-if="expanded" class="task__detail">
      <div class="task__fields">
        <label class="task__field">
          <span class="field__label">状态</span>
          <select v-model="draft.status" class="select">
            <option v-for="(label, value) in TASK_STATUS_LABELS" :key="value" :value="value">
              {{ statusLabel(value) }}
            </option>
          </select>
        </label>
        <label class="task__field">
          <span class="field__label">预计时长（分钟）</span>
          <input v-model.number="draft.estMinutes" class="input numeric" type="number" min="1" max="1440" />
        </label>
        <label class="task__field">
          <span class="field__label">实际时长（分钟）</span>
          <input v-model.number="draft.actualMinutes" class="input numeric" type="number" min="0" max="1440" />
        </label>
      </div>

      <div class="task__actions">
        <button type="button" class="btn btn--sm btn--primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存修改' }}
        </button>
        <button type="button" class="link-btn" @click="emit('request-delete', task)">删除任务</button>
        <span v-if="message" class="tiny faint">{{ message }}</span>
      </div>

      <div class="task__history">
        <p class="section__title">学习记录</p>
        <p v-if="loadingLogs" class="tiny faint">正在读取…</p>
        <ul v-else-if="hasHistory" class="task__history-list">
          <li v-for="log in logs" :key="log.id">
            <span class="numeric">{{ formatCN(isoDateTimeToDate(log.loggedAt)) }}</span>
            <span>{{ TASK_STATUS_LABELS[log.status] }}</span>
            <span class="numeric">{{ log.actualMinutes }}/{{ log.plannedMinutes }} 分钟</span>
          </li>
        </ul>
        <p v-else class="tiny faint">还没有记录。完成一次专注后会自动写入。</p>
      </div>
    </div>
  </li>
</template>

<style scoped>
.task {
  border: 0;
  border-top: 1px solid var(--line-soft);
  border-radius: 0;
  background: transparent;
  overflow: hidden;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-radius var(--dur-fast) var(--ease-out);
}

.task:first-child {
  border-top: 0;
}

.task:hover {
  border-radius: 12px;
  background: var(--glass-bg-soft);
  box-shadow: 0 8px 20px -16px var(--overlay);
}

.task--expanded {
  border-radius: 14px;
  background: var(--glass-bg-soft);
  box-shadow: 0 8px 20px -16px var(--overlay);
}

.task--completed {
  opacity: 0.5;
}

.task--completed .task__name {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.task--expanded {
  background: var(--glass-bg);
  border-color: var(--line);
}

.task__summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: 13px 16px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.task__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--text-faint);
}

.task__dot--pending {
  background: var(--accent);
}

.task__dot--done {
  background: var(--success);
}

.task__dot--partial {
  background: var(--warning);
}

.task__dot--skipped {
  background: var(--text-faint);
}

.task__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.task__name {
  font-size: 14px;
  font-weight: 550;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task__meta {
  font-size: 11px;
  color: var(--text-faint);
}

.task__tag {
  flex: 0 0 auto;
}

.task__chevron {
  color: var(--text-faint);
  font-size: 12px;
  transition: transform var(--dur-base) var(--ease-spring);
}

.task--expanded .task__chevron {
  transform: rotate(180deg);
}

.task__detail {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  animation: detail-in var(--dur-base) var(--ease-out);
}

.task__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}

.task__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.task__field .input,
.task__field .select {
  min-height: 38px;
  font-size: 13px;
  padding: 6px 10px;
}

.task__actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.task__history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--line-soft);
}

.task__history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task__history-list li {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
}

@keyframes detail-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task__detail {
    animation: none;
  }

  .task--expanded .task__chevron {
    transform: none;
  }
}
</style>
