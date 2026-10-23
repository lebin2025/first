import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth'
import {
  mapMasterPlan,
  type MasterPlan,
  type MasterPlanInput,
  type MasterPlanRow,
} from '@/types/models'

/** 总计划数据访问 */
export function useMasterPlans() {
  const auth = useAuthStore()
  const plans = ref<MasterPlan[]>([])
  const loading = ref(false)
  const error = ref('')

  const count = computed(() => plans.value.length)

  async function fetchAll(): Promise<MasterPlan[]> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('master_plans')
        .select('*')
        .order('deadline', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return []
      }
      const rows = (data ?? []) as unknown as MasterPlanRow[]
      plans.value = rows.map(mapMasterPlan)
      return plans.value
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id: string): Promise<MasterPlan | null> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('master_plans')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (queryError) {
        error.value = describeError(queryError)
        return null
      }
      if (!data) return null
      return mapMasterPlan(data as unknown as MasterPlanRow)
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function create(input: MasterPlanInput): Promise<MasterPlan | null> {
    if (!auth.userId) {
      error.value = '请先登录'
      return null
    }
    loading.value = true
    error.value = ''
    try {
      const { data, error: insertError } = await supabase
        .from('master_plans')
        .insert({
          user_id: auth.userId,
          name: input.name.trim(),
          deadline: input.deadline,
          measure_type: input.measureType,
          description: input.description.trim(),
        })
        .select('*')
        .single()
      if (insertError) {
        error.value = describeError(insertError)
        return null
      }
      return mapMasterPlan(data as unknown as MasterPlanRow)
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function update(id: string, input: MasterPlanInput): Promise<MasterPlan | null> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: updateError } = await supabase
        .from('master_plans')
        .update({
          name: input.name.trim(),
          deadline: input.deadline,
          measure_type: input.measureType,
          description: input.description.trim(),
        })
        .eq('id', id)
        .select('*')
        .single()
      if (updateError) {
        error.value = describeError(updateError)
        return null
      }
      return mapMasterPlan(data as unknown as MasterPlanRow)
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
      const { error: deleteError } = await supabase.from('master_plans').delete().eq('id', id)
      if (deleteError) {
        error.value = describeError(deleteError)
        return false
      }
      plans.value = plans.value.filter((plan) => plan.id !== id)
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    } finally {
      loading.value = false
    }
  }

  return { plans, count, loading, error, fetchAll, fetchOne, create, update, remove }
}
