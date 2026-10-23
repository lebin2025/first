import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { addDays, isoDateTimeToDate, todayISO, weekdayLabel } from '@/lib/date'
import { calcEfficiency, type EfficiencyInfo } from '@/engine/reschedule'
import {
  calcProgress,
  deriveMasterStatus,
  deriveSubPlanStatus,
} from '@/engine/progress'
import {
  mapMasterPlan,
  mapStudyLog,
  mapSubPlan,
  mapTask,
  type MasterPlanRow,
  type StudyLog,
  type StudyLogRow,
  type SubPlan,
  type SubPlanRow,
  type Task,
  type TaskRow,
} from '@/types/models'

export interface DailyStat {
  date: string
  label: string
  planned: number
  actual: number
}

export interface EfficiencyPoint {
  date: string
  label: string
  coefficient: number | null
}

export interface BufferRecord {
  subPlanId: string
  subPlanName: string
  bufferDays: number
  overdueTasks: number
  overdueMinutes: number
}

export interface MasterProgressItem {
  id: string
  name: string
  progress: number
  status: string
  deadline: string
}

export interface StatsData {
  week: DailyStat[]
  streakDays: number
  completion: { done: number; partial: number; skipped: number; pending: number }
  completionRate: number
  efficiency: EfficiencyInfo
  efficiencyTrend: EfficiencyPoint[]
  bufferRecords: BufferRecord[]
  masterProgress: MasterProgressItem[]
  totals: {
    weekPlanned: number
    weekActual: number
    allTasks: number
    totalMinutes: number
    earnedMinutes: number
  }
}

/** 统计页聚合（只读） */
export function useStats() {
  const data = ref<StatsData | null>(null)
  const loading = ref(false)
  const error = ref('')
  const logs = ref<StudyLog[]>([])
  const today = todayISO()

  const hasData = computed(() => (data.value?.totals.allTasks ?? 0) > 0)

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      // 60 天日志足够覆盖近 7 天趋势与连续打卡
      const since = new Date(`${addDays(today, -59)}T00:00:00`).toISOString()
      const [masterRes, subRes, taskRes, logRes] = await Promise.all([
        supabase.from('master_plans').select('*'),
        supabase.from('sub_plans').select('*'),
        supabase.from('tasks').select('*'),
        supabase.from('study_logs').select('*').gte('logged_at', since),
      ])

      const firstError = masterRes.error ?? subRes.error ?? taskRes.error ?? logRes.error
      if (firstError) {
        error.value = describeError(firstError)
        return
      }

      const masterPlans = ((masterRes.data ?? []) as unknown as MasterPlanRow[]).map(mapMasterPlan)
      const subPlans = ((subRes.data ?? []) as unknown as SubPlanRow[]).map(mapSubPlan)
      const tasks = ((taskRes.data ?? []) as unknown as TaskRow[]).map(mapTask)
      logs.value = ((logRes.data ?? []) as unknown as StudyLogRow[]).map(mapStudyLog)

      /* 近 7 天：计划 vs 实际 */
      const week: DailyStat[] = []
      for (let offset = -6; offset <= 0; offset += 1) {
        const date = addDays(today, offset)
        const dayLogs = logs.value.filter((log) => isoDateTimeToDate(log.loggedAt) === date)
        week.push({
          date,
          label: offset === 0 ? '今天' : weekdayLabel(date),
          planned: dayLogs.reduce((sum, log) => sum + log.plannedMinutes, 0),
          actual: dayLogs.reduce((sum, log) => sum + log.actualMinutes, 0),
        })
      }

      /* 连续打卡：今天还没记录时不断档，从昨天继续数 */
      let streakDays = 0
      for (let offset = 0; offset < 120; offset += 1) {
        const date = addDays(today, -offset)
        const actual = logs.value
          .filter((log) => isoDateTimeToDate(log.loggedAt) === date)
          .reduce((sum, log) => sum + log.actualMinutes, 0)
        if (actual > 0) streakDays += 1
        else if (offset === 0) continue
        else break
      }

      /* 完成率 */
      const completion = { done: 0, partial: 0, skipped: 0, pending: 0 }
      for (const task of tasks) {
        if (task.status === 'done') completion.done += 1
        else if (task.status === 'partial') completion.partial += 1
        else if (task.status === 'skipped') completion.skipped += 1
        else completion.pending += 1
      }
      const completionRate = tasks.length > 0 ? completion.done / tasks.length : 0

      /* 效率系数 + 7 天趋势 */
      const efficiency = calcEfficiency(
        logs.value.map((log) => ({
          plannedMinutes: log.plannedMinutes,
          actualMinutes: log.actualMinutes,
          loggedAt: log.loggedAt,
          status: log.status,
        })),
        today,
      )

      const efficiencyTrend: EfficiencyPoint[] = week.map((day) => ({
        date: day.date,
        label: weekdayLabel(day.date),
        coefficient:
          day.planned > 0 ? Math.round((day.actual / day.planned) * 100) / 100 : null,
      }))

      /* 缓冲日消耗：用逾期任务估算 */
      const bufferRecords: BufferRecord[] = subPlans.map((subPlan) => {
        const subTasks = tasks.filter((task) => task.subPlanId === subPlan.id)
        const overdue = subTasks.filter(
          (task) =>
            (task.status === 'pending' || task.status === 'partial') &&
            task.scheduledDate !== null &&
            task.scheduledDate < today,
        )
        return {
          subPlanId: subPlan.id,
          subPlanName: subPlan.name,
          bufferDays: subPlan.bufferDays,
          overdueTasks: overdue.length,
          overdueMinutes: overdue.reduce((sum, task) => sum + task.estMinutes, 0),
        }
      })

      /* 按总计划维度汇总 */
      const masterProgress: MasterProgressItem[] = masterPlans.map((masterPlan) => {
        const ownSubPlans = subPlans.filter((plan) => plan.masterPlanId === masterPlan.id)
        const summaries = ownSubPlans.map((plan: SubPlan) => {
          const progress = calcProgress(tasks.filter((task) => task.subPlanId === plan.id))
          return {
            progress,
            status: deriveSubPlanStatus(progress, plan.deadline, today),
          }
        })
        const progress = calcProgress(
          tasks.filter((task) => ownSubPlans.some((plan) => plan.id === task.subPlanId)),
        )
        return {
          id: masterPlan.id,
          name: masterPlan.name,
          progress: progress.progress,
          deadline: masterPlan.deadline,
          status: deriveMasterStatus({
            progress: progress.progress,
            deadline: masterPlan.deadline,
            today,
            subPlanStatuses: summaries.map((summary) => summary.status),
          }),
        }
      })

      const overall = calcProgress(tasks)

      data.value = {
        week,
        streakDays,
        completion,
        completionRate,
        efficiency,
        efficiencyTrend,
        bufferRecords,
        masterProgress,
        totals: {
          weekPlanned: week.reduce((sum, day) => sum + day.planned, 0),
          weekActual: week.reduce((sum, day) => sum + day.actual, 0),
          allTasks: tasks.length,
          totalMinutes: overall.totalMinutes,
          earnedMinutes: overall.earnedMinutes,
        },
      }
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      loading.value = false
    }
  }

  return { data, logs, loading, error, hasData, today, load }
}

/** 供设置页导出使用：一次性拉取全部任务（避免与统计逻辑耦合） */
export function useAllTasksSnapshot() {
  const tasks = ref<Task[]>([])
  async function load(): Promise<Task[]> {
    const { data, error: queryError } = await supabase.from('tasks').select('*')
    if (queryError) return []
    tasks.value = ((data ?? []) as unknown as TaskRow[]).map(mapTask)
    return tasks.value
  }
  return { tasks, load }
}
