import type { MasterPlanStatus, SubPlanStatus, TaskStatus } from '@/types/models'

/**
 * 进度汇总。
 * 规则：以「任务预计时长」为权重；
 * - 完成：拿满该任务时长；
 * - 部分完成：拿实际投入时长（不超过预计）；
 * - 跳过 / 待做：0。
 * 总计划进度 = Σ 分计划已得时长 / Σ 分计划总时长（即按任务时长加权）。
 */

export interface ProgressTaskLike {
  estMinutes: number
  actualMinutes: number
  status: TaskStatus
}

export interface ProgressSummary {
  taskCount: number
  doneCount: number
  partialCount: number
  skippedCount: number
  pendingCount: number
  totalMinutes: number
  earnedMinutes: number
  /** 0 ~ 1 */
  progress: number
}

export interface WeightedProgressInput {
  totalMinutes: number
  earnedMinutes: number
}

/** 单个任务贡献的分钟数 */
export function calcTaskEarnedMinutes(task: ProgressTaskLike): number {
  if (task.status === 'done') return Math.max(0, task.estMinutes)
  if (task.status === 'partial') {
    return Math.min(Math.max(0, task.estMinutes), Math.max(0, task.actualMinutes))
  }
  return 0
}

export function calcProgress(tasks: ProgressTaskLike[]): ProgressSummary {
  const summary: ProgressSummary = {
    taskCount: tasks.length,
    doneCount: 0,
    partialCount: 0,
    skippedCount: 0,
    pendingCount: 0,
    totalMinutes: 0,
    earnedMinutes: 0,
    progress: 0,
  }

  for (const task of tasks) {
    summary.totalMinutes += Math.max(0, task.estMinutes)
    summary.earnedMinutes += calcTaskEarnedMinutes(task)
    if (task.status === 'done') summary.doneCount += 1
    else if (task.status === 'partial') summary.partialCount += 1
    else if (task.status === 'skipped') summary.skippedCount += 1
    else summary.pendingCount += 1
  }

  summary.progress =
    summary.totalMinutes > 0 ? Math.min(1, summary.earnedMinutes / summary.totalMinutes) : 0
  return summary
}

/** 加权汇总多个分计划 */
export function calcWeightedProgress(items: WeightedProgressInput[]): {
  totalMinutes: number
  earnedMinutes: number
  progress: number
} {
  const totalMinutes = items.reduce((sum, item) => sum + Math.max(0, item.totalMinutes), 0)
  const earnedMinutes = items.reduce((sum, item) => sum + Math.max(0, item.earnedMinutes), 0)
  return {
    totalMinutes,
    earnedMinutes,
    progress: totalMinutes > 0 ? Math.min(1, earnedMinutes / totalMinutes) : 0,
  }
}

/** 分计划状态：全部任务完成 → completed；超过截止日期且未完成 → overdue */
export function deriveSubPlanStatus(
  summary: Pick<ProgressSummary, 'taskCount' | 'doneCount' | 'pendingCount' | 'partialCount' | 'progress'>,
  deadline: string,
  today: string,
): SubPlanStatus {
  const unfinished = summary.pendingCount + summary.partialCount
  if (summary.taskCount > 0 && unfinished === 0) return 'completed'
  if (deadline < today) return 'overdue'
  return 'active'
}

/** 总计划状态：所有分计划完成 → completed；过截止日 → overdue；否则 active */
export function deriveMasterStatus(input: {
  progress: number
  deadline: string
  today: string
  subPlanStatuses: SubPlanStatus[]
}): MasterPlanStatus {
  const { progress, deadline, today, subPlanStatuses } = input
  if (subPlanStatuses.length > 0 && subPlanStatuses.every((status) => status === 'completed')) {
    return 'completed'
  }
  if (progress >= 1 && subPlanStatuses.length > 0) return 'completed'
  if (deadline < today) return 'overdue'
  return 'active'
}
