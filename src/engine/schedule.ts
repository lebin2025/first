import { eachDay, isWeekend } from '@/lib/date'

/**
 * 排期分配器：被「初始排期」与「动态重排」共用。
 *
 * 核心约束：
 * - 工作日 / 周末可用分钟数不同；
 * - 每周预留的缓冲日放在窗口末尾（截止日之前），不排任务；
 * - 单个任务超过当日容量时允许独占一天（并会在界面提示超载）。
 */

export interface AllocatableTask {
  /** 任务唯一键（新建任务时用临时 key） */
  id: string
  name: string
  /** 本次需要安排的有效分钟数（部分完成任务只取剩余量） */
  estMinutes: number
  /** 原排期，用于对比 */
  oldDate: string | null
}

export interface ScheduleDay<T extends AllocatableTask = AllocatableTask> {
  date: string
  /** 当日可用分钟数（工作日 / 周末规则） */
  capacity: number
  /** 是否为缓冲日 */
  isBuffer: boolean
  tasks: T[]
  usedMinutes: number
  /** 原排期中该日的任务总时长（用于变更对比） */
  originalMinutes: number
}

export interface ScheduleWindow {
  start: string
  deadline: string
  weekdayMinutes: number
  weekendMinutes: number
  /** 每周预留缓冲天数（0 ~ 2） */
  bufferDays: number
}

export interface ScheduleSkeleton<T extends AllocatableTask = AllocatableTask> {
  days: ScheduleDay<T>[]
  /** 含头含尾的剩余自然日 */
  remainingDays: number
  /** 实际预留的缓冲日数量（按周折算） */
  bufferDaysReserved: number
  /** 所有非缓冲日容量之和 */
  totalCapacity: number
}

/** 单日可用分钟数 */
export function capacityForDate(date: string, weekdayMinutes: number, weekendMinutes: number): number {
  return Math.max(0, isWeekend(date) ? weekendMinutes : weekdayMinutes)
}

/**
 * 每周 bufferDays 天折算到整个窗口。
 * 窗口不足一周时直接按设置值，最多给窗口留 1 天用于排任务。
 */
export function resolveBufferDaysTotal(remainingDays: number, bufferDaysPerWeek: number): number {
  if (remainingDays <= 1 || bufferDaysPerWeek <= 0) return 0
  const raw =
    remainingDays <= 7
      ? bufferDaysPerWeek
      : Math.round((bufferDaysPerWeek * remainingDays) / 7)
  return Math.max(0, Math.min(raw, remainingDays - 1))
}

/** 构建日期骨架，并把末尾缓冲日标记出来 */
export function buildScheduleSkeleton<T extends AllocatableTask = AllocatableTask>(
  window: ScheduleWindow,
): ScheduleSkeleton<T> {
  const start = window.start > window.deadline ? window.deadline : window.start
  const dates = window.deadline < window.start ? [] : eachDay(start, window.deadline)
  const days: ScheduleDay<T>[] = dates.map((date) => ({
    date,
    capacity: capacityForDate(date, window.weekdayMinutes, window.weekendMinutes),
    isBuffer: false,
    tasks: [],
    usedMinutes: 0,
    originalMinutes: 0,
  }))

  const bufferDaysReserved = resolveBufferDaysTotal(days.length, window.bufferDays)
  // 缓冲日取「截止日之前」的最后 N 天，截止当天仍用于收尾
  for (let offset = 1; offset <= bufferDaysReserved; offset += 1) {
    const day = days[days.length - 1 - offset]
    if (day) day.isBuffer = true
  }

  const totalCapacity = days.reduce((sum, day) => (day.isBuffer ? sum : sum + day.capacity), 0)
  return { days, remainingDays: days.length, bufferDaysReserved, totalCapacity }
}

/**
 * 贪心分配：按顺序把任务装入非缓冲日。
 * quota 为「每日目标分钟数」，用于重排时把任务摊平；不传则尽量填满容量。
 */
export function allocateTasks<T extends AllocatableTask>(
  tasks: T[],
  days: ScheduleDay<T>[],
  quota?: number,
): T[] {
  const pool = [...tasks]
  for (const day of days) {
    if (day.isBuffer) continue
    let used = 0
    while (pool.length > 0) {
      const next = pool[0]
      if (!next) break
      const wouldUse = used + next.estMinutes
      const overflowCapacity = used > 0 && wouldUse > day.capacity
      const overflowQuota = Boolean(quota) && used > 0 && wouldUse > Math.max(quota ?? 0, next.estMinutes)
      if (overflowCapacity || overflowQuota) break
      day.tasks.push(next)
      used = wouldUse
      pool.shift()
      if (quota && used >= quota) break
    }
    day.usedMinutes = used
  }
  return pool
}

export interface InitialScheduleResult<T extends AllocatableTask = AllocatableTask> {
  days: ScheduleDay<T>[]
  unplaced: T[]
  remainingDays: number
  bufferDaysReserved: number
  totalCapacity: number
  feasible: boolean
}

/** 初始排期：从今天开始按容量顺序铺开 */
export function buildInitialSchedule<T extends AllocatableTask>(
  tasks: T[],
  window: ScheduleWindow,
): InitialScheduleResult<T> {
  const skeleton = buildScheduleSkeleton<T>(window)
  const unplaced = allocateTasks(tasks, skeleton.days)
  return {
    ...skeleton,
    unplaced,
    feasible: unplaced.length === 0,
  }
}

/**
 * 编辑分计划时新增任务：占用现有未完成任务之后的剩余容量，
 * 不改变已有任务的日期（避免悄悄重排）。
 */
export function appendNewTasks<T extends AllocatableTask>(
  existing: Array<{ scheduledDate: string | null; estMinutes: number }>,
  newTasks: T[],
  window: ScheduleWindow,
): { days: ScheduleDay<T>[]; unplaced: T[] } {
  const skeleton = buildScheduleSkeleton<T>(window)
  // 先登记已有任务占用的分钟数
  for (const task of existing) {
    if (!task.scheduledDate) continue
    const day = skeleton.days.find((item) => item.date === task.scheduledDate)
    if (day) {
      day.usedMinutes += task.estMinutes
      day.originalMinutes += task.estMinutes
    }
  }

  const unplaced: T[] = []
  for (const task of newTasks) {
    const target = skeleton.days.find(
      (day) => !day.isBuffer && day.usedMinutes + task.estMinutes <= day.capacity,
    )
    const fallback = skeleton.days.find((day) => !day.isBuffer)
    const day = target ?? fallback
    if (!day) {
      unplaced.push(task)
      continue
    }
    day.tasks.push(task)
    day.usedMinutes += task.estMinutes
  }

  return { days: skeleton.days, unplaced }
}

/** 把分配结果拍平成 taskId → 日期 */
export function collectAssignments<T extends AllocatableTask>(
  days: ScheduleDay<T>[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const day of days) {
    for (const task of day.tasks) map.set(task.id, day.date)
  }
  return map
}
