import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { todayISO } from '@/lib/date'
import {
  mapMasterPlan,
  mapSubPlan,
  mapTask,
  type MasterPlan,
  type MasterPlanRow,
  type SubPlan,
  type SubPlanRow,
  type Task,
  type TaskRow,
  type TodayTask,
} from '@/types/models'

/**
 * 首页微启动任务池。
 * 任务池 = 所有进行中分计划的「今日 + 逾期未完成」任务，按分计划截止日期排序。
 */
export function useTodayTasks() {
  const today = todayISO()
  const pool = ref<TodayTask[]>([])
  /** 今天排期的全部任务（含已完成，用于「今日进度 x/y 块」） */
  const todayScheduled = ref<TodayTask[]>([])
  const loading = ref(false)
  const error = ref('')
  const skippedIds = ref<string[]>([])

  const totals = computed(() => {
    // 逾期未完成任务也属于「今天要处理」的块，计入分母，保持一致
    const overdueCount = pool.value.filter(
      (item) => item.task.scheduledDate !== null && item.task.scheduledDate < today,
    ).length
    return {
      total: todayScheduled.value.length + overdueCount,
      done: todayScheduled.value.filter((item) => item.task.status === 'done').length,
      partial: todayScheduled.value.filter((item) => item.task.status === 'partial').length,
    }
  })

  const remaining = computed(() => pool.value.length)
  const nextTask = computed<TodayTask | null>(() => pool.value[0] ?? null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    skippedIds.value = []
    try {
      // 1. 逾期未完成（含今天之前）
      const { data: overdueData, error: overdueError } = await supabase
        .from('tasks')
        .select('*')
        .lte('scheduled_date', today)
        .in('status', ['pending', 'partial'])
      if (overdueError) {
        error.value = describeError(overdueError)
        return
      }
      // 2. 今天排期的全部状态任务
      const { data: todayData, error: todayError } = await supabase
        .from('tasks')
        .select('*')
        .eq('scheduled_date', today)
      if (todayError) {
        error.value = describeError(todayError)
        return
      }

      const rowsById = new Map<string, TaskRow>()
      for (const row of (overdueData ?? []) as unknown as TaskRow[]) rowsById.set(row.id, row)
      for (const row of (todayData ?? []) as unknown as TaskRow[]) rowsById.set(row.id, row)
      const allTasks = [...rowsById.values()].map(mapTask)

      if (allTasks.length === 0) {
        pool.value = []
        todayScheduled.value = []
        return
      }

      // 3. 关联分计划与总计划（分开查询，避免嵌套 select 的类型复杂度）
      const subPlanIds = [...new Set(allTasks.map((task) => task.subPlanId))]
      const { data: subPlanData, error: subPlanError } = await supabase
        .from('sub_plans')
        .select('*')
        .in('id', subPlanIds)
      if (subPlanError) {
        error.value = describeError(subPlanError)
        return
      }
      const subPlans = ((subPlanData ?? []) as unknown as SubPlanRow[]).map(mapSubPlan)
      const subPlanMap = new Map<string, SubPlan>(subPlans.map((plan) => [plan.id, plan]))

      const masterPlanIds = [...new Set(subPlans.map((plan) => plan.masterPlanId))]
      const { data: masterPlanData, error: masterPlanError } = await supabase
        .from('master_plans')
        .select('*')
        .in('id', masterPlanIds)
      if (masterPlanError) {
        error.value = describeError(masterPlanError)
        return
      }
      const masterPlans = ((masterPlanData ?? []) as unknown as MasterPlanRow[]).map(mapMasterPlan)
      const masterPlanMap = new Map<string, MasterPlan>(masterPlans.map((plan) => [plan.id, plan]))

      const joined: TodayTask[] = []
      for (const task of allTasks) {
        const subPlan = subPlanMap.get(task.subPlanId)
        if (!subPlan) continue
        const masterPlan = masterPlanMap.get(subPlan.masterPlanId)
        if (!masterPlan) continue
        joined.push({ task, subPlan, masterPlan })
      }

      todayScheduled.value = joined
        .filter((item) => item.task.scheduledDate === today)
        .sort(sortByPlanDeadline)

      pool.value = joined
        .filter((item) => item.task.status === 'pending' || item.task.status === 'partial')
        .sort(sortByPlanDeadline)
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      loading.value = false
    }
  }

  function sortByPlanDeadline(a: TodayTask, b: TodayTask): number {
    if (a.subPlan.deadline !== b.subPlan.deadline) {
      return a.subPlan.deadline < b.subPlan.deadline ? -1 : 1
    }
    const aDate = a.task.scheduledDate ?? ''
    const bDate = b.task.scheduledDate ?? ''
    if (aDate !== bDate) return aDate < bDate ? -1 : 1
    return a.task.createdAt < b.task.createdAt ? -1 : 1
  }

  /** 跳过当前卡片：本轮不再展示（状态回写由调用方负责） */
  function dropTask(taskId: string): void {
    skippedIds.value = [...skippedIds.value, taskId]
    pool.value = pool.value.filter((item) => item.task.id !== taskId)
  }

  function refreshTodayTask(task: Task): void {
    const update = (item: TodayTask): TodayTask =>
      item.task.id === task.id ? { ...item, task } : item
    todayScheduled.value = todayScheduled.value.map(update)
    if (task.status === 'done' || task.status === 'skipped') {
      pool.value = pool.value.filter((item) => item.task.id !== task.id)
    }
  }

  return {
    today,
    pool,
    todayScheduled,
    loading,
    error,
    skippedIds,
    totals,
    remaining,
    nextTask,
    load,
    dropTask,
    refreshTodayTask,
  }
}
