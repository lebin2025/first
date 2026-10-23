import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth'
import {
  mapTask,
  type Task,
  type TaskInput,
  type TaskRow,
  type TaskStatus,
} from '@/types/models'

/** 任务数据访问 */
export function useTasks() {
  const auth = useAuthStore()
  const tasks = ref<Task[]>([])
  const loading = ref(false)
  const error = ref('')

  const pendingCount = computed(
    () => tasks.value.filter((task) => task.status === 'pending' || task.status === 'partial').length,
  )

  async function fetchBySubPlan(subPlanId: string): Promise<Task[]> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('tasks')
        .select('*')
        .eq('sub_plan_id', subPlanId)
        .order('scheduled_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return []
      }
      const rows = (data ?? []) as unknown as TaskRow[]
      tasks.value = rows.map(mapTask)
      return tasks.value
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchBySubPlanIds(subPlanIds: string[]): Promise<Task[]> {
    if (subPlanIds.length === 0) {
      tasks.value = []
      return []
    }
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('tasks')
        .select('*')
        .in('sub_plan_id', subPlanIds)
        .order('scheduled_date', { ascending: true, nullsFirst: false })
      if (queryError) {
        error.value = describeError(queryError)
        return []
      }
      const rows = (data ?? []) as unknown as TaskRow[]
      tasks.value = rows.map(mapTask)
      return tasks.value
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchAll(): Promise<Task[]> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('tasks')
        .select('*')
        .order('scheduled_date', { ascending: true, nullsFirst: false })
      if (queryError) {
        error.value = describeError(queryError)
        return []
      }
      const rows = (data ?? []) as unknown as TaskRow[]
      tasks.value = rows.map(mapTask)
      return tasks.value
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id: string): Promise<Task | null> {
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (queryError) {
        error.value = describeError(queryError)
        return null
      }
      return data ? mapTask(data as unknown as TaskRow) : null
    } catch (cause) {
      error.value = describeError(cause)
      return null
    }
  }

  /** 批量创建任务（已带好排期日期） */
  async function createMany(subPlanId: string, inputs: TaskInput[]): Promise<Task[]> {
    if (!auth.userId) {
      error.value = '请先登录'
      return []
    }
    if (inputs.length === 0) return []
    loading.value = true
    error.value = ''
    try {
      const payload = inputs.map((input) => ({
        sub_plan_id: subPlanId,
        user_id: auth.userId,
        name: input.name.trim(),
        est_minutes: Math.round(input.estMinutes),
        measure_standard: input.measureStandard,
        focus_block: Math.round(input.focusBlock),
        scheduled_date: input.scheduledDate,
      }))
      const { data, error: insertError } = await supabase
        .from('tasks')
        .insert(payload)
        .select('*')
      if (insertError) {
        error.value = describeError(insertError)
        return []
      }
      const rows = (data ?? []) as unknown as TaskRow[]
      return rows.map(mapTask)
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function updateTask(
    id: string,
    patch: Partial<{
      name: string
      estMinutes: number
      measureStandard: Task['measureStandard']
      focusBlock: number
      status: TaskStatus
      actualMinutes: number
      scheduledDate: string | null
    }>,
  ): Promise<Task | null> {
    error.value = ''
    try {
      const payload: Record<string, string | number | null> = {}
      if (patch.name !== undefined) payload.name = patch.name.trim()
      if (patch.estMinutes !== undefined) payload.est_minutes = Math.round(patch.estMinutes)
      if (patch.measureStandard !== undefined) payload.measure_standard = patch.measureStandard
      if (patch.focusBlock !== undefined) payload.focus_block = Math.round(patch.focusBlock)
      if (patch.status !== undefined) payload.status = patch.status
      if (patch.actualMinutes !== undefined) payload.actual_minutes = Math.max(0, Math.round(patch.actualMinutes))
      if (patch.scheduledDate !== undefined) payload.scheduled_date = patch.scheduledDate

      const { data, error: updateError } = await supabase
        .from('tasks')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single()
      if (updateError) {
        error.value = describeError(updateError)
        return null
      }
      return mapTask(data as unknown as TaskRow)
    } catch (cause) {
      error.value = describeError(cause)
      return null
    }
  }

  async function deleteMany(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true
    error.value = ''
    try {
      const { error: deleteError } = await supabase.from('tasks').delete().in('id', ids)
      if (deleteError) {
        error.value = describeError(deleteError)
        return false
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    }
  }

  /** 重排确认：批量覆盖 scheduled_date */
  async function updateSchedule(updates: Array<{ id: string; scheduledDate: string }>): Promise<boolean> {
    if (updates.length === 0) return true
    error.value = ''
    try {
      // 逐条更新，保证每条都经过 RLS 校验且失败可定位
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('tasks')
          .update({ scheduled_date: update.scheduledDate })
          .eq('id', update.id)
        if (updateError) {
          error.value = describeError(updateError)
          return false
        }
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    }
  }

  return {
    tasks,
    pendingCount,
    loading,
    error,
    fetchAll,
    fetchBySubPlan,
    fetchBySubPlanIds,
    fetchOne,
    createMany,
    updateTask,
    deleteMany,
    updateSchedule,
  }
}
