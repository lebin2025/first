import type { TaskStatus } from '@/types/models'
import { diffDays, eachDay, isoDateTimeToDate } from '@/lib/date'
import {
  allocateTasks,
  buildScheduleSkeleton,
  type AllocatableTask,
  type ScheduleDay,
} from './schedule'

/**
 * 动态重排引擎（纯前端）。
 *
 * 效率系数 = 近 7 天实际时长 ÷ 计划时长（少于 3 条记录按 1.0，限制在 0.3 ~ 2.0）。
 * 新每日任务量 = 剩余总时长 ÷ (剩余天数 - 缓冲日) ÷ 效率系数。
 * 延误优先消耗缓冲日；剩余天数不足时返回不可行与缺口分钟数。
 */

export interface EfficiencyLogLike {
  plannedMinutes: number
  actualMinutes: number
  /** ISO 时间戳 */
  loggedAt: string
  status: TaskStatus
}

export interface EfficiencyInfo {
  /** 效率系数，默认 1.0 */
  coefficient: number
  /** 有效样本数（计划时长 > 0 的记录） */
  sampleCount: number
  plannedTotal: number
  actualTotal: number
  isDefault: boolean
}

export interface RescheduleTaskInput {
  id: string
  name: string
  estMinutes: number
  actualMinutes: number
  status: TaskStatus
  scheduledDate: string | null
}

export interface RescheduleInput {
  today: string
  deadline: string
  subPlanName: string
  weekdayMinutes: number
  weekendMinutes: number
  bufferDays: number
  tasks: RescheduleTaskInput[]
  logs: EfficiencyLogLike[]
}

export type RescheduleChangeKind = 'added' | 'postponed' | 'advanced' | 'unchanged'

export interface ReschedulePlacement {
  id: string
  name: string
  /** 本次安排的分钟数 */
  minutes: number
  oldDate: string | null
  newDate: string
  change: RescheduleChangeKind
}

export interface RescheduleDay {
  date: string
  isBuffer: boolean
  capacity: number
  usedMinutes: number
  originalMinutes: number
  /** 与变更前相比，该日新增的分钟数（可为负） */
  deltaMinutes: number
  tasks: ReschedulePlacement[]
}

export interface RescheduleResult {
  feasible: boolean
  /** 无法排入的分钟数（0 表示可行） */
  gapMinutes: number
  efficiency: EfficiencyInfo
  remainingMinutes: number
  remainingDays: number
  /** 预留（未排任务）的缓冲日数量 */
  bufferDaysReserved: number
  /** 实际可用于排任务的天数 */
  effectiveDays: number
  /** 新每日目标分钟数（公式结果） */
  dailyQuota: number
  totalCapacity: number
  delayedTaskCount: number
  delayedMinutes: number
  /** 延误实际消耗的缓冲日（估算） */
  bufferDaysUsed: number
  /** 剩余待办任务数 */
  remainingTaskCount: number
  days: RescheduleDay[]
  placements: ReschedulePlacement[]
  unplaced: ReschedulePlacement[]
  /** 顶部说明的成因句 */
  reason: string
  /** 若不可行，给出缺口说明 */
  gapReason: string
}

const MIN_COEFFICIENT = 0.3
const MAX_COEFFICIENT = 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 近 7 天效率系数 */
export function calcEfficiency(logs: EfficiencyLogLike[], today: string): EfficiencyInfo {
  const valid = logs.filter((log) => {
    if (log.plannedMinutes <= 0) return false
    if (log.status === 'skipped') return false
    // 偏移量 = 记录日期 - 今天，近 7 天即 [-6, 0]
    const offset = diffDays(today, isoDateTimeToDate(log.loggedAt))
    return offset >= -6 && offset <= 0
  })

  const plannedTotal = valid.reduce((sum, log) => sum + log.plannedMinutes, 0)
  const actualTotal = valid.reduce((sum, log) => sum + log.actualMinutes, 0)

  if (valid.length < 3 || plannedTotal <= 0) {
    return {
      coefficient: 1,
      sampleCount: valid.length,
      plannedTotal,
      actualTotal,
      isDefault: true,
    }
  }

  const raw = actualTotal / plannedTotal
  return {
    coefficient: Math.round(clamp(raw, MIN_COEFFICIENT, MAX_COEFFICIENT) * 100) / 100,
    sampleCount: valid.length,
    plannedTotal,
    actualTotal,
    isDefault: false,
  }
}

function changeKind(oldDate: string | null, newDate: string): RescheduleChangeKind {
  if (!oldDate) return 'added'
  if (newDate > oldDate) return 'postponed'
  if (newDate < oldDate) return 'advanced'
  return 'unchanged'
}

interface PlacementTask extends AllocatableTask {
  oldDate: string | null
  originalMinutes: number
}

/** 计算剩余分钟数（部分完成只计剩余） */
export function calcRemainingMinutes(tasks: RescheduleTaskInput[]): number {
  return tasks.reduce((sum, task) => {
    if (task.status === 'done' || task.status === 'skipped') return sum
    const remaining =
      task.status === 'partial'
        ? Math.max(0, task.estMinutes - Math.min(task.actualMinutes, task.estMinutes))
        : Math.max(0, task.estMinutes)
    return sum + remaining
  }, 0)
}

export function buildReschedule(input: RescheduleInput): RescheduleResult {
  const { today, deadline } = input
  const efficiency = calcEfficiency(input.logs, today)

  const remainingTasks = input.tasks
    .filter((task) => task.status !== 'done' && task.status !== 'skipped')
    .map<PlacementTask>((task) => {
      const minutes =
        task.status === 'partial'
          ? Math.max(0, task.estMinutes - Math.min(task.actualMinutes, task.estMinutes))
          : Math.max(0, task.estMinutes)
      return {
        id: task.id,
        name: task.name,
        estMinutes: minutes,
        oldDate: task.scheduledDate,
        originalMinutes: minutes,
      }
    })
    .filter((task) => task.estMinutes > 0)
    // 逾期任务优先排，其次是原本更早的任务
    .sort((a, b) => {
      const aOverdue = a.oldDate !== null && a.oldDate < today ? 0 : 1
      const bOverdue = b.oldDate !== null && b.oldDate < today ? 0 : 1
      if (aOverdue !== bOverdue) return aOverdue - bOverdue
      if (a.oldDate === b.oldDate) return 0
      if (a.oldDate === null) return 1
      if (b.oldDate === null) return -1
      return a.oldDate < b.oldDate ? -1 : 1
    })

  const remainingMinutes = remainingTasks.reduce((sum, task) => sum + task.estMinutes, 0)
  const remainingDays = deadline < today ? 0 : diffDays(today, deadline) + 1

  if (remainingDays <= 0) {
    return {
      feasible: false,
      gapMinutes: remainingMinutes,
      efficiency,
      remainingMinutes,
      remainingDays: 0,
      bufferDaysReserved: 0,
      effectiveDays: 0,
      dailyQuota: 0,
      totalCapacity: 0,
      delayedTaskCount: 0,
      delayedMinutes: 0,
      bufferDaysUsed: 0,
      remainingTaskCount: remainingTasks.length,
      days: [],
      placements: [],
      unplaced: remainingTasks.map((task) => ({
        id: task.id,
        name: task.name,
        minutes: task.estMinutes,
        oldDate: task.oldDate,
        newDate: task.oldDate ?? today,
        change: 'unchanged' as RescheduleChangeKind,
      })),
      reason: '截止日期已过',
      gapReason: `截止日期已过，剩余 ${remainingMinutes} 分钟任务无法在当前分计划内安排，请编辑分计划延长截止日期。`,
    }
  }

  const skeleton = buildScheduleSkeleton<PlacementTask>({
    start: today,
    deadline,
    weekdayMinutes: input.weekdayMinutes,
    weekendMinutes: input.weekendMinutes,
    bufferDays: input.bufferDays,
  })

  const workDays = skeleton.days.filter((day) => !day.isBuffer)
  const effectiveDays = workDays.length
  const capacityDays = workDays.reduce((sum, day) => sum + (day.capacity > 0 ? 1 : 0), 0)
  const averageCapacity =
    capacityDays > 0 ? workDays.reduce((sum, day) => sum + day.capacity, 0) / capacityDays : 0

  const delayed = remainingTasks.filter(
    (task) => task.oldDate !== null && task.oldDate < today,
  )
  const delayedMinutes = delayed.reduce((sum, task) => sum + task.estMinutes, 0)
  const bufferDaysUsed =
    delayed.length > 0 && averageCapacity > 0
      ? Math.min(skeleton.bufferDaysReserved, Math.ceil(delayedMinutes / averageCapacity))
      : 0

  if (effectiveDays <= 0) {
    return {
      feasible: false,
      gapMinutes: remainingMinutes,
      efficiency,
      remainingMinutes,
      remainingDays,
      bufferDaysReserved: skeleton.bufferDaysReserved,
      effectiveDays: 0,
      dailyQuota: 0,
      totalCapacity: skeleton.totalCapacity,
      delayedTaskCount: delayed.length,
      delayedMinutes,
      bufferDaysUsed,
      remainingTaskCount: remainingTasks.length,
      days: skeleton.days.map((day) => ({
        date: day.date,
        isBuffer: day.isBuffer,
        capacity: day.capacity,
        usedMinutes: 0,
        originalMinutes: calcOriginalMinutes(input.tasks, day.date),
        deltaMinutes: -calcOriginalMinutes(input.tasks, day.date),
        tasks: [],
      })),
      placements: [],
      unplaced: remainingTasks.map((task) => ({
        id: task.id,
        name: task.name,
        minutes: task.estMinutes,
        oldDate: task.oldDate,
        newDate: task.oldDate ?? today,
        change: 'unchanged' as RescheduleChangeKind,
      })),
      reason: `剩余 ${remainingDays} 天已全部被缓冲日占用`,
      gapReason: `剩余 ${remainingDays} 天，缓冲日占 ${skeleton.bufferDaysReserved} 天，没有可排期的天数。请减少缓冲日或延长截止日期。`,
    }
  }

  const dailyQuota =
    remainingMinutes > 0
      ? Math.ceil(remainingMinutes / Math.max(1, effectiveDays) / efficiency.coefficient)
      : 0

  // 公式值只用于展示与估算；实际排布按「每日容量优先」尽早完成，
  // 避免每日均值很小时把今天的任务无意义地推到明天。
  const unplaced = allocateTasks(remainingTasks, skeleton.days)

  const placements: ReschedulePlacement[] = []
  for (const day of skeleton.days) {
    for (const task of day.tasks) {
      const placement: ReschedulePlacement = {
        id: task.id,
        name: task.name,
        minutes: task.estMinutes,
        oldDate: task.oldDate,
        newDate: day.date,
        change: changeKind(task.oldDate, day.date),
      }
      placements.push(placement)
    }
  }

  // 每一天都要计算「变更前」的负载，即使重排后没有任务
  for (const day of skeleton.days) {
    day.originalMinutes = calcOriginalMinutes(input.tasks, day.date)
  }

  // 为未分配任务补一个展示对象
  const unplacedPlacements: ReschedulePlacement[] = unplaced.map((task) => ({
    id: task.id,
    name: task.name,
    minutes: task.estMinutes,
    oldDate: task.oldDate,
    newDate: task.oldDate ?? deadline,
    change: 'unchanged' as RescheduleChangeKind,
  }))

  const capacityShortfall = Math.max(0, remainingMinutes - skeleton.totalCapacity)
  const unplacedMinutes = unplaced.reduce((sum, task) => sum + task.estMinutes, 0)
  const gapMinutes = Math.max(capacityShortfall, unplacedMinutes)
  const feasible = gapMinutes === 0 && effectiveDays > 0

  const days: RescheduleDay[] = skeleton.days.map((day) => ({
    date: day.date,
    isBuffer: day.isBuffer,
    capacity: day.capacity,
    usedMinutes: day.usedMinutes,
    originalMinutes: day.originalMinutes,
    deltaMinutes: day.usedMinutes - day.originalMinutes,
    tasks: day.tasks.map<ReschedulePlacement>((task) => ({
      id: task.id,
      name: task.name,
      minutes: task.estMinutes,
      oldDate: task.oldDate,
      newDate: day.date,
      change: changeKind(task.oldDate, day.date),
    })),
  }))

  const reasonParts: string[] = []
  if (!efficiency.isDefault) {
    reasonParts.push(`近 7 天实际效率为 ${efficiency.coefficient}`)
  } else {
    reasonParts.push(
      efficiency.sampleCount > 0
        ? `近 7 天有效记录仅 ${efficiency.sampleCount} 条，效率系数按 1.0 计算`
        : '暂无足够的学习记录，效率系数按 1.0 计算',
    )
  }
  if (delayed.length > 0) reasonParts.push(`${delayed.length} 个任务延误`)
  else reasonParts.push('任务需要重新摊平到剩余天数')
  reasonParts.push(
    `每日目标约 ${dailyQuota} 分钟（公式参考值，实际按每日容量优先排布）`,
  )

  let gapReason = ''
  if (!feasible) {
    const extraDays = averageCapacity > 0 ? Math.ceil(gapMinutes / averageCapacity) : 0
    gapReason = `剩余 ${effectiveDays} 个可排期日的容量为 ${skeleton.totalCapacity} 分钟，${unplacedMinutes > 0 ? `仍有 ${unplacedMinutes} 分钟任务排不进去` : `还缺 ${gapMinutes} 分钟`}。${
      extraDays > 0 ? `按每天约 ${Math.round(averageCapacity)} 分钟计算，至少还需要 ${extraDays} 天。` : ''
    }请编辑分计划降低任务量或延长截止日期。`
  }

  return {
    feasible,
    gapMinutes,
    efficiency,
    remainingMinutes,
    remainingDays,
    bufferDaysReserved: skeleton.bufferDaysReserved,
    effectiveDays,
    dailyQuota,
    totalCapacity: skeleton.totalCapacity,
    delayedTaskCount: delayed.length,
    delayedMinutes,
    bufferDaysUsed,
    remainingTaskCount: remainingTasks.length,
    days,
    placements,
    unplaced: unplacedPlacements,
    reason: reasonParts.join('，'),
    gapReason,
  }
}

/** 某天在「变更前」的任务总分钟数 */
function calcOriginalMinutes(tasks: RescheduleTaskInput[], date: string): number {
  return tasks.reduce((sum, task) => {
    if (task.status === 'done' || task.status === 'skipped') return sum
    if (task.scheduledDate !== date) return sum
    const minutes =
      task.status === 'partial'
        ? Math.max(0, task.estMinutes - Math.min(task.actualMinutes, task.estMinutes))
        : Math.max(0, task.estMinutes)
    return sum + minutes
  }, 0)
}

/**
 * 手动微调后重新统计每日负载。
 * assignments: taskId → 新日期
 */
export function summarizeManualSchedule(
  days: Array<Pick<RescheduleDay, 'date' | 'isBuffer' | 'capacity'>>,
  placements: ReschedulePlacement[],
  assignments: Record<string, string>,
): Array<{
  date: string
  isBuffer: boolean
  capacity: number
  usedMinutes: number
  overloadMinutes: number
  tasks: ReschedulePlacement[]
}> {
  return days.map((day) => {
    const tasks = placements
      .filter((placement) => (assignments[placement.id] ?? placement.newDate) === day.date)
      .map((placement) => ({
        ...placement,
        newDate: day.date,
        change: changeKind(placement.oldDate, day.date),
      }))
    const usedMinutes = tasks.reduce((sum, task) => sum + task.minutes, 0)
    return {
      date: day.date,
      isBuffer: day.isBuffer,
      capacity: day.capacity,
      usedMinutes,
      overloadMinutes: day.isBuffer ? 0 : Math.max(0, usedMinutes - day.capacity),
      tasks,
    }
  })
}

/** 生成「变更前后」对照用的日期轴（与重排窗口一致） */
export function rescheduleDateAxis(today: string, deadline: string): string[] {
  if (deadline < today) return []
  return eachDay(today, deadline)
}
