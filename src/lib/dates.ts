import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * The system stores every timestamp as UTC (`timestamptz`) and renders in the
 * organization's timezone. All helpers here funnel through these constants so
 * there is exactly one definition of "today".
 */
export const APP_TIMEZONE = import.meta.env.VITE_TIMEZONE || 'Asia/Manila'

export const DATE_KEY_FORMAT = 'yyyy-MM-dd'
export const TIME_FORMAT = 'hh:mm a'
export const DATE_FORMAT = 'MMM d, yyyy'
export const DATETIME_FORMAT = 'MMM d, yyyy hh:mm a'
export const MONTH_FORMAT = 'MMMM yyyy'

/** Current instant. */
export function nowUtc(): Date {
  return new Date()
}

/** Calendar date (yyyy-MM-dd) for an instant in app timezone. */
export function dateKey(date: Date = new Date()): string {
  return formatInTimeZone(date, APP_TIMEZONE, DATE_KEY_FORMAT)
}

/** Current calendar date in the app timezone. */
export function todayKey(): string {
  return dateKey(new Date())
}

/** "08:00:00" / "08:00" against today's date in app timezone → UTC Date. */
export function timeOnDateToUtc(dayKey: string, time: string): Date {
  const normalized = time.length === 5 ? `${time}:00` : time
  return fromZonedTime(`${dayKey}T${normalized}`, APP_TIMEZONE)
}

/** UTC instant → wall-clock time string in app timezone. */
export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return formatInTimeZone(new Date(value), APP_TIMEZONE, TIME_FORMAT)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return formatInTimeZone(new Date(value), APP_TIMEZONE, DATE_FORMAT)
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return formatInTimeZone(new Date(value), APP_TIMEZONE, DATETIME_FORMAT)
}

/** A date-only column ("2026-05-01") should never shift by timezone; render as-is. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—'
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return value
  return formatInTimeZone(new Date(Date.UTC(y, m - 1, d, 12)), 'UTC', DATE_FORMAT)
}

export function formatMonth(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T12:00:00Z`) : value
  return formatInTimeZone(date, 'UTC', MONTH_FORMAT)
}

/** Minutes elapsed between two instants (never negative). */
export function minutesBetween(start: string | Date, end: string | Date): number {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return ms > 0 ? Math.round(ms / 60_000) : 0
}

/**
 * Minutes between a UTC instant and a wall-clock time on the same app-timezone
 * day. Handles overnight schedules by optionally rolling the end time forward.
 */
export function minutesFromWallClock(
  instant: string | Date,
  wallClock: string,
  options: { rollToNextDay?: boolean } = {},
): number {
  const dayKey = formatInTimeZone(new Date(instant), APP_TIMEZONE, DATE_KEY_FORMAT)
  let target = timeOnDateToUtc(dayKey, wallClock)
  if (options.rollToNextDay && target.getTime() < new Date(instant).getTime() - 12 * 3600_000) {
    target = new Date(target.getTime() + 24 * 3600_000)
  }
  return minutesBetween(instant, target)
}

/** Enumerate inclusive yyyy-MM-dd keys between two days. */
export function eachDayKey(startKey: string, endKey: string): string[] {
  const out: string[] = []
  const cursor = new Date(`${startKey}T12:00:00Z`)
  const end = new Date(`${endKey}T12:00:00Z`)
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

/** Start/end (UTC ISO) of a calendar month in app timezone. */
export function monthRange(year: number, month: number): { start: string; end: string } {
  const startKey = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const endKey = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return {
    start: fromZonedTime(`${startKey}T00:00:00`, APP_TIMEZONE).toISOString(),
    end: fromZonedTime(`${endKey}T23:59:59.999`, APP_TIMEZONE).toISOString(),
  }
}

/** Day keys for the given ISO week (Monday-first) containing `date`. */
export function weekDayKeys(date: Date = new Date()): string[] {
  const isoDay = Number(formatInTimeZone(date, APP_TIMEZONE, 'i')) // 1 = Monday … 7 = Sunday
  const monday = new Date(date.getTime() - (isoDay - 1) * 24 * 3600_000)
  return Array.from({ length: 7 }, (_, i) =>
    formatInTimeZone(new Date(monday.getTime() + i * 24 * 3600_000), APP_TIMEZONE, DATE_KEY_FORMAT),
  )
}

export function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}
