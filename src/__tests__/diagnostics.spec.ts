import { describe, expect, it } from 'vitest'
import { diagnoseMasterPlan, diagnoseSubPlan } from '@/engine/diagnostics'
import { addDays } from '@/lib/date'

const TODAY = '2026-10-23'
const MASTER_DEADLINE = '2026-12-31'

const baseTasks = [
  { name: 'N2 核心词汇 Unit 1', estMinutes: 45, measureStandard: 'recall' as const, focusBlock: 25 },
  { name: '被动语态练习', estMinutes: 30, measureStandard: 'solve' as const, focusBlock: 25 },
]

function diagnose(overrides: Partial<Parameters<typeof diagnoseSubPlan>[0]> = {}) {
  return diagnoseSubPlan({
    deadline: addDays(TODAY, 20),
    weekdayMinutes: 60,
    weekendMinutes: 90,
    bufferDays: 1,
    tasks: baseTasks,
    masterDeadline: MASTER_DEADLINE,
    masterName: '三个月通过 N2',
    today: TODAY,
    ...overrides,
  })
}

describe('分计划诊断（7 条规则）', () => {
  it('合法输入没有阻断项，7 条规则全部有结论', () => {
    const report = diagnose()
    expect(report.hasBlocking).toBe(false)
    expect(report.blockCount).toBe(0)
    expect(report.items).toHaveLength(7)
  })

  it('截止日期早于今天 → 阻断，并给出可采纳的顺延建议', () => {
    const report = diagnose({ deadline: addDays(TODAY, -1) })
    const block = report.items.find((item) => item.id === 'sub-deadline-past')
    expect(block?.level).toBe('block')
    expect(report.hasBlocking).toBe(true)
    expect(block?.suggestion?.patch.kind).toBe('deadline')
    if (block?.suggestion?.patch.kind === 'deadline') {
      expect(block.suggestion.patch.value > TODAY).toBe(true)
    }
  })

  it('分计划截止日期晚于总计划 → 阻断，建议值等于总计划截止日期', () => {
    const report = diagnose({ deadline: '2027-01-15' })
    const block = report.items.find((item) => item.id === 'sub-deadline-overflow')
    expect(block?.level).toBe('block')
    expect(block?.message).toContain('晚')
    expect(block?.suggestion?.patch).toEqual({ kind: 'deadline', value: MASTER_DEADLINE })
  })

  it('衡量标准为「仅了解」→ 警告，并支持一键改为「能复述」', () => {
    const report = diagnose({
      tasks: [{ name: '随便看看', estMinutes: 25, measureStandard: 'understand', focusBlock: 25 }],
    })
    const warn = report.items.find((item) => item.id === 'sub-measure-missing')
    expect(warn?.level).toBe('warn')
    expect(warn?.suggestion?.patch).toEqual({ kind: 'measure-all', value: 'restate' })
    expect(report.hasBlocking).toBe(false)
  })

  it('单个任务超过 120 分钟 → 粒度警告；超过每日可用时间 → 时长匹配警告', () => {
    const report = diagnose({
      tasks: [{ name: '超大任务', estMinutes: 180, measureStandard: 'solve', focusBlock: 25 }],
    })
    expect(report.items.find((item) => item.id === 'sub-task-granularity')?.level).toBe('warn')
    const overflow = report.items.find((item) => item.id === 'sub-task-overflow')
    expect(overflow?.level).toBe('warn')
    expect(overflow?.suggestion?.patch.kind).toBe('split-task')
  })

  it('任务量排不进截止日期 → 可行性警告，建议截止日期顺延', () => {
    const report = diagnose({
      deadline: addDays(TODAY, 3),
      tasks: [
        { name: '任务一', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
        { name: '任务二', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
        { name: '任务三', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
        { name: '任务四', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
        { name: '任务五', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
      ],
    })
    const warn = report.items.find((item) => item.id === 'sub-deadline-feasibility')
    expect(warn?.level).toBe('warn')
    expect(warn?.message).toMatch(/需要 \d+ 天/)
    expect(warn?.suggestion?.patch.kind).toBe('deadline')
  })

  it('缓冲日为 0 且任务量紧张 → 缓冲警告，建议设为每周 1 天', () => {
    const report = diagnose({
      bufferDays: 0,
      deadline: addDays(TODAY, 4),
      tasks: [
        { name: '任务一', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
        { name: '任务二', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
        { name: '任务三', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
        { name: '任务四', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
        { name: '任务五', estMinutes: 60, measureStandard: 'solve', focusBlock: 25 },
      ],
    })
    const warn = report.items.find((item) => item.id === 'sub-buffer-missing')
    expect(warn?.level).toBe('warn')
    expect(warn?.suggestion?.patch).toEqual({ kind: 'buffer', value: 1 })
  })
})

describe('总计划诊断（2 条规则）', () => {
  it('截止日期合法且无冲突 → 全部通过', () => {
    const report = diagnoseMasterPlan({
      deadline: addDays(TODAY, 30),
      subPlans: [{ id: 's1', name: 'N2 词汇', deadline: addDays(TODAY, 20) }],
      today: TODAY,
    })
    expect(report.hasBlocking).toBe(false)
    expect(report.warnCount).toBe(0)
    expect(report.items).toHaveLength(2)
  })

  it('总计划截止日期早于今天 → 阻断', () => {
    const report = diagnoseMasterPlan({
      deadline: addDays(TODAY, -3),
      subPlans: [],
      today: TODAY,
    })
    expect(report.items.find((item) => item.id === 'master-deadline-invalid')?.level).toBe('block')
    expect(report.hasBlocking).toBe(true)
  })

  it('分计划越界 → 警告，建议值取最晚的分计划截止日期', () => {
    const latest = addDays(TODAY, 40)
    const report = diagnoseMasterPlan({
      deadline: addDays(TODAY, 30),
      subPlans: [
        { id: 's1', name: 'N2 词汇', deadline: addDays(TODAY, 25) },
        { id: 's2', name: 'N2 语法', deadline: latest },
      ],
      today: TODAY,
    })
    const warn = report.items.find((item) => item.id === 'master-subplan-conflict')
    expect(warn?.level).toBe('warn')
    expect(warn?.message).toContain('N2 语法')
    expect(warn?.suggestion?.patch).toEqual({ kind: 'deadline', value: latest })
  })
})
