import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a number of minutes as "8h 30m" (or "—" when null/undefined). */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—'
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(Math.round(minutes))
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  if (hours === 0) return `${sign}${mins}m`
  if (mins === 0) return `${sign}${hours}h`
  return `${sign}${hours}h ${mins}m`
}

/** Format decimal hours as "8h 30m" (or "—"). */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—'
  return formatMinutes(hours * 60)
}

/** "Juan Dela Cruz" initials → "JD". */
export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

/** Build a display name while tolerating missing parts. */
export function fullName(
  person: { first_name?: string | null; last_name?: string | null } | null | undefined,
): string {
  if (!person) return '—'
  return [person.first_name, person.last_name].filter(Boolean).join(' ') || '—'
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

/** Round to 2 decimals without floating-point drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** Human-friendly error text from unknown thrown values. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return 'An unexpected error occurred. Please try again.'
}
