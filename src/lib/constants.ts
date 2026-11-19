import type {
  AttendanceStatus,
  CorrectionStatus,
  CorrectionType,
  EmploymentType,
  HolidayType,
  UserRole,
} from '@/types'

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  supervisor: 'Supervisor',
  employee: 'Employee',
}

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  regular: 'Regular',
  probationary: 'Probationary',
  contractual: 'Contractual',
  part_time: 'Part-time',
  intern: 'Intern',
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  on_leave: 'On leave',
  holiday: 'Holiday',
  rest_day: 'Rest day',
}

export const CORRECTION_TYPE_LABELS: Record<CorrectionType, string> = {
  missing_time_in: 'Missing time-in',
  missing_time_out: 'Missing time-out',
  incorrect_time: 'Incorrect timestamp',
  other: 'Other',
}

export const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  regular: 'Regular holiday',
  special_non_working: 'Special non-working',
  special_working: 'Special working',
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export const PASSWORD_MIN_LENGTH = 12
