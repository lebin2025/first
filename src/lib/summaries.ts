import { calcProgress, calcWeightedProgress, deriveMasterStatus, deriveSubPlanStatus } from '@/engine/progress'
import type {
  MasterPlan,
  MasterPlanSummary,
  MasterPlanStatus,
  SubPlan,
  SubPlanSummary,
  Task,
} from '@/types/models'

/** 由任务聚合出分计划摘要（进度、状态、逾期任务数） */
export function buildSubPlanSummary(subPlan: SubPlan, tasks: Task[], today: string): SubPlanSummary {
  const own = tasks.filter((task) => task.subPlanId === subPlan.id)
  const progress = calcProgress(own)
  const overdueTaskCount = own.filter(
    (task) =>
      (task.status === 'pending' || task.status === 'partial') &&
      task.scheduledDate !== null &&
      task.scheduledDate < today,
  ).length

  return {
    subPlan,
    masterPlan: null,
    taskCount: progress.taskCount,
    doneCount: progress.doneCount,
    totalMinutes: progress.totalMinutes,
    earnedMinutes: progress.earnedMinutes,
    progress: progress.progress,
    status: deriveSubPlanStatus(progress, subPlan.deadline, today),
    overdueTaskCount,
  }
}

/** 总计划进度 = 分计划按任务时长加权汇总 */
export function buildMasterPlanSummary(
  masterPlan: MasterPlan,
  subPlans: SubPlan[],
  tasks: Task[],
  today: string,
): MasterPlanSummary {
  const ownSubPlans = subPlans
    .filter((subPlan) => subPlan.masterPlanId === masterPlan.id)
    .map((subPlan) => buildSubPlanSummary(subPlan, tasks, today))

  const weighted = calcWeightedProgress(
    ownSubPlans.map((summary) => ({
      totalMinutes: summary.totalMinutes,
      earnedMinutes: summary.earnedMinutes,
    })),
  )

  const statuses = ownSubPlans.map((summary) => summary.status)
  const status: MasterPlanStatus = deriveMasterStatus({
    progress: weighted.progress,
    deadline: masterPlan.deadline,
    today,
    subPlanStatuses: statuses,
  })

  return {
    masterPlan,
    subPlans: ownSubPlans,
    subPlanCount: ownSubPlans.length,
    totalMinutes: weighted.totalMinutes,
    earnedMinutes: weighted.earnedMinutes,
    progress: weighted.progress,
    status,
    overdueSubPlanCount: ownSubPlans.filter((summary) => summary.status === 'overdue').length,
  }
}

/**
 * 是否「按当前进度可能逾期」：已过去的时间比例明显高于进度。
 * 仅用于总计划详情页的红字提示。
 */
export function isMasterPlanAtRisk(input: {
  createdAt: string
  deadline: string
  today: string
  progress: number
}): { atRisk: boolean; elapsedRatio: number } {
  const start = input.createdAt.slice(0, 10)
  const startDate = start || input.today
  const totalMs = new Date(`${input.deadline}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()
  const usedMs = new Date(`${input.today}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()
  if (!Number.isFinite(totalMs) || totalMs <= 0) return { atRisk: false, elapsedRatio: 0 }
  const elapsedRatio = Math.min(1, Math.max(0, usedMs / totalMs))
  const atRisk = input.today <= input.deadline && elapsedRatio - input.progress > 0.15
  return { atRisk, elapsedRatio }
}
