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

/**
 * 首页快速沉浸的三段式级联状态机：
 * 总计划 -> 分计划 -> 任务（只保留非 done）。
 * 与分计划详情页的 TaskSelectionModal 完全解耦。
 */
export const useCascadeStore = defineStore('cascade', () => {
  const stage = ref<1 | 2 | 3>(1)
  const masters = ref<MasterPlan[]>([])
  const subPlans = ref<SubPlan[]>([])
  const tasks = ref<Task[]>([])
  const selectedMaster = ref<MasterPlan | null>(null)
  const selectedSub = ref<SubPlan | null>(null)
  const loading = ref(false)
  const error = ref('')

  function reset(): void {
    stage.value = 1
    masters.value = []
    subPlans.value = []
    tasks.value = []
    selectedMaster.value = null
    selectedSub.value = null
    loading.value = false
    error.value = ''
  }

  async function loadMasters(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('master_plans')
        .select('*')
        .order('deadline', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return
      }
      masters.value = ((data ?? []) as unknown as MasterPlanRow[])
        .map(mapMasterPlan)
        .filter((plan) => plan.status !== 'completed')
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      loading.value = false
    }
  }

  async function chooseMaster(master: MasterPlan): Promise<void> {
    selectedMaster.value = master
    selectedSub.value = null
    subPlans.value = []
    tasks.value = []
    stage.value = 2
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('sub_plans')
        .select('*')
        .eq('master_plan_id', master.id)
        .order('deadline', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return
      }
      subPlans.value = ((data ?? []) as unknown as SubPlanRow[]).map(mapSubPlan)
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      loading.value = false
    }
  }

  async function chooseSub(sub: SubPlan): Promise<void> {
    selectedSub.value = sub
    tasks.value = []
    stage.value = 3
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('tasks')
        .select('*')
        .eq('sub_plan_id', sub.id)
        .neq('status', 'done')
        .order('scheduled_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return
      }
      tasks.value = ((data ?? []) as unknown as TaskRow[])
        .map(mapTask)
        .filter((task) => task.status !== 'done')
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      loading.value = false
    }
  }

  function back(): void {
    if (stage.value === 3) {
      stage.value = 2
      tasks.value = []
      selectedSub.value = null
    } else if (stage.value === 2) {
      stage.value = 1
      subPlans.value = []
      selectedMaster.value = null
    }
  }

  return {
    stage,
    masters,
    subPlans,
    tasks,
    selectedMaster,
    selectedSub,
    loading,
    error,
    reset,
    loadMasters,
    chooseMaster,
    chooseSub,
    back,
  }
})
