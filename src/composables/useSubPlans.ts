import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth'
import {
  mapSubPlan,
  type SubPlan,
  type SubPlanInput,
  type SubPlanRow,
} from '@/types/models'

/** 分计划数据访问 */
export function useSubPlans() {
  const auth = useAuthStore()
  const subPlans = ref<SubPlan[]>([])
  const loading = ref(false)
  const error = ref('')

  const count = computed(() => subPlans.value.length)

  async function fetchByMaster(masterPlanId: string): Promise<SubPlan[]> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('sub_plans')
        .select('*')
        .eq('master_plan_id', masterPlanId)
        .order('deadline', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return []
      }
      const rows = (data ?? []) as unknown as SubPlanRow[]
      subPlans.value = rows.map(mapSubPlan)
      return subPlans.value
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchAll(): Promise<SubPlan[]> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('sub_plans')
        .select('*')
        .order('deadline', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return []
      }
      const rows = (data ?? []) as unknown as SubPlanRow[]
      subPlans.value = rows.map(mapSubPlan)
      return subPlans.value
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id: string): Promise<SubPlan | null> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('sub_plans')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (queryError) {
        error.value = describeError(queryError)
        return null
      }
      if (!data) return null
      return mapSubPlan(data as unknown as SubPlanRow)
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function create(input: SubPlanInput): Promise<SubPlan | null> {
    if (!auth.userId) {
      error.value = '请先登录'
      return null
    }
    loading.value = true
    error.value = ''
    try {
      const { data, error: insertError } = await supabase
        .from('sub_plans')
        .insert({
          master_plan_id: input.masterPlanId,
          user_id: auth.userId,
          name: input.name.trim(),
          deadline: input.deadline,
          weekday_minutes: Math.round(input.weekdayMinutes),
          weekend_minutes: Math.round(input.weekendMinutes),
          buffer_days: Math.round(input.bufferDays),
        })
        .select('*')
        .single()
      if (insertError) {
        error.value = describeError(insertError)
        return null
      }
      return mapSubPlan(data as unknown as SubPlanRow)
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function update(id: string, input: SubPlanInput): Promise<SubPlan | null> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: updateError } = await supabase
        .from('sub_plans')
        .update({
          name: input.name.trim(),
          deadline: input.deadline,
          weekday_minutes: Math.round(input.weekdayMinutes),
          weekend_minutes: Math.round(input.weekendMinutes),
          buffer_days: Math.round(input.bufferDays),
        })
        .eq('id', id)
        .select('*')
        .single()
      if (updateError) {
        error.value = describeError(updateError)
        return null
      }
      return mapSubPlan(data as unknown as SubPlanRow)
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function remove(id: string): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const { error: deleteError } = await supabase.from('sub_plans').delete().eq('id', id)
      if (deleteError) {
        error.value = describeError(deleteError)
        return false
      }
      subPlans.value = subPlans.value.filter((plan) => plan.id !== id)
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    } finally {
      loading.value = false
    }
  }

  return { subPlans, count, loading, error, fetchAll, fetchByMaster, fetchOne, create, update, remove }
}
