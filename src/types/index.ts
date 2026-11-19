/** Shared domain types. These mirror the Postgres schema in supabase/migrations. */

export type UserRole = 'admin' | 'supervisor' | 'employee'
export type AccountStatus = 'active' | 'inactive' | 'archived'
export type EmploymentType = 'regular' | 'probationary' | 'contractual' | 'part_time' | 'intern'
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'on_leave' | 'holiday' | 'rest_day'
export type SessionType = 'morning' | 'afternoon' | 'evening' | 'custom'
export type CorrectionType = 'missing_time_in' | 'missing_time_out' | 'incorrect_time' | 'other'
export type CorrectionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type HolidayType = 'regular' | 'special_non_working' | 'special_working'

export interface Profile {
  id: string
  role: UserRole
  full_name: string
  email: string
  phone: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Department {
  id: string
  name: string
  code: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SchedulePeriod {
  id: string
  schedule_id: string
  label: string
  start_time: string
  end_time: string
  sort_order: number
}

export interface WorkSchedule {
  id: string
  name: string
  description: string | null
  timezone: string
  grace_minutes: number
  work_days: number[]
  is_active: boolean
  created_at: string
  updated_at: string
  periods?: SchedulePeriod[]
  assigned_count?: number
  attendance_days?: number
  is_mine?: boolean
}

/** Trimmed schedule returned inside `get_my_day()`. */
export interface DaySchedule {
  id: string
  name: string
  timezone: string
  grace_minutes: number
  work_days: number[]
  periods: SchedulePeriod[]
}

/** Response of the `get_my_day()` RPC. */
export interface MyDay {
  work_date: string
  record: AttendanceRecord | null
  sessions: AttendanceSession[]
  schedule: DaySchedule | null
  employee_id: string
  employee_name: string
  schedule_id: string | null
  is_work_day: boolean
  holiday: Holiday | null
  open_session: AttendanceSession | null
  server_time: string
}

export interface Employee {
  id: string
  profile_id: string
  employee_no: string
  first_name: string
  middle_name: string | null
  last_name: string
  email: string
  department_id: string | null
  position: string | null
  employment_type: EmploymentType
  date_hired: string
  schedule_id: string | null
  supervisor_id: string | null
  status: AccountStatus
  approved_at: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
  department?: Pick<Department, 'id' | 'name' | 'code'> | null
  schedule?: Pick<WorkSchedule, 'id' | 'name'> | null
  supervisor?: Pick<Employee, 'id' | 'first_name' | 'last_name'> | null
}

/** Employee payload returned by the `get_my_context()` RPC. */
export interface ContextEmployee {
  id: string
  employee_no: string
  first_name: string
  middle_name: string | null
  last_name: string
  email: string
  position: string | null
  employment_type: EmploymentType
  date_hired: string
  status: AccountStatus
  approved_at: string | null
  approved_by: string | null
  department: Pick<Department, 'id' | 'name' | 'code'> | null
  schedule:
    | (Pick<WorkSchedule, 'id' | 'name' | 'timezone' | 'grace_minutes' | 'work_days'> & {
        periods: SchedulePeriod[]
      })
    | null
}

/** Everything the signed-in account is allowed to know about itself. */
export interface MyContext {
  profile: Profile
  employee: ContextEmployee | null
  open_session: AttendanceSession | null
  server_time: string
}

/**
 * Where an account sits in the onboarding lifecycle.
 * - needs_onboarding: signed in, but no employee record yet
 * - pending: profile submitted and waiting for administrator approval
 * - active: approved and allowed to use the workspace
 * - inactive: account deactivated or archived
 */
export type OnboardingState = 'needs_onboarding' | 'pending' | 'active' | 'inactive'

export interface OnboardingRequest {
  employee_id: string
  employee_no: string
  full_name: string
  email: string
  position: string | null
  submitted_at: string
  schedule_name: string | null
}

/** Result of `get_onboarding_settings()`. */
export interface OnboardingSettings {
  auto_approve_onboarding: boolean
  updated_at: string | null
  updated_by: string | null
  pending_count: number
}

export interface AttendanceSession {
  id: string
  attendance_record_id: string
  employee_id: string
  work_date: string
  session_type: SessionType
  time_in: string
  time_out: string | null
  worked_minutes: number | null
  is_open: boolean
  source: 'web' | 'manual' | 'correction'
  created_at: string
  updated_at: string
}

export interface AttendanceRecord {
  id: string
  employee_id: string
  work_date: string
  schedule_id: string | null
  first_time_in: string | null
  last_time_out: string | null
  worked_minutes: number
  late_minutes: number
  undertime_minutes: number
  overtime_minutes: number
  status: AttendanceStatus
  remarks: string | null
  is_locked: boolean
  created_at: string
  updated_at: string
  sessions?: AttendanceSession[]
  employee?: Pick<Employee, 'id' | 'employee_no' | 'first_name' | 'last_name'> | null
}

export interface AttendanceCorrection {
  id: string
  employee_id: string
  attendance_record_id: string | null
  work_date: string
  correction_type: CorrectionType
  requested_time_in: string | null
  requested_time_out: string | null
  reason: string
  status: CorrectionStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  applied_at: string | null
  created_at: string
  employee?: Pick<Employee, 'id' | 'employee_no' | 'first_name' | 'last_name'> | null
}

export interface Holiday {
  id: string
  name: string
  holiday_date: string
  holiday_type: HolidayType
  is_paid: boolean
  created_at: string
}

export interface AuditLog {
  id: number
  actor_id: string | null
  actor_role: UserRole | null
  action: string
  entity_type: string
  entity_id: string | null
  summary: string | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  created_at: string
}

/** One row of `list_audit_logs()`. */
export interface AuditLogItem extends AuditLog {
  actor_name: string | null
}

export interface AuditLogPage {
  items: AuditLogItem[]
  total: number
  page: number
  page_size: number
}

/** Response of `admin_dashboard()`. */
export interface AdminDashboard {
  date: string
  server_time: string
  total_employees: number
  present_today: number
  late_today: number
  absent_today: number
  currently_working: number
  worked_minutes_today: number
  pending_onboarding: number
  pending_corrections: number
  trend: Array<{ day: string; present: number; late: number; minutes: number }>
  recent: Array<{
    employee_id: string
    employee_no: string
    employee_name: string
    time_in: string
    time_out: string | null
    work_date: string
  }>
  departments: Array<{ department: string; count: number }>
}

export interface DtrRow {
  work_date: string
  record: AttendanceRecord | null
  sessions: AttendanceSession[]
  is_work_day: boolean
  holiday: Pick<Holiday, 'name' | 'holiday_type' | 'is_paid'> | null
}

/** Response of `get_dtr()`. */
export interface DtrPayload {
  employee: {
    id: string
    employee_no: string
    full_name: string
    department: string | null
    position: string | null
    schedule: string | null
    timezone: string
  }
  period: { start: string; end: string; label: string }
  rows: DtrRow[]
  totals: {
    worked_minutes: number
    late_minutes: number
    undertime_minutes: number
    overtime_minutes: number
    days_present: number
  }
  server_time: string
}

/** One row of `list_employees()`. */
export interface EmployeeListItem {
  id: string
  employee_no: string
  first_name: string
  middle_name: string | null
  last_name: string
  email: string
  position: string | null
  employment_type: EmploymentType
  date_hired: string
  status: AccountStatus
  approved_at: string | null
  department_id: string | null
  department: Pick<Department, 'id' | 'name' | 'code'> | null
  schedule_id: string | null
  schedule: Pick<WorkSchedule, 'id' | 'name'> | null
  supervisor_id: string | null
}

export interface EmployeePage {
  items: EmployeeListItem[]
  total: number
  page: number
  page_size: number
}

/** One row of `list_attendance()`. */
export interface AttendanceListItem {
  id: string
  employee_id: string
  employee_no: string
  employee_name: string
  work_date: string
  schedule_id: string | null
  first_time_in: string | null
  last_time_out: string | null
  worked_minutes: number
  late_minutes: number
  undertime_minutes: number
  overtime_minutes: number
  status: AttendanceStatus
  remarks: string | null
}

export interface AttendancePage {
  items: AttendanceListItem[]
  total: number
  page: number
  page_size: number
}

/** One row of `list_corrections()` / `list_my_corrections()`. */
export interface CorrectionListItem {
  id: string
  employee_id: string
  employee_no: string
  employee_name: string
  work_date: string
  correction_type: CorrectionType
  requested_time_in: string | null
  requested_time_out: string | null
  reason: string
  status: CorrectionStatus
  review_notes: string | null
  reviewed_at: string | null
  created_at: string
}

export type Result<T> = { data: T; error: null } | { data: null; error: string }
