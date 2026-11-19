import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import type { AttendanceStatus, CorrectionStatus } from '@/types'

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

const tones: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
  success: 'bg-success-50 text-success-700 ring-success-100',
  warning: 'bg-warning-50 text-warning-700 ring-warning-100',
  danger: 'bg-danger-50 text-danger-700 ring-danger-100',
  info: 'bg-info-50 text-info-700 ring-info-100',
}

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: Tone
  dot?: boolean
}

export function Badge({
  className,
  tone = 'neutral',
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  )
}

const attendanceTones: Record<AttendanceStatus, Tone> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  on_leave: 'info',
  holiday: 'brand',
  rest_day: 'neutral',
}

const attendanceLabels: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  on_leave: 'On leave',
  holiday: 'Holiday',
  rest_day: 'Rest day',
}

export function AttendanceBadge({ status }: { status: AttendanceStatus }) {
  return (
    <Badge tone={attendanceTones[status]} dot>
      {attendanceLabels[status]}
    </Badge>
  )
}

const correctionTones: Record<CorrectionStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
}

export function CorrectionBadge({ status }: { status: CorrectionStatus }) {
  return (
    <Badge tone={correctionTones[status]} dot>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}
