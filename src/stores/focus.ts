import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
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
} from '@/types/models'

export type FocusSource = 'dashboard' | 'sub-plan' | 'today' | 'task'

/**
 * 全局专注入口的共享状态。
 * 首页「快速沉浸」不再依赖今日任务池，而是从当前用户全部 pending 任务中
 * 按所属分计划的截止日期（同日期再看任务排期）挑最近的一个。
 */
export const useFocusStore = defineStore('focus', () => {
  const source = ref<FocusSource>('today')
  const task = ref<Task | null>(null)
  const subPlan = ref<SubPlan | null>(null)
  const masterPlan = ref<MasterPlan | null>(null)
  const selectedTaskId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref('')

  function selectTask(taskId: string): void {
    selectedTaskId.value = taskId
    source.value = 'task'
  }

  function clearSelection(): void {
    selectedTaskId.value = null
  }

  function clear(): void {
    task.value = null
    subPlan.value = null
    masterPlan.value = null
    error.value = ''
  }

  async function prepareDashboard(): Promise<Task | null> {
    loading.value = true
    error.value = ''
    clear()

    try {
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .neq('status', 'done')
      if (taskError) {
        error.value = describeError(taskError)
        return null
      }

      const pending = ((taskData ?? []) as unknown as TaskRow[]).map(mapTask)
      if (pending.length === 0) {
        error.value = '还没有未完成任务，先拆一个分计划吧。'
        return null
      }

      const subPlanIds = [...new Set(pending.map((item) => item.subPlanId))]
      const { data: subData, error: subError } = await supabase
        .from('sub_plans')
        .select('*')
        .in('id', subPlanIds)
      if (subError) {
        error.value = describeError(subError)
        return null
      }
      const subPlans = ((subData ?? []) as unknown as SubPlanRow[]).map(mapSubPlan)
      const subMap = new Map(subPlans.map((plan) => [plan.id, plan]))

      const sorted = pending
        .filter((item) => subMap.has(item.subPlanId))
        .sort((a, b) => {
          const aPlan = subMap.get(a.subPlanId)
          const bPlan = subMap.get(b.subPlanId)
          if (aPlan && bPlan && aPlan.deadline !== bPlan.deadline) {
            return aPlan.deadline < bPlan.deadline ? -1 : 1
          }
          const aDate = a.scheduledDate ?? '9999-12-31'
          const bDate = b.scheduledDate ?? '9999-12-31'
          if (aDate !== bDate) return aDate < bDate ? -1 : 1
          return a.createdAt < b.createdAt ? -1 : 1
        })

      const picked = sorted[0]
      if (!picked) {
        error.value = '还没有未完成任务，先拆一个分计划吧。'
        return null
      }
      const pickedSubPlan = subMap.get(picked.subPlanId)
      if (!pickedSubPlan) {
        error.value = '任务所属的分计划不存在。'
        return null
      }

      const { data: masterData, error: masterError } = await supabase
        .from('master_plans')
        .select('*')
        .eq('id', pickedSubPlan.masterPlanId)
        .maybeSingle()
      if (masterError) {
        error.value = describeError(masterError)
        return null
      }

      source.value = 'dashboard'
      task.value = picked
      subPlan.value = pickedSubPlan
      masterPlan.value = masterData
        ? mapMasterPlan(masterData as unknown as MasterPlanRow)
        : null
      return picked
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    source,
    task,
    subPlan,
    masterPlan,
    selectedTaskId,
    loading,
    error,
    selectTask,
    clearSelection,
    clear,
    prepareDashboard,
  }
})
