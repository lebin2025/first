/**
 * 日期工具：全部以「本地日期字符串 yyyy-MM-dd」作为业务主键，
 * 避免 new Date('2026-10-23') 被解析成 UTC 造成的跨时区偏移。
 */

export const DAY_MS = 24 * 60 * 60 * 1000

/** 把 Date 转成本地日期字符串 */
export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 本地零点，解析失败时回退到今天 */
export function parseISODate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return startOfDay(new Date())
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return new Date(year, month - 1, day)
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function todayISO(): string {
  return toISODate(new Date())
}

/** 日期加减天数 */
export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso)
  date.setDate(date.getDate() + days)
  return toISODate(date)
}

/** 返回 to - from 的天数差（可为负） */
export function diffDays(from: string, to: string): number {
  const a = parseISODate(from).getTime()
  const b = parseISODate(to).getTime()
  return Math.round((b - a) / DAY_MS)
}

/** 是否周末 */
export function isWeekend(iso: string): boolean {
  const day = parseISODate(iso).getDay()
  return day === 0 || day === 6
}

/** 今天 → 目标日期的剩余天数（含今天则 +1，业务层自行决定） */
export function daysUntil(deadline: string, today: string = todayISO()): number {
  return diffDays(today, deadline)
}

/** 10月23日 */
export function formatCN(iso: string): string {
  if (!iso) return '未设置'
  const date = parseISODate(iso)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** 2026年10月23日 */
export function formatCNFull(iso: string): string {
  if (!iso) return '未设置'
  const date = parseISODate(iso)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/** 周一 / 周二 … */
export function weekdayLabel(iso: string): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseISODate(iso).getDay()] ?? '周一'
}

/** 相对日期标签：今天 / 明天 / 昨天 / 10月23日 */
export function relativeDayLabel(iso: string, today: string = todayISO()): string {
  const delta = diffDays(today, iso)
  if (delta === 0) return '今天'
  if (delta === 1) return '明天'
  if (delta === -1) return '昨天'
  return formatCN(iso)
}

/** 分钟 → 1 小时 25 分钟 */
export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  const h = Math.floor(safe / 60)
  const m = safe % 60
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分钟`
}

/** 分钟 → 01:25 形式的钟表文本 */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const mm = `${m}`.padStart(2, '0')
  const ss = `${s}`.padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 判断是否是合法日期字符串 */
export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = parseISODate(value)
  return !Number.isNaN(date.getTime()) && toISODate(date) === value
}

/** 从 ISO 时间戳取出本地日期 */
export function isoDateTimeToDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? todayISO() : toISODate(date)
}

/** 两个日期之间（含头含尾）的所有日期 */
export function eachDay(from: string, to: string): string[] {
  const result: string[] = []
  const span = diffDays(from, to)
  for (let i = 0; i <= span; i += 1) result.push(addDays(from, i))
  return result
}
