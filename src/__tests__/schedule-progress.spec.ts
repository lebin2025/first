import { describe, expect, it } from 'vitest'
import { appendNewTasks, buildInitialSchedule, collectAssignments } from '@/engine/schedule'
import {
  calcProgress,
  calcTaskEarnedMinutes,
  calcWeightedProgress,
  deriveMasterStatus,
  deriveSubPlanStatus,
} from '@/engine/progress'
import { addDays } from '@/lib/date'
import type { TaskStatus } from '@/types/models'

const TODAY = '2026-10-23'

describe('初始排期', () => {
  it('按每日容量顺序铺开任务', () => {
    const result = buildInitialSchedule(
      [
        { id: 'a', name: 'A', estMinutes: 25, oldDate: null },
        { id: 'b', name: 'B', estMinutes: 25, oldDate: null },
        { id: 'c', name: 'C', estMinutes: 45, oldDate: null },
      ],
      {
        start: TODAY,
        deadline: addDays(TODAY, 4),
        weekdayMinutes: 60,
        weekendMinutes: 60,
        bufferDays: 0,
      },
    )
    expect(result.feasible).toBe(true)
    expect(result.unplaced).toHaveLength(0)
    const assignments = collectAssignments(result.days)
    expect(assignments.get('a')).toBe(TODAY)
    expect(assignments.get('b')).toBe(TODAY)
    // A + B 已用 50 分钟，C 需 45 分钟放不下，进入下一天
    expect(assignments.get('c')).not.toBe(TODAY)
  })

  it('容量不足时把排不进的任务放进 unplaced', () => {
    const result = buildInitialSchedule(
      [
        { id: 'a', name: 'A', estMinutes: 120, oldDate: null },
        { id: 'b', name: 'B', estMinutes: 120, oldDate: null },
      ],
      {
        start: TODAY,
        deadline: TODAY,
        weekdayMinutes: 60,
        weekendMinutes: 60,
        bufferDays: 0,
      },
    )
    expect(result.feasible).toBe(false)
    expect(result.unplaced.length).toBeGreaterThan(0)
  })

  it('新增任务不会覆盖已有任务的日期占用', () => {
    const result = appendNewTasks(
      [{ scheduledDate: TODAY, estMinutes: 60 }],
      [{ id: 'new', name: '新增', estMinutes: 60, oldDate: null }],
      {
        start: TODAY,
        deadline: addDays(TODAY, 3),
        weekdayMinutes: 60,
        weekendMinutes: 60,
        bufferDays: 0,
      },
    )
    const assignments = collectAssignments(result.days)
    expect(assignments.get('new')).toBe(addDays(TODAY, 1))
  })
})

describe('进度汇总', () => {
  it('完成拿满、部分完成按实际、跳过为 0', () => {
    const progress = calcProgress([
      { estMinutes: 60, actualMinutes: 60, status: 'done' },
      { estMinutes: 60, actualMinutes: 30, status: 'partial' },
      { estMinutes: 60, actualMinutes: 0, status: 'skipped' },
    ])
    expect(progress.totalMinutes).toBe(180)
    expect(progress.earnedMinutes).toBe(90)
    expect(progress.progress).toBe(0.5)
    expect(progress.doneCount).toBe(1)
    expect(progress.partialCount).toBe(1)
    expect(progress.skippedCount).toBe(1)
  })

  it('部分完成的实际时长不会超过预计时长', () => {
    expect(
      calcTaskEarnedMinutes({ estMinutes: 30, actualMinutes: 90, status: 'partial' }),
    ).toBe(30)
  })

  it('总计划按任务时长加权汇总，而不是简单平均', () => {
    // 分计划 A：100 分钟全部完成；分计划 B：10 分钟未完成
    const weighted = calcWeightedProgress([
      { totalMinutes: 100, earnedMinutes: 100 },
      { totalMinutes: 10, earnedMinutes: 0 },
    ])
    expect(weighted.progress).toBeCloseTo(100 / 110, 4)
    expect(weighted.progress).not.toBe(0.5)
  })

  it('分计划状态：全部完成 → completed，逾期未完成 → overdue', () => {
    const completed = calcProgress([{ estMinutes: 25, actualMinutes: 25, status: 'done' }])
    expect(deriveSubPlanStatus(completed, TODAY, TODAY)).toBe('completed')

    const overdue = calcProgress([{ estMinutes: 25, actualMinutes: 0, status: 'pending' }])
    expect(deriveSubPlanStatus(overdue, addDays(TODAY, -1), TODAY)).toBe('overdue')
    expect(deriveSubPlanStatus(overdue, addDays(TODAY, 3), TODAY)).toBe('active')
  })

  it('总计划状态：所有分计划完成后为 completed', () => {
    const statuses: TaskStatus[] = ['done']
    expect(statuses).toHaveLength(1)
    const summary = calcProgress([{ estMinutes: 40, actualMinutes: 40, status: 'done' }])
    expect(
      deriveMasterStatus({
        progress: summary.progress,
        deadline: addDays(TODAY, 10),
        today: TODAY,
        subPlanStatuses: ['completed', 'completed'],
      }),
    ).toBe('completed')
    expect(
      deriveMasterStatus({
        progress: 0.2,
        deadline: addDays(TODAY, -1),
        today: TODAY,
        subPlanStatuses: ['overdue'],
      }),
    ).toBe('overdue')
  })
})
