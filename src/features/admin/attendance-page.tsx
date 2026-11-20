import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarSearch, Download, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { AttendanceBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'
import { TableSkeleton } from '@/components/ui/spinner'
import { useAuth } from '@/features/auth/auth-context'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/components/ui/table'
import { getSupabase } from '@/lib/supabase'
import { formatDateOnly, formatTime, todayKey } from '@/lib/dates'
import { errorMessage, formatMinutes, pluralize } from '@/lib/utils'
import { useScheduleScope } from '@/features/schedule/schedule-scope-context'
import type { AttendanceListItem, AttendancePage, EmployeeListItem, EmployeePage } from '@/types'

function monthStart(): string {
  return `${todayKey().slice(0, 7)}-01`
}

function friendly(message: string): string {
  if (message.includes('delete_attendance_record')) {
    return 'The database is missing the attendance delete migration. Apply 20261119001700_delete_attendance.sql, then reload.'
  }
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The database is missing the DTR migration. Apply 20261119000900_dtr.sql, then reload.'
  }
  if (message.includes('INVALID_PERIOD')) return 'The end date must be on or after the start date.'
  if (message.includes('REASON_REQUIRED')) return 'Give a reason of at least 5 characters.'
  if (message.includes('OPEN_SESSION_EXISTS')) {
    return 'This day still has an open time-in. Time out first, then delete it.'
  }
  if (message.includes('PENDING_CORRECTION')) {
    return 'There is a pending correction for this day. Approve or reject it first.'
  }
  if (message.includes('ATTENDANCE_NOT_FOUND'))
    return 'That record no longer exists. Refresh the list.'
  if (message.includes('FORBIDDEN'))
    return 'Only administrators and supervisors can view all attendance.'
  return message
}

export function AttendancePage() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const { scheduleId, setScheduleId, schedules, activeSchedule } = useScheduleScope()
  const [start, setStart] = useState(monthStart)
  const [end, setEnd] = useState(todayKey)
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [data, setData] = useState<AttendancePage | null>(null)
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AttendanceListItem | null>(null)
  const [reason, setReason] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: result, error: rpcError } = await getSupabase().rpc('list_attendance', {
        p_start: start,
        p_end: end,
        p_employee_id: employeeFilter || null,
        p_page: page,
        p_page_size: pageSize,
        p_schedule_id: scheduleId || null,
      })
      if (rpcError) throw rpcError
      setData(result as AttendancePage)
    } catch (caught) {
      setError(friendly(errorMessage(caught)))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [start, end, employeeFilter, page, pageSize, scheduleId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let active = true
    void getSupabase()
      .rpc('list_employees', {
        p_search: null,
        p_status: null,
        p_schedule_id: null,
        p_page: 1,
        p_page_size: 100,
      })
      .then(({ data: result, error: rpcError }) => {
        if (!active || rpcError) return
        setEmployees((result as EmployeePage).items)
      })
    return () => {
      active = false
    }
  }, [])

  const items = data?.items ?? []

  async function deleteRecord() {
    if (!deleteTarget) return
    if (reason.trim().length < 5) {
      setDeleteError('Give a reason of at least 5 characters.')
      return
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      const { error: rpcError } = await getSupabase().rpc('delete_attendance_record', {
        p_record_id: deleteTarget.id,
        p_reason: reason.trim(),
      })
      if (rpcError) throw rpcError
      setNotice(
        `Deleted ${deleteTarget.employee_name}'s record for ${formatDateOnly(deleteTarget.work_date)}.`,
      )
      setDeleteTarget(null)
      setReason('')
      await load()
    } catch (caught) {
      setDeleteError(friendly(errorMessage(caught)))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Attendance records"
        description="Every saved day across the organization. Open a student's DTR to print or export it."
        actions={
          <Button variant="outline" onClick={() => void load()} loading={loading}>
            {loading ? null : <RefreshCw aria-hidden />}
            Refresh
          </Button>
        }
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Attendance problem">
          {error}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From" htmlFor="attendance-start">
            <Input
              id="attendance-start"
              type="date"
              value={start}
              max={end}
              onChange={(event) => {
                setStart(event.target.value)
                setPage(1)
              }}
            />
          </Field>
          <Field label="To" htmlFor="attendance-end">
            <Input
              id="attendance-end"
              type="date"
              value={end}
              min={start}
              onChange={(event) => {
                setEnd(event.target.value)
                setPage(1)
              }}
            />
          </Field>
          <Field label="Student" htmlFor="attendance-employee">
            <Select
              id="attendance-employee"
              value={employeeFilter}
              onChange={(event) => {
                setEmployeeFilter(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All students</option>
              {employees.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.last_name}, {item.first_name} · {item.employee_no}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Schedule" htmlFor="attendance-schedule">
            <Select
              id="attendance-schedule"
              value={scheduleId}
              onChange={(event) => {
                setScheduleId(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All schedules</option>
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <p className="text-ink-500 text-xs">
              {loading
                ? 'Loading…'
                : `${pluralize(data?.total ?? 0, 'record')}${
                    activeSchedule ? ` in ${activeSchedule.name}` : ''
                  }`}
            </p>
          </div>
        </CardContent>
      </Card>

      {error && items.length === 0 ? (
        <ErrorState
          title="Could not load attendance"
          description={error}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : loading && items.length === 0 ? (
        <TableWrapper>
          <TableSkeleton rows={8} columns={8} />
        </TableWrapper>
      ) : items.length === 0 ? (
        <EmptyState
          icon={CalendarSearch}
          title="No attendance in this period"
          description="Change the dates or clear the student filter. Punches appear here as soon as students time in."
        />
      ) : (
        <>
          <div className="space-y-2 sm:hidden">
            {items.map((item) => (
              <div
                key={item.id}
                className="surface-dark border-ink-200/80 shadow-card bg-surface rounded-xl border p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-ink-900 truncate text-sm font-semibold">
                      {item.employee_name}
                    </p>
                    <p className="text-ink-500 numeric mt-0.5 text-xs">
                      {formatDateOnly(item.work_date)} · {item.employee_no}
                    </p>
                  </div>
                  <AttendanceBadge status={item.status} />
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="numeric text-ink-700 text-xs">
                    {formatTime(item.first_time_in)} –{' '}
                    {item.last_time_out ? (
                      formatTime(item.last_time_out)
                    ) : (
                      <span className="text-success-700 font-medium">Open</span>
                    )}
                  </p>
                  <p className="numeric text-ink-900 text-sm font-semibold">
                    {formatMinutes(item.worked_minutes)}
                  </p>
                </div>

                {item.late_minutes || item.undertime_minutes || item.overtime_minutes ? (
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    {item.late_minutes > 0 ? (
                      <span className="text-warning-700">
                        Late {formatMinutes(item.late_minutes)}
                      </span>
                    ) : null}
                    {item.undertime_minutes > 0 ? (
                      <span className="text-danger-700">
                        Under {formatMinutes(item.undertime_minutes)}
                      </span>
                    ) : null}
                    {item.overtime_minutes > 0 ? (
                      <span className="text-success-700">
                        Over {formatMinutes(item.overtime_minutes)}
                      </span>
                    ) : null}
                  </p>
                ) : null}

                <div className="border-ink-100 mt-3 flex items-center justify-between gap-2 border-t pt-2.5">
                  <Link
                    to={`/admin/dtr?employee=${item.employee_id}&month=${item.work_date.slice(0, 7)}`}
                    className="text-brand-700 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                  >
                    Open DTR
                    <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                  {isAdmin ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger-600 hover:bg-danger-50"
                      aria-label={`Delete ${item.employee_name} on ${item.work_date}`}
                      onClick={() => {
                        setDeleteError(null)
                        setReason('')
                        setDeleteTarget(item)
                      }}
                    >
                      <Trash2 aria-hidden />
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <TableWrapper className="hidden sm:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Time in</TableHeaderCell>
                  <TableHeaderCell>Time out</TableHeaderCell>
                  <TableHeaderCell className="text-right">Worked</TableHeaderCell>
                  <TableHeaderCell className="text-right">Late</TableHeaderCell>
                  <TableHeaderCell className="text-right">Under</TableHeaderCell>
                  <TableHeaderCell className="text-right">Over</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell className="text-right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="numeric font-medium">
                      {formatDateOnly(item.work_date)}
                    </TableCell>
                    <TableCell>
                      <p className="text-ink-900 font-medium">{item.employee_name}</p>
                      <p className="text-ink-500 numeric text-xs">{item.employee_no}</p>
                    </TableCell>
                    <TableCell className="numeric">{formatTime(item.first_time_in)}</TableCell>
                    <TableCell className="numeric">
                      {item.last_time_out ? (
                        formatTime(item.last_time_out)
                      ) : (
                        <span className="text-success-700 font-medium">Open</span>
                      )}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatMinutes(item.worked_minutes)}
                    </TableCell>
                    <TableCell className="numeric text-warning-700 text-right">
                      {item.late_minutes ? formatMinutes(item.late_minutes) : '—'}
                    </TableCell>
                    <TableCell className="numeric text-danger-700 text-right">
                      {item.undertime_minutes ? formatMinutes(item.undertime_minutes) : '—'}
                    </TableCell>
                    <TableCell className="numeric text-success-700 text-right">
                      {item.overtime_minutes ? formatMinutes(item.overtime_minutes) : '—'}
                    </TableCell>
                    <TableCell>
                      <AttendanceBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-3">
                        <Link
                          to={`/admin/dtr?employee=${item.employee_id}&month=${item.work_date.slice(0, 7)}`}
                          className="text-brand-700 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                        >
                          Open
                          <ExternalLink className="size-3.5" aria-hidden />
                        </Link>
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-danger-600 hover:bg-danger-50 size-8"
                            aria-label={`Delete ${item.employee_name} on ${item.work_date}`}
                            onClick={() => {
                              setDeleteError(null)
                              setReason('')
                              setDeleteTarget(item)
                            }}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />

          <p className="text-ink-400 flex items-center gap-1.5 text-xs">
            <Download className="size-3.5" aria-hidden />
            Open a student DTR to download PDF, Excel, or CSV.
          </p>
        </>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        title="Delete attendance day"
        description={
          deleteTarget
            ? `${deleteTarget.employee_name} · ${formatDateOnly(deleteTarget.work_date)}`
            : undefined
        }
        size="sm"
        preventClose={deleting}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void deleteRecord()}
              loading={deleting}
              disabled={reason.trim().length < 5}
            >
              Delete day
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {deleteError ? (
            <Alert tone="danger" title="Could not delete the day">
              {deleteError}
            </Alert>
          ) : null}

          <p className="text-ink-700 text-sm">
            The day disappears from the DTR, dashboard counts, and exports. The deleted punch and
            its sessions are copied into the audit trail first.
          </p>

          <Field label="Reason" htmlFor="delete-attendance-reason" required>
            <Input
              id="delete-attendance-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Test punch during setup"
              maxLength={200}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
