import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { todayISO } from '@/lib/date'
import { useAuthStore } from '@/stores/auth'
import {
  mapStudyLog,
  type StudyLog,
  type StudyLogInput,
  type StudyLogRow,
  type Task,
  type TaskStatus,
} from '@/types/models'

/** 学习记录（StudyLog）：效率系数与统计页的数据来源 */
export function useStudyLogs() {
  const auth = useAuthStore()
  const logs = ref<StudyLog[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchRecent(days = 7): Promise<StudyLog[]> {
    loading.value = true
    error.value = ''
    try {
      const from = new Date()
      from.setDate(from.getDate() - (days - 1))
      from.setHours(0, 0, 0, 0)
      const { data, error: queryError } = await supabase
        .from('study_logs')
        .select('*')
        .gte('logged_at', from.toISOString())
        .order('logged_at', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return []
      }
      const rows = (data ?? []) as unknown as StudyLogRow[]
      logs.value = rows.map(mapStudyLog)
      return logs.value
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchByTask(taskId: string): Promise<StudyLog[]> {
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('study_logs')
        .select('*')
        .eq('task_id', taskId)
        .order('logged_at', { ascending: false })
      if (queryError) {
        error.value = describeError(queryError)
        return []
      }
      const rows = (data ?? []) as unknown as StudyLogRow[]
      return rows.map(mapStudyLog)
    } catch (cause) {
      error.value = describeError(cause)
      return []
    }
  }

  async function fetchAll(): Promise<StudyLog[]> {
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('study_logs')
        .select('*')
        .order('logged_at', { ascending: false })
      if (queryError) {
        error.value = describeError(queryError)
        return []
      }
      const rows = (data ?? []) as unknown as StudyLogRow[]
      return rows.map(mapStudyLog)
    } catch (cause) {
      error.value = describeError(cause)
      return []
    }
  }

  async function create(input: StudyLogInput): Promise<StudyLog | null> {
    if (!auth.userId) {
      error.value = '请先登录'
      return null
    }
    error.value = ''
    try {
      const { data, error: insertError } = await supabase
        .from('study_logs')
        .insert({
          user_id: auth.userId,
          task_id: input.taskId,
          planned_minutes: Math.max(0, Math.round(input.plannedMinutes)),
          actual_minutes: Math.max(0, Math.round(input.actualMinutes)),
          status: input.status,
        })
        .select('*')
        .single()
      if (insertError) {
        error.value = describeError(insertError)
        return null
      }
      return mapStudyLog(data as unknown as StudyLogRow)
    } catch (cause) {
      error.value = describeError(cause)
      return null
    }
  }

  /**
   * 结束一次专注：回写任务状态 + 写学习记录。
   * - 完成 / 部分完成：累计实际分钟；
   * - 跳过：只记录一条 planned = 0 的日志，不影响效率系数。
   */
  async function recordSession(params: {
    task: Task
    plannedMinutes: number
    actualMinutes: number
    status: Extract<TaskStatus, 'done' | 'partial' | 'skipped'>
  }): Promise<boolean> {
    const { task, plannedMinutes, actualMinutes, status } = params
    error.value = ''
    const isSkip = status === 'skipped'
    const nextActual = isSkip
      ? task.actualMinutes
      : Math.min(task.estMinutes, Math.max(0, Math.round(task.actualMinutes + actualMinutes)))

    try {
      const { error: updateError } = await supabase
        .from('tasks')
        .update({
          status,
          actual_minutes: nextActual,
          // 第一次开始任务时补一个排期，便于统计（用本地日期，避免 UTC 偏移）
          scheduled_date: task.scheduledDate ?? todayISO(),
        })
        .eq('id', task.id)
      if (updateError) {
        error.value = describeError(updateError)
        return false
      }

      const { error: logError } = await supabase.from('study_logs').insert({
        user_id: auth.userId,
        task_id: task.id,
        planned_minutes: isSkip ? 0 : Math.max(0, Math.round(plannedMinutes)),
        actual_minutes: isSkip ? 0 : Math.max(0, Math.round(actualMinutes)),
        status,
      })
      if (logError) {
        error.value = describeError(logError)
        return false
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    }
  }

  const totalActual = computed(() =>
    logs.value.reduce((sum, log) => sum + Math.max(0, log.actualMinutes), 0),
  )

  return { logs, loading, error, totalActual, fetchRecent, fetchByTask, fetchAll, create, recordSession }
}
