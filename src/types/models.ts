/**
 * 领域模型与数据库行类型。
 *
 * 命名约定：
 * - 应用层（组件 / 引擎）统一使用 camelCase；
 * - 数据库层（Supabase）使用 snake_case；
 * - 两者之间通过下方 mapper 显式转换，避免把数据库字段泄漏到业务代码里。
 */

/* ------------------------------------------------------------------ */
/* 枚举                                                                */
/* ------------------------------------------------------------------ */

/** 总计划的目标衡量标准 */
export type MeasureType = 'exam' | 'artifact' | 'level' | 'other'

export const MEASURE_TYPE_LABELS: Record<MeasureType, string> = {
  exam: '通过考试',
  artifact: '完成作品',
  level: '达到某水平',
  other: '其他',
}

export const MEASURE_TYPE_OPTIONS: ReadonlyArray<{ value: MeasureType; label: string }> = (
  Object.keys(MEASURE_TYPE_LABELS) as MeasureType[]
).map((value) => ({ value, label: MEASURE_TYPE_LABELS[value] }))

/** 表单允许在四种预设之外输入自定义衡量标准 */
export type MeasureSelection = MeasureType | 'custom'

export const MEASURE_SELECT_OPTIONS: ReadonlyArray<{
  value: MeasureSelection
  label: string
}> = [
  ...MEASURE_TYPE_OPTIONS,
  { value: 'custom', label: '自定义' },
]

/** 任务的衡量标准（决定"怎样才算学会"） */
export type MeasureStandard = 'recall' | 'restate' | 'solve' | 'operate' | 'understand'

export const MEASURE_STANDARD_LABELS: Record<MeasureStandard, string> = {
  recall: '能默写',
  restate: '能复述',
  solve: '能解题',
  operate: '能实操',
  understand: '仅了解',
}

export const MEASURE_STANDARD_OPTIONS: ReadonlyArray<{ value: MeasureStandard; label: string }> = (
  Object.keys(MEASURE_STANDARD_LABELS) as MeasureStandard[]
).map((value) => ({ value, label: MEASURE_STANDARD_LABELS[value] }))

/** 任务状态 */
export type TaskStatus = 'pending' | 'done' | 'partial' | 'skipped'

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待做',
  done: '完成',
  partial: '部分完成',
  skipped: '跳过',
}

/** 总计划展示状态（由进度 + 截止日期推导，不直接存库） */
export type MasterPlanStatus = 'active' | 'completed' | 'overdue'

export const MASTER_PLAN_STATUS_LABELS: Record<MasterPlanStatus, string> = {
  active: '进行中',
  completed: '已完成',
  overdue: '已逾期',
}

/** 分计划展示状态 */
export type SubPlanStatus = 'active' | 'completed' | 'overdue'

export const SUB_PLAN_STATUS_LABELS: Record<SubPlanStatus, string> = {
  active: '进行中',
  completed: '已完成',
  overdue: '已逾期',
}

/** 诊断级别 */
export type DiagnosticLevel = 'pass' | 'warn' | 'block'

/* ------------------------------------------------------------------ */
/* 应用层实体                                                          */
/* ------------------------------------------------------------------ */

export interface MasterPlan {
  id: string
  userId: string
  name: string
  /** yyyy-MM-dd */
  deadline: string
  measureType: MeasureType
  measureDetail: string
  description: string
  /** 数据库占位字段；页面展示请使用 deriveMasterStatus() 计算 */
  status: MasterPlanStatus
  createdAt: string
}

export interface SubPlan {
  id: string
  masterPlanId: string
  userId: string
  name: string
  /** yyyy-MM-dd */
  deadline: string
  weekdayMinutes: number
  weekendMinutes: number
  bufferDays: number
  createdAt: string
}

export interface Task {
  id: string
  subPlanId: string
  userId: string
  name: string
  estMinutes: number
  measureStandard: MeasureStandard
  /** 单次专注块长度：15 / 25 / 45 */
  focusBlock: number
  status: TaskStatus
  actualMinutes: number
  /** yyyy-MM-dd，可能为空（尚未排期） */
  scheduledDate: string | null
  createdAt: string
}

export interface StudyLog {
  id: string
  userId: string
  taskId: string | null
  plannedMinutes: number
  actualMinutes: number
  status: TaskStatus
  /** ISO 时间戳 */
  loggedAt: string
}

/* ------------------------------------------------------------------ */
/* 数据库行类型（snake_case）                                          */
/* ------------------------------------------------------------------ */

export interface MasterPlanRow {
  id: string
  user_id: string
  name: string
  deadline: string
  measure_type: string
  measure_detail: string | null
  description: string | null
  status: string
  created_at: string
}

export interface SubPlanRow {
  id: string
  master_plan_id: string
  user_id: string
  name: string
  deadline: string
  weekday_minutes: number
  weekend_minutes: number
  buffer_days: number
  created_at: string
}

export interface TaskRow {
  id: string
  sub_plan_id: string
  user_id: string
  name: string
  est_minutes: number
  measure_standard: string
  focus_block: number
  status: string
  actual_minutes: number
  scheduled_date: string | null
  created_at: string
}

export interface StudyLogRow {
  id: string
  user_id: string
  task_id: string | null
  planned_minutes: number
  actual_minutes: number
  status: string
  logged_at: string
}

/* ------------------------------------------------------------------ */
/* 写入载荷                                                            */
/* ------------------------------------------------------------------ */

export interface MasterPlanInput {
  name: string
  deadline: string
  measureType: MeasureType
  measureDetail?: string
  description: string
}

export interface SubPlanInput {
  masterPlanId: string
  name: string
  deadline: string
  weekdayMinutes: number
  weekendMinutes: number
  bufferDays: number
}

export interface TaskInput {
  name: string
  estMinutes: number
  measureStandard: MeasureStandard
  focusBlock: number
  scheduledDate: string | null
}

export interface StudyLogInput {
  taskId: string
  plannedMinutes: number
  actualMinutes: number
  status: TaskStatus
}

/* ------------------------------------------------------------------ */
/* 聚合视图模型                                                        */
/* ------------------------------------------------------------------ */

/** 分计划 + 其任务聚合出的进度信息 */
export interface SubPlanSummary {
  subPlan: SubPlan
  masterPlan: MasterPlan | null
  taskCount: number
  doneCount: number
  totalMinutes: number
  earnedMinutes: number
  /** 0 ~ 1 */
  progress: number
  status: SubPlanStatus
  overdueTaskCount: number
}

/** 总计划 + 分计划加权后的汇总 */
export interface MasterPlanSummary {
  masterPlan: MasterPlan
  subPlans: SubPlanSummary[]
  subPlanCount: number
  totalMinutes: number
  earnedMinutes: number
  /** 0 ~ 1，按任务时长加权 */
  progress: number
  status: MasterPlanStatus
  overdueSubPlanCount: number
}

/** 首页任务卡片（跨分计划的任务池条目） */
export interface TodayTask {
  task: Task
  subPlan: SubPlan
  masterPlan: MasterPlan
}

/* ------------------------------------------------------------------ */
/* Mapper                                                              */
/* ------------------------------------------------------------------ */

function asMeasureType(value: string): MeasureType {
  return value === 'exam' || value === 'artifact' || value === 'level' || value === 'other'
    ? value
    : 'other'
}

function asMeasureStandard(value: string): MeasureStandard {
  return value === 'recall' ||
    value === 'restate' ||
    value === 'solve' ||
    value === 'operate' ||
    value === 'understand'
    ? value
    : 'understand'
}

function asTaskStatus(value: string): TaskStatus {
  return value === 'done' || value === 'partial' || value === 'skipped' ? value : 'pending'
}

function asMasterStatus(value: string): MasterPlanStatus {
  return value === 'completed' || value === 'overdue' ? value : 'active'
}

export function mapMasterPlan(row: MasterPlanRow): MasterPlan {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    deadline: row.deadline,
    measureType: asMeasureType(row.measure_type),
    measureDetail: row.measure_detail ?? '',
    description: row.description ?? '',
    status: asMasterStatus(row.status),
    createdAt: row.created_at,
  }
}

export function mapSubPlan(row: SubPlanRow): SubPlan {
  return {
    id: row.id,
    masterPlanId: row.master_plan_id,
    userId: row.user_id,
    name: row.name,
    deadline: row.deadline,
    weekdayMinutes: row.weekday_minutes,
    weekendMinutes: row.weekend_minutes,
    bufferDays: row.buffer_days,
    createdAt: row.created_at,
  }
}

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    subPlanId: row.sub_plan_id,
    userId: row.user_id,
    name: row.name,
    estMinutes: row.est_minutes,
    measureStandard: asMeasureStandard(row.measure_standard),
    focusBlock: row.focus_block,
    status: asTaskStatus(row.status),
    actualMinutes: row.actual_minutes,
    scheduledDate: row.scheduled_date,
    createdAt: row.created_at,
  }
}

export function mapStudyLog(row: StudyLogRow): StudyLog {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    plannedMinutes: row.planned_minutes,
    actualMinutes: row.actual_minutes,
    status: asTaskStatus(row.status),
    loggedAt: row.logged_at,
  }
}
