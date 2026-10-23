import type { MeasureStandard } from '@/types/models'
import { addDays, diffDays, formatCN, isValidISODate } from '@/lib/date'

/**
 * 规则引擎诊断（纯前端，零 API 成本）。
 *
 * 分计划 7 条规则：
 * 1. 时长-单日可用时间匹配（警告）
 * 2. 截止日期可行性（警告）
 * 3. 衡量标准缺失（警告）
 * 4. 任务粒度（警告）
 * 5. 缓冲不足（警告）
 * 6. 分计划日期越界（阻断）
 * 7. 截止日期非法（阻断）
 *
 * 总计划 2 条规则：
 * 1. 截止日期非法（阻断）
 * 2. 与分计划日期冲突（警告）
 *
 * 每条诊断都带具体数字依据，"采纳建议"通过 patch 描述如何修改表单字段。
 */

export type DiagnosticLevel = 'pass' | 'warn' | 'block'

export type DiagnosticPatch =
  | { kind: 'deadline'; value: string }
  | { kind: 'buffer'; value: number }
  | { kind: 'split-task'; taskIndex: number; parts: number }
  | { kind: 'measure-all'; value: MeasureStandard }

export interface DiagnosticSuggestion {
  label: string
  patch: DiagnosticPatch
}

export interface Diagnostic {
  id: string
  rule: string
  level: DiagnosticLevel
  title: string
  message: string
  suggestion?: DiagnosticSuggestion
}

export interface DiagnosticReport {
  items: Diagnostic[]
  passCount: number
  warnCount: number
  blockCount: number
  /** 存在阻断项 → 保存按钮置灰 */
  hasBlocking: boolean
  hasWarning: boolean
}

export interface DiagnosticTaskDraft {
  name: string
  estMinutes: number
  measureStandard: MeasureStandard
  focusBlock: number
}

export interface SubPlanDiagnosticInput {
  deadline: string
  weekdayMinutes: number
  weekendMinutes: number
  bufferDays: number
  tasks: DiagnosticTaskDraft[]
  /** 所属总计划截止日期 */
  masterDeadline: string
  masterName?: string
  /** 今天，便于测试注入 */
  today: string
  /** 从今天起算的可用天数（可选，创建时为剩余天数，编辑时同理） */
  referenceDays?: number
}

/* ------------------------------------------------------------------ */
/* 公共                                                                */
/* ------------------------------------------------------------------ */

function buildReport(items: Diagnostic[]): DiagnosticReport {
  const passCount = items.filter((item) => item.level === 'pass').length
  const warnCount = items.filter((item) => item.level === 'warn').length
  const blockCount = items.filter((item) => item.level === 'block').length
  return {
    items,
    passCount,
    warnCount,
    blockCount,
    hasBlocking: blockCount > 0,
    hasWarning: warnCount > 0,
  }
}

function averageDailyMinutes(weekdayMinutes: number, weekendMinutes: number): number {
  const value = (Math.max(0, weekdayMinutes) * 5 + Math.max(0, weekendMinutes) * 2) / 7
  return Math.round(value)
}

/** 含头含尾的剩余天数；已过期返回 0 */
function remainingDaysUntil(deadline: string, today: string): number {
  if (!isValidISODate(deadline)) return 0
  const gap = diffDays(today, deadline)
  return gap < 0 ? 0 : gap + 1
}

/* ------------------------------------------------------------------ */
/* 分计划诊断                                                          */
/* ------------------------------------------------------------------ */

export function diagnoseSubPlan(input: SubPlanDiagnosticInput): DiagnosticReport {
  const today = input.today
  const items: Diagnostic[] = []
  const tasks = input.tasks.filter((task) => task.name.trim().length > 0)
  const deadlineValid = isValidISODate(input.deadline)
  const todayValid = isValidISODate(today)
  const masterValid = isValidISODate(input.masterDeadline)
  const daysLeft = deadlineValid ? remainingDaysUntil(input.deadline, today) : 0
  const totalMinutes = tasks.reduce((sum, task) => sum + Math.max(0, task.estMinutes), 0)
  const avgDaily = averageDailyMinutes(input.weekdayMinutes, input.weekendMinutes)
  const dailyAvailable = Math.max(1, Math.max(input.weekdayMinutes, input.weekendMinutes))
  const daysNeeded = avgDaily > 0 ? Math.ceil(totalMinutes / avgDaily) : Number.POSITIVE_INFINITY

  /* 规则 7：截止日期非法（阻断）——先判定，避免下游拿到无效值 */
  if (!deadlineValid || !todayValid) {
    items.push({
      id: 'sub-deadline-invalid',
      rule: '截止日期非法',
      level: 'block',
      title: '截止日期无效',
      message: '请选择一个有效的分计划截止日期。',
      suggestion: todayValid
        ? { label: `设为 ${formatCN(addDays(today, 7))}`, patch: { kind: 'deadline', value: addDays(today, 7) } }
        : undefined,
    })
  } else if (input.deadline < today) {
    const fallback = addDays(today, 7)
    const suggested = masterValid && fallback > input.masterDeadline ? input.masterDeadline : fallback
    items.push({
      id: 'sub-deadline-past',
      rule: '截止日期非法',
      level: 'block',
      title: '截止日期早于今天',
      message: `截止日期是 ${formatCN(input.deadline)}，早于今天（${formatCN(today)}），无法排出可执行的日程。`,
      suggestion: { label: `设为 ${formatCN(suggested)}`, patch: { kind: 'deadline', value: suggested } },
    })
  } else {
    items.push({
      id: 'sub-deadline-valid',
      rule: '截止日期非法',
      level: 'pass',
      title: '截止日期有效',
      message: `距截止还有 ${daysLeft} 天（含今天），日期合法。`,
    })
  }

  /* 规则 6：分计划日期越界（阻断） */
  if (deadlineValid && masterValid && input.deadline > input.masterDeadline) {
    const over = diffDays(input.masterDeadline, input.deadline)
    items.push({
      id: 'sub-deadline-overflow',
      rule: '分计划日期越界',
      level: 'block',
      title: '截止日期超出总计划',
      message: `分计划截止于 ${formatCN(input.deadline)}，比${input.masterName ? `「${input.masterName}」` : '所属总计划'}的截止日期（${formatCN(input.masterDeadline)}）晚 ${over} 天。`,
      suggestion: {
        label: `调整为 ${formatCN(input.masterDeadline)}`,
        patch: { kind: 'deadline', value: input.masterDeadline },
      },
    })
  } else if (deadlineValid && masterValid) {
    items.push({
      id: 'sub-deadline-in-range',
      rule: '分计划日期越界',
      level: 'pass',
      title: '截止日期在总计划范围内',
      message: `早于总计划截止日期 ${formatCN(input.masterDeadline)}，符合约束。`,
    })
  }

  /* 规则 1：单任务时长 vs 单日可用时间（警告） */
  const oversized = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => {
      const blocks = Math.max(1, Math.ceil(task.estMinutes / Math.max(1, task.focusBlock)))
      return blocks * task.focusBlock > dailyAvailable
    })
    .sort((a, b) => b.task.estMinutes - a.task.estMinutes)

  const firstOversized = oversized[0]
  if (firstOversized) {
    const blocks = Math.max(1, Math.ceil(firstOversized.task.estMinutes / Math.max(1, firstOversized.task.focusBlock)))
    const needMinutes = blocks * firstOversized.task.focusBlock
    const parts = Math.max(2, Math.ceil(needMinutes / dailyAvailable))
    items.push({
      id: 'sub-task-overflow',
      rule: '时长-任务量匹配',
      level: 'warn',
      title: '单个任务超出一天的可用时间',
      message: `「${firstOversized.task.name}」需 ${blocks} 个专注块（约 ${needMinutes} 分钟），超出你每日 ${dailyAvailable} 分钟的可用时间${oversized.length > 1 ? `；另有 ${oversized.length - 1} 个任务同样超长` : ''}。建议拆分任务或延长截止日期。`,
      suggestion: {
        label: `拆成 ${parts} 个任务`,
        patch: { kind: 'split-task', taskIndex: firstOversized.index, parts },
      },
    })
  } else if (tasks.length > 0) {
    const longest = Math.max(...tasks.map((task) => task.estMinutes))
    items.push({
      id: 'sub-task-overflow',
      rule: '时长-任务量匹配',
      level: 'pass',
      title: '任务时长与每日可用时间匹配',
      message: `最长任务 ${longest} 分钟，可放进每日 ${dailyAvailable} 分钟的可用时间。`,
    })
  } else {
    items.push({
      id: 'sub-task-overflow',
      rule: '时长-任务量匹配',
      level: 'pass',
      title: '等待添加任务',
      message: `当前每日可用 ${dailyAvailable} 分钟，添加任务后会检查单日承载能力。`,
    })
  }

  /* 规则 2：截止日期可行性（警告） */
  if (tasks.length > 0 && avgDaily > 0 && deadlineValid && input.deadline >= today) {
    if (daysNeeded > daysLeft) {
      const shortfall = daysNeeded - daysLeft
      const rawSuggested = addDays(input.deadline, shortfall)
      // 建议值不能越过总计划截止日期，否则会立刻制造新的阻断项
      const suggestedDeadline =
        masterValid && rawSuggested > input.masterDeadline ? input.masterDeadline : rawSuggested
      items.push({
        id: 'sub-deadline-feasibility',
        rule: '截止日期可行性',
        level: 'warn',
        title: '按当前节奏排不进截止日期',
        message: `共 ${totalMinutes} 分钟任务，按每日约 ${avgDaily} 分钟计算需要 ${daysNeeded} 天，距截止仅 ${daysLeft} 天，缺 ${shortfall} 天。建议降低任务量或延后目标。`,
        suggestion: {
          label: `截止日期延至 ${formatCN(suggestedDeadline)}`,
          patch: { kind: 'deadline', value: suggestedDeadline },
        },
      })
    } else {
      items.push({
        id: 'sub-deadline-feasibility',
        rule: '截止日期可行性',
        level: 'pass',
        title: '截止日期可行',
        message: `共 ${totalMinutes} 分钟任务，按每日约 ${avgDaily} 分钟计算需要 ${daysNeeded} 天，距截止 ${daysLeft} 天，节奏可行。`,
      })
    }
  } else if (tasks.length > 0 && avgDaily <= 0) {
    items.push({
      id: 'sub-deadline-feasibility',
      rule: '截止日期可行性',
      level: 'warn',
      title: '每天没有可用时间',
      message: `工作日与周末的每日可用时间都是 0 分钟，当前 ${tasks.length} 个任务无法排期。请至少给工作日留出可用时间。`,
    })
  } else if (tasks.length === 0) {
    items.push({
      id: 'sub-deadline-feasibility',
      rule: '截止日期可行性',
      level: 'pass',
      title: '等待添加任务',
      message: '添加任务后会计算「需要天数 vs 剩余天数」。',
    })
  }

  /* 规则 3：衡量标准缺失（警告） */
  const vagueTasks = tasks.filter((task) => task.measureStandard === 'understand')
  if (vagueTasks.length > 0) {
    items.push({
      id: 'sub-measure-missing',
      rule: '衡量标准缺失',
      level: 'warn',
      title: '任务缺少可验证的产出',
      message: `${vagueTasks.length} 个任务只标了「仅了解」：${vagueTasks
        .slice(0, 3)
        .map((task) => `「${task.name}」`)
        .join('、')}${vagueTasks.length > 3 ? ' 等' : ''}。建议明确「如何判断自己学会了」。`,
      suggestion: {
        label: '全部改为「能复述」',
        patch: { kind: 'measure-all', value: 'restate' },
      },
    })
  } else if (tasks.length > 0) {
    items.push({
      id: 'sub-measure-missing',
      rule: '衡量标准缺失',
      level: 'pass',
      title: '衡量标准清晰',
      message: `全部 ${tasks.length} 个任务都有可验证的衡量标准。`,
    })
  } else {
    items.push({
      id: 'sub-measure-missing',
      rule: '衡量标准缺失',
      level: 'pass',
      title: '等待添加任务',
      message: '添加任务后检查衡量标准。',
    })
  }

  /* 规则 4：任务粒度（警告） */
  const tooLong = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.estMinutes > 120)
    .sort((a, b) => b.task.estMinutes - a.task.estMinutes)
  const firstLong = tooLong[0]
  if (firstLong) {
    const parts = Math.max(2, Math.ceil(firstLong.task.estMinutes / 60))
    items.push({
      id: 'sub-task-granularity',
      rule: '任务粒度',
      level: 'warn',
      title: '任务粒度过大',
      message: `${tooLong.length} 个任务超过 120 分钟，最长的是「${firstLong.task.name}」（${firstLong.task.estMinutes} 分钟）。建议拆成 ${parts} 个可在单次专注内完成的小任务。`,
      suggestion: {
        label: `拆成 ${parts} 个任务`,
        patch: { kind: 'split-task', taskIndex: firstLong.index, parts },
      },
    })
  } else if (tasks.length > 0) {
    const longest = Math.max(...tasks.map((task) => task.estMinutes))
    items.push({
      id: 'sub-task-granularity',
      rule: '任务粒度',
      level: 'pass',
      title: '任务粒度合适',
      message: `最长任务 ${longest} 分钟，不超过 120 分钟。`,
    })
  } else {
    items.push({
      id: 'sub-task-granularity',
      rule: '任务粒度',
      level: 'pass',
      title: '等待添加任务',
      message: '添加任务后检查单个任务是否超过 120 分钟。',
    })
  }

  /* 规则 5：缓冲不足（警告） */
  const pressure = daysLeft > 0 ? daysNeeded / daysLeft : 1
  if (tasks.length > 0 && input.bufferDays === 0) {
    if (pressure >= 0.7) {
      items.push({
        id: 'sub-buffer-missing',
        rule: '缓冲不足',
        level: 'warn',
        title: '没有预留弹性时间',
        message: `按当前任务量已占用 ${Math.round(Math.min(pressure, 1) * 100)}% 的可用天数，缓冲日为 0。一次延误将导致整体顺延，建议每周留 1 天缓冲。`,
        suggestion: { label: '设置每周 1 天缓冲', patch: { kind: 'buffer', value: 1 } },
      })
    } else {
      items.push({
        id: 'sub-buffer-missing',
        rule: '缓冲不足',
        level: 'pass',
        title: '当前节奏宽松',
        message: `任务量仅占用约 ${Math.round(pressure * 100)}% 的可用天数，虽无缓冲日但短期风险较低。`,
      })
    }
  } else if (tasks.length > 0) {
    items.push({
      id: 'sub-buffer-missing',
      rule: '缓冲不足',
      level: 'pass',
      title: '已预留缓冲日',
      message: `每周预留 ${input.bufferDays} 天缓冲，可吸收短期延误。`,
    })
  } else {
    items.push({
      id: 'sub-buffer-missing',
      rule: '缓冲不足',
      level: 'pass',
      title: '等待添加任务',
      message: '添加任务后检查缓冲日设置。',
    })
  }

  return buildReport(items)
}

/* ------------------------------------------------------------------ */
/* 总计划诊断                                                          */
/* ------------------------------------------------------------------ */

export interface MasterPlanDiagnosticInput {
  deadline: string
  subPlans: Array<{ id: string; name: string; deadline: string }>
  today: string
}

export function diagnoseMasterPlan(input: MasterPlanDiagnosticInput): DiagnosticReport {
  const items: Diagnostic[] = []
  const { today } = input

  if (!isValidISODate(input.deadline) || !isValidISODate(today)) {
    items.push({
      id: 'master-deadline-invalid',
      rule: '截止日期非法',
      level: 'block',
      title: '截止日期无效',
      message: '请选择一个有效的总计划截止日期。',
    })
  } else if (input.deadline < today) {
    items.push({
      id: 'master-deadline-invalid',
      rule: '截止日期非法',
      level: 'block',
      title: '截止日期早于今天',
      message: `总计划截止于 ${formatCN(input.deadline)}，早于今天（${formatCN(today)}），无法作为目标日期。`,
      suggestion: { label: '顺延 30 天', patch: { kind: 'deadline', value: addDays(today, 30) } },
    })
  } else {
    items.push({
      id: 'master-deadline-invalid',
      rule: '截止日期非法',
      level: 'pass',
      title: '截止日期有效',
      message: `距截止还有 ${remainingDaysUntil(input.deadline, today)} 天（含今天）。`,
    })
  }

  const conflicting = input.subPlans
    .filter((sub) => isValidISODate(sub.deadline) && isValidISODate(input.deadline))
    .filter((sub) => sub.deadline > input.deadline)
    .sort((a, b) => (a.deadline < b.deadline ? 1 : -1))

  const worst = conflicting[0]
  if (worst) {
    const latest = conflicting.reduce(
      (max, sub) => (sub.deadline > max ? sub.deadline : max),
      conflicting[0]?.deadline ?? input.deadline,
    )
    items.push({
      id: 'master-subplan-conflict',
      rule: '与分计划日期冲突',
      level: 'warn',
      title: '分计划截止日期超出总计划',
      message: `分计划「${worst.name}」截止于 ${formatCN(worst.deadline)}，晚于总计划的 ${formatCN(input.deadline)}${conflicting.length > 1 ? `；共 ${conflicting.length} 个分计划越界` : ''}。建议同步调整。`,
      suggestion: {
        label: `总计划改为 ${formatCN(latest)}`,
        patch: { kind: 'deadline', value: latest },
      },
    })
  } else if (input.subPlans.length > 0) {
    items.push({
      id: 'master-subplan-conflict',
      rule: '与分计划日期冲突',
      level: 'pass',
      title: '与分计划日期一致',
      message: `${input.subPlans.length} 个分计划的截止日期都在总计划范围内。`,
    })
  } else {
    items.push({
      id: 'master-subplan-conflict',
      rule: '与分计划日期冲突',
      level: 'pass',
      title: '等待添加分计划',
      message: '尚无分计划，添加后会检查日期是否越界。',
    })
  }

  return buildReport(items)
}
