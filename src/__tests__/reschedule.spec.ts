import { describe, expect, it } from 'vitest'
import { buildReschedule, calcEfficiency, calcRemainingMinutes } from '@/engine/reschedule'
import { addDays } from '@/lib/date'
import type { TaskStatus } from '@/types/models'

const TODAY = '2026-10-23'

function task(
  id: string,
  minutes: number,
  options: Partial<{
    status: TaskStatus
    actualMinutes: number
    scheduledDate: string | null
  }> = {},
) {
  return {
    id,
    name: `任务 ${id}`,
    estMinutes: minutes,
    actualMinutes: options.actualMinutes ?? 0,
    status: options.status ?? ('pending' as TaskStatus),
    scheduledDate: options.scheduledDate ?? TODAY,
  }
}

function log(plannedMinutes: number, actualMinutes: number, daysAgo: number, status: TaskStatus = 'done') {
  const date = new Date(`${addDays(TODAY, -daysAgo)}T10:00:00`)
  return {
    plannedMinutes,
    actualMinutes,
    loggedAt: date.toISOString(),
    status,
  }
}

describe('效率系数', () => {
  it('少于 3 条有效记录时按 1.0 计算', () => {
    const result = calcEfficiency([log(25, 10, 1), log(25, 20, 2)], TODAY)
    expect(result.coefficient).toBe(1)
    expect(result.isDefault).toBe(true)
    expect(result.sampleCount).toBe(2)
  })

  it('3 条以上记录按 实际 ÷ 计划 计算，并保留两位小数', () => {
    const result = calcEfficiency(
      [log(25, 20, 1), log(25, 20, 2), log(50, 40, 3)],
      TODAY,
    )
    expect(result.coefficient).toBe(0.8)
    expect(result.isDefault).toBe(false)
    expect(result.sampleCount).toBe(3)
  })

  it('跳过记录（计划时长为 0）不计入样本', () => {
    const result = calcEfficiency([log(0, 0, 0, 'skipped'), log(25, 20, 1)], TODAY)
    expect(result.sampleCount).toBe(1)
    expect(result.coefficient).toBe(1)
  })

  it('7 天之外的记录不计入', () => {
    const result = calcEfficiency([log(25, 0, 30), log(25, 20, 1)], TODAY)
    expect(result.sampleCount).toBe(1)
  })
})

describe('重排引擎', () => {
  it('按公式计算每日任务量：剩余时长 ÷ 可排期天数 ÷ 效率', () => {
    const result = buildReschedule({
      today: TODAY,
      deadline: addDays(TODAY, 9), // 10 天
      subPlanName: 'N2 词汇',
      weekdayMinutes: 60,
      weekendMinutes: 60,
      bufferDays: 0,
      tasks: [task('1', 25), task('2', 25), task('3', 25), task('4', 25)],
      logs: [],
    })
    expect(result.remainingDays).toBe(10)
    expect(result.effectiveDays).toBe(10)
    expect(result.dailyQuota).toBe(10)
    expect(result.feasible).toBe(true)
    expect(result.gapMinutes).toBe(0)
    expect(result.placements).toHaveLength(4)
  })

  it('缓冲日按周折算并被跳过，不排任务', () => {
    const result = buildReschedule({
      today: TODAY,
      deadline: addDays(TODAY, 9),
      subPlanName: 'N2 词汇',
      weekdayMinutes: 60,
      weekendMinutes: 60,
      bufferDays: 2,
      tasks: [task('1', 25), task('2', 25)],
      logs: [],
    })
    // 10 天 × 每周 2 天 ≈ 3 天缓冲
    expect(result.bufferDaysReserved).toBe(3)
    expect(result.effectiveDays).toBe(7)
    const bufferDays = result.days.filter((day) => day.isBuffer)
    expect(bufferDays).toHaveLength(3)
    expect(bufferDays.every((day) => day.tasks.length === 0)).toBe(true)
    // 截止当天仍可排任务
    expect(result.days[result.days.length - 1]?.isBuffer).toBe(false)
  })

  it('剩余天数不足时返回不可行并给出缺口分钟数', () => {
    const result = buildReschedule({
      today: TODAY,
      deadline: addDays(TODAY, 1), // 2 天，每天 60 分钟 = 120 容量
      subPlanName: 'N2 词汇',
      weekdayMinutes: 60,
      weekendMinutes: 60,
      bufferDays: 0,
      tasks: [task('1', 300), task('2', 300)],
      logs: [],
    })
    expect(result.feasible).toBe(false)
    expect(result.gapMinutes).toBeGreaterThan(0)
    expect(result.gapReason).toContain('编辑分计划')
  })

  it('延误任务优先消耗缓冲日', () => {
    const result = buildReschedule({
      today: TODAY,
      deadline: addDays(TODAY, 6),
      subPlanName: 'N2 词汇',
      weekdayMinutes: 60,
      weekendMinutes: 60,
      bufferDays: 1,
      tasks: [task('1', 25, { scheduledDate: addDays(TODAY, -2) })],
      logs: [],
    })
    expect(result.delayedTaskCount).toBe(1)
    expect(result.delayedMinutes).toBe(25)
    expect(result.bufferDaysUsed).toBe(1)
  })

  it('部分完成任务按剩余分钟数重排', () => {
    const result = buildReschedule({
      today: TODAY,
      deadline: addDays(TODAY, 9),
      subPlanName: 'N2 词汇',
      weekdayMinutes: 60,
      weekendMinutes: 60,
      bufferDays: 0,
      tasks: [task('1', 60, { status: 'partial', actualMinutes: 20 })],
      logs: [],
    })
    expect(result.remainingMinutes).toBe(40)
    expect(result.placements[0]?.minutes).toBe(40)
  })

  it('已截止的分计划直接返回不可行', () => {
    const result = buildReschedule({
      today: TODAY,
      deadline: addDays(TODAY, -1),
      subPlanName: 'N2 词汇',
      weekdayMinutes: 60,
      weekendMinutes: 60,
      bufferDays: 0,
      tasks: [task('1', 25)],
      logs: [],
    })
    expect(result.feasible).toBe(false)
    expect(result.remainingDays).toBe(0)
    expect(result.reason).toBe('截止日期已过')
  })

  it('延误任务排在前面，原有日期被保留用于差异对比', () => {
    const result = buildReschedule({
      today: TODAY,
      deadline: addDays(TODAY, 5),
      subPlanName: 'N2 词汇',
      weekdayMinutes: 120,
      weekendMinutes: 120,
      bufferDays: 0,
      tasks: [
        task('later', 25, { scheduledDate: addDays(TODAY, 3) }),
        task('overdue', 25, { scheduledDate: addDays(TODAY, -1) }),
      ],
      logs: [],
    })
    expect(result.placements[0]?.id).toBe('overdue')
    const overdue = result.placements.find((item) => item.id === 'overdue')
    expect(overdue?.oldDate).toBe(addDays(TODAY, -1))
    expect(overdue?.change).toBe('postponed')
  })
})

describe('剩余分钟数', () => {
  it('完成与跳过的任务不计入剩余', () => {
    const remaining = calcRemainingMinutes([
      task('1', 25, { status: 'done', actualMinutes: 25 }),
      task('2', 25, { status: 'skipped' }),
      task('3', 25),
    ])
    expect(remaining).toBe(25)
  })
})
