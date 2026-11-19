import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  CalendarClock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Users,
  UserX,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Field, Textarea } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'
import { TableSkeleton } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/components/ui/table'
import { useAuth } from '@/features/auth/auth-context'
import { useScheduleScope } from '@/features/schedule/schedule-scope-context'
import { getSupabase } from '@/lib/supabase'
import { DEFAULT_PAGE_SIZE, EMPLOYMENT_TYPE_LABELS } from '@/lib/constants'
import { formatDateOnly } from '@/lib/dates'
import { errorMessage, pluralize } from '@/lib/utils'
import type {
  Department,
  EmployeeListItem,
  EmployeePage,
  EmploymentType,
  WorkSchedule,
} from '@/types'

type DepartmentRow = Department & { employee_count: number }

type EditDraft = {
  id: string
  first_name: string
  middle_name: string
  last_name: string
  position: string
  department_id: string
  employment_type: EmploymentType
  date_hired: string
  supervisor_id: string
}

type StatusAction = { employee: EmployeeListItem; status: 'active' | 'inactive' | 'archived' }

const EMPLOYMENT_TYPES = Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]

function friendly(message: string): string {
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The database is missing the employee-management migration. Apply 20261119000800_dashboard_and_employees.sql, then reload.'
  }
  if (message.includes('OPEN_SESSION')) {
    return 'This student has an open time-in. Ask them to time out before deactivating the account.'
  }
  if (message.includes('NOT_APPROVED')) {
    return 'Approve this student through the OJT approvals page first.'
  }
  if (message.includes('FORBIDDEN')) return 'Only administrators can manage employees.'
  return message
}

function statusTone(status: EmployeeListItem['status']) {
  if (status === 'active') return 'success' as const
  if (status === 'inactive') return 'warning' as const
  return 'neutral' as const
}

export function EmployeesPage() {
  const { employee: ownEmployee } = useAuth()
  const [items, setItems] = useState<EmployeeListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const { scheduleId, setScheduleId } = useScheduleScope()
  const [status, setStatus] = useState('')
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [edit, setEdit] = useState<EditDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [statusAction, setStatusAction] = useState<StatusAction | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [scheduleTarget, setScheduleTarget] = useState<EmployeeListItem | null>(null)
  const [scheduleChoice, setScheduleChoice] = useState('')
  const [scheduleBusy, setScheduleBusy] = useState(false)

  const [departmentModalOpen, setDepartmentModalOpen] = useState(false)
  const [newDepartment, setNewDepartment] = useState({ name: '', code: '' })
  const [departmentBusy, setDepartmentBusy] = useState(false)
  const [departmentError, setDepartmentError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('list_employees', {
        p_search: debouncedSearch || null,
        p_status: status || null,
        p_schedule_id: scheduleId || null,
        p_page: page,
        p_page_size: pageSize,
      })
      if (rpcError) throw rpcError
      const result = data as EmployeePage
      setItems(result.items)
      setTotal(result.total)
    } catch (caught) {
      setError(friendly(errorMessage(caught)))
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, status, scheduleId, page, pageSize])

  const loadReference = useCallback(async () => {
    try {
      const [schedulesResult, departmentsResult] = await Promise.all([
        getSupabase().rpc('list_work_schedules'),
        getSupabase().rpc('list_departments'),
      ])
      if (!schedulesResult.error) {
        setSchedules((schedulesResult.data as WorkSchedule[]) ?? [])
      }
      if (!departmentsResult.error) {
        setDepartments((departmentsResult.data as DepartmentRow[]) ?? [])
      }
    } catch {
      // Reference data is optional for the directory to render.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadReference()
  }, [loadReference])

  function openEdit(item: EmployeeListItem) {
    setEdit({
      id: item.id,
      first_name: item.first_name,
      middle_name: item.middle_name ?? '',
      last_name: item.last_name,
      position: item.position ?? '',
      department_id: item.department_id ?? '',
      employment_type: item.employment_type,
      date_hired: item.date_hired,
      supervisor_id: item.supervisor_id ?? '',
    })
    setFormError(null)
  }

  async function saveEdit() {
    if (!edit) return
    setFormError(null)
    if (!edit.first_name.trim() || !edit.last_name.trim()) {
      setFormError('First name and last name are required.')
      return
    }

    setSaving(true)
    try {
      const { error: rpcError } = await getSupabase().rpc('update_employee', {
        p_employee_id: edit.id,
        p_first_name: edit.first_name.trim(),
        p_middle_name: edit.middle_name.trim() || null,
        p_last_name: edit.last_name.trim(),
        p_position: edit.position.trim() || null,
        p_department_id: edit.department_id || null,
        p_employment_type: edit.employment_type,
        p_date_hired: edit.date_hired || null,
        p_supervisor_id: edit.supervisor_id || null,
      })
      if (rpcError) throw rpcError
      setEdit(null)
      setNotice('Employee details saved.')
      await load()
    } catch (caught) {
      setFormError(friendly(errorMessage(caught)))
    } finally {
      setSaving(false)
    }
  }

  function openStatus(item: EmployeeListItem, next: StatusAction['status']) {
    setStatusAction({ employee: item, status: next })
    setStatusReason('')
    setStatusError(null)
  }

  async function applyStatus() {
    if (!statusAction) return
    const reason = statusReason.trim()
    if (statusAction.status !== 'active' && reason.length < 5) {
      setStatusError('Give a short reason (at least 5 characters).')
      return
    }

    setStatusBusy(true)
    setStatusError(null)
    try {
      const { error: rpcError } = await getSupabase().rpc('set_employee_status', {
        p_employee_id: statusAction.employee.id,
        p_status: statusAction.status,
        p_reason: reason || null,
      })
      if (rpcError) throw rpcError
      setNotice(
        `${statusAction.employee.first_name} ${statusAction.employee.last_name} is now ${statusAction.status}.`,
      )
      setStatusAction(null)
      await load()
    } catch (caught) {
      setStatusError(friendly(errorMessage(caught)))
    } finally {
      setStatusBusy(false)
    }
  }

  function openSchedule(item: EmployeeListItem) {
    setScheduleTarget(item)
    setScheduleChoice(item.schedule_id ?? schedules[0]?.id ?? '')
  }

  async function applySchedule() {
    if (!scheduleTarget || !scheduleChoice) return
    setScheduleBusy(true)
    try {
      const { error: rpcError } = await getSupabase().rpc('assign_schedule', {
        p_employee_id: scheduleTarget.id,
        p_schedule_id: scheduleChoice,
      })
      if (rpcError) throw rpcError
      const scheduleName =
        schedules.find((schedule) => schedule.id === scheduleChoice)?.name ?? 'the schedule'
      setNotice(`${scheduleTarget.first_name} was assigned to ${scheduleName}.`)
      setScheduleTarget(null)
      await load()
    } catch (caught) {
      setError(friendly(errorMessage(caught)))
    } finally {
      setScheduleBusy(false)
    }
  }

  async function createDepartment() {
    setDepartmentError(null)
    if (newDepartment.name.trim().length < 2) {
      setDepartmentError('Department name must be at least 2 characters.')
      return
    }
    if (!/^[A-Za-z0-9-]{2,12}$/.test(newDepartment.code.trim())) {
      setDepartmentError('Use a 2–12 character code with letters, numbers, or hyphens.')
      return
    }

    setDepartmentBusy(true)
    try {
      const { error: rpcError } = await getSupabase().rpc('create_department', {
        p_name: newDepartment.name.trim(),
        p_code: newDepartment.code.trim().toUpperCase(),
      })
      if (rpcError) throw rpcError
      setDepartmentModalOpen(false)
      setNewDepartment({ name: '', code: '' })
      setNotice('Department created.')
      await loadReference()
    } catch (caught) {
      const message = errorMessage(caught)
      setDepartmentError(
        message.includes('DEPARTMENT_CODE_TAKEN')
          ? 'That department code is already in use.'
          : friendly(message),
      )
    } finally {
      setDepartmentBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Employees"
        description="Student and staff records, schedules, departments, and account status. Every change is written to the audit trail."
        actions={
          <>
            <Button variant="outline" onClick={() => setDepartmentModalOpen(true)}>
              <Building2 aria-hidden />
              New department
            </Button>
            <Button variant="outline" onClick={() => void load()} loading={loading}>
              {loading ? null : <RefreshCw aria-hidden />}
              Refresh
            </Button>
          </>
        }
      />

      {notice ? (
        <Alert tone="success" title="Saved">
          {notice}
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Employee problem">
          {error}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-sm">
            <Search
              className="text-ink-400 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, number, or email"
              aria-label="Search employees"
              className="pl-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
              }}
              aria-label="Filter by status"
              className="sm:w-40"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </Select>
            <Select
              value={scheduleId}
              onChange={(event) => {
                setScheduleId(event.target.value)
                setPage(1)
              }}
              aria-label="Filter by schedule"
              className="sm:w-48"
            >
              <option value="">All schedules</option>
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </Select>
          </div>

          <p className="text-ink-500 ml-auto text-xs">
            {loading ? 'Loading…' : pluralize(total, 'record')}
          </p>
        </CardContent>
      </Card>

      {error && items.length === 0 ? (
        <ErrorState
          title="Could not load employees"
          description={error}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : loading && items.length === 0 ? (
        <TableWrapper>
          <TableSkeleton rows={6} columns={6} />
        </TableWrapper>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No employees match"
          description="Try a different search or filter. New students appear after they complete onboarding."
        />
      ) : (
        <>
          <div className="space-y-2 sm:hidden">
            {items.map((item) => {
              const isSelf = ownEmployee?.id === item.id
              return (
                <div
                  key={item.id}
                  className="border-ink-200/80 shadow-card rounded-xl border bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-ink-900 truncate text-sm font-semibold">
                        {item.first_name} {item.last_name}
                        {isSelf ? <span className="text-ink-400 ml-1.5 text-xs">(you)</span> : null}
                      </p>
                      <p className="text-ink-500 mt-0.5 truncate text-xs">
                        <span className="numeric">{item.employee_no}</span> · {item.email}
                      </p>
                    </div>
                    <Badge tone={statusTone(item.status)} dot>
                      {item.status}
                    </Badge>
                  </div>

                  <dl className="text-ink-600 mt-2.5 space-y-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-500">Position</dt>
                      <dd className="truncate">{item.position ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-500">Department</dt>
                      <dd className="truncate">{item.department?.name ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-500">Schedule</dt>
                      <dd className="truncate">{item.schedule?.name ?? 'Unassigned'}</dd>
                    </div>
                  </dl>

                  <div className="border-ink-100 mt-3 flex flex-wrap gap-1 border-t pt-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                      <Pencil aria-hidden />
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openSchedule(item)}>
                      <CalendarClock aria-hidden />
                      Schedule
                    </Button>
                    {item.status === 'active' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger-700 hover:bg-danger-50"
                        onClick={() => openStatus(item, 'inactive')}
                        disabled={isSelf}
                      >
                        <UserX aria-hidden />
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-success-700 hover:bg-success-50"
                        onClick={() => openStatus(item, 'active')}
                      >
                        Activate
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <TableWrapper className="hidden sm:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Employee</TableHeaderCell>
                  <TableHeaderCell>Department</TableHeaderCell>
                  <TableHeaderCell>Position</TableHeaderCell>
                  <TableHeaderCell>Schedule</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell className="text-right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {items.map((item) => {
                  const isSelf = ownEmployee?.id === item.id
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="text-ink-900 font-medium">
                            {item.first_name} {item.last_name}
                            {isSelf ? (
                              <span className="text-ink-400 ml-1.5 text-xs">(you)</span>
                            ) : null}
                          </p>
                          <p className="text-ink-500 text-xs">
                            <span className="numeric">{item.employee_no}</span> · {item.email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>{item.department?.name ?? '—'}</TableCell>
                      <TableCell>
                        <p>{item.position ?? '—'}</p>
                        <p className="text-ink-500 text-xs">
                          {EMPLOYMENT_TYPE_LABELS[item.employment_type]} · hired{' '}
                          {formatDateOnly(item.date_hired)}
                        </p>
                      </TableCell>
                      <TableCell>{item.schedule?.name ?? 'Unassigned'}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(item.status)} dot>
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(item)}
                            aria-label={`Edit ${item.first_name} ${item.last_name}`}
                          >
                            <Pencil aria-hidden />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openSchedule(item)}
                            aria-label={`Assign schedule to ${item.first_name}`}
                          >
                            <CalendarClock aria-hidden />
                            Schedule
                          </Button>
                          {item.status === 'active' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-danger-700 hover:bg-danger-50"
                              onClick={() => openStatus(item, 'inactive')}
                              disabled={isSelf}
                              title={isSelf ? 'You cannot deactivate your own account.' : undefined}
                            >
                              <UserX aria-hidden />
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-success-700 hover:bg-success-50"
                              onClick={() => openStatus(item, 'active')}
                            >
                              Activate
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrapper>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </>
      )}

      {/* Edit employee */}
      <Modal
        open={edit !== null}
        onClose={() => {
          if (!saving) setEdit(null)
        }}
        title="Edit employee"
        description="Names, position, department, and employment details are recorded in the audit trail."
        size="lg"
        preventClose={saving}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} loading={saving}>
              Save changes
            </Button>
          </>
        }
      >
        {edit ? (
          <div className="space-y-4">
            {formError ? (
              <Alert tone="danger" title="Could not save">
                {formError}
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="First name" htmlFor="edit-first" required>
                <Input
                  id="edit-first"
                  value={edit.first_name}
                  onChange={(event) => setEdit({ ...edit, first_name: event.target.value })}
                />
              </Field>
              <Field label="Middle name" htmlFor="edit-middle">
                <Input
                  id="edit-middle"
                  value={edit.middle_name}
                  onChange={(event) => setEdit({ ...edit, middle_name: event.target.value })}
                />
              </Field>
              <Field label="Last name" htmlFor="edit-last" required>
                <Input
                  id="edit-last"
                  value={edit.last_name}
                  onChange={(event) => setEdit({ ...edit, last_name: event.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Position" htmlFor="edit-position">
                <Input
                  id="edit-position"
                  value={edit.position}
                  onChange={(event) => setEdit({ ...edit, position: event.target.value })}
                  placeholder="OJT Intern"
                />
              </Field>
              <Field label="Department" htmlFor="edit-department">
                <Select
                  id="edit-department"
                  value={edit.department_id}
                  onChange={(event) => setEdit({ ...edit, department_id: event.target.value })}
                >
                  <option value="">Unassigned</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Employment type" htmlFor="edit-type">
                <Select
                  id="edit-type"
                  value={edit.employment_type}
                  onChange={(event) =>
                    setEdit({ ...edit, employment_type: event.target.value as EmploymentType })
                  }
                >
                  {EMPLOYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {EMPLOYMENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date hired" htmlFor="edit-hired">
                <Input
                  id="edit-hired"
                  type="date"
                  value={edit.date_hired}
                  onChange={(event) => setEdit({ ...edit, date_hired: event.target.value })}
                />
              </Field>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Status change */}
      <Modal
        open={statusAction !== null}
        onClose={() => {
          if (!statusBusy) setStatusAction(null)
        }}
        title={
          statusAction?.status === 'active'
            ? 'Activate account'
            : statusAction?.status === 'archived'
              ? 'Archive account'
              : 'Deactivate account'
        }
        description={
          statusAction
            ? `${statusAction.employee.first_name} ${statusAction.employee.last_name} (${statusAction.employee.employee_no})`
            : undefined
        }
        size="sm"
        preventClose={statusBusy}
        footer={
          <>
            <Button variant="outline" onClick={() => setStatusAction(null)} disabled={statusBusy}>
              Cancel
            </Button>
            <Button
              variant={statusAction?.status === 'active' ? 'primary' : 'danger'}
              onClick={() => void applyStatus()}
              loading={statusBusy}
            >
              {statusAction?.status === 'active' ? 'Activate' : 'Deactivate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {statusError ? (
            <Alert tone="danger" title="Could not change the status">
              {statusError}
            </Alert>
          ) : null}

          {statusAction?.status === 'active' ? (
            <p className="text-ink-600 text-sm">
              The student will be able to sign in and record attendance again.
            </p>
          ) : (
            <>
              <p className="text-ink-600 text-sm">
                The account will lose access immediately. Attendance history is kept.
              </p>
              <Field label="Reason" htmlFor="status-reason" required>
                <Textarea
                  id="status-reason"
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder="Completed OJT hours / left the program."
                />
              </Field>
            </>
          )}
        </div>
      </Modal>

      {/* Assign schedule */}
      <Modal
        open={scheduleTarget !== null}
        onClose={() => {
          if (!scheduleBusy) setScheduleTarget(null)
        }}
        title="Assign work schedule"
        description={
          scheduleTarget
            ? `${scheduleTarget.first_name} ${scheduleTarget.last_name} — the change starts today.`
            : undefined
        }
        size="sm"
        preventClose={scheduleBusy}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setScheduleTarget(null)}
              disabled={scheduleBusy}
            >
              Cancel
            </Button>
            <Button onClick={() => void applySchedule()} loading={scheduleBusy}>
              Assign
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {schedules.length === 0 ? (
            <Alert tone="warning" title="No schedules available">
              Create a work schedule first from Administration → Work schedules.
            </Alert>
          ) : (
            <Field label="Schedule" htmlFor="assign-schedule" required>
              <Select
                id="assign-schedule"
                value={scheduleChoice}
                onChange={(event) => setScheduleChoice(event.target.value)}
              >
                {schedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {schedule.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <p className="text-ink-500 text-xs">
            Grace periods, paid periods, and unpaid breaks come from the selected schedule.
          </p>
        </div>
      </Modal>

      {/* New department */}
      <Modal
        open={departmentModalOpen}
        onClose={() => {
          if (!departmentBusy) setDepartmentModalOpen(false)
        }}
        title="New department"
        description="Departments group students for the dashboard and reports."
        size="sm"
        preventClose={departmentBusy}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setDepartmentModalOpen(false)}
              disabled={departmentBusy}
            >
              Cancel
            </Button>
            <Button onClick={() => void createDepartment()} loading={departmentBusy}>
              <Plus aria-hidden />
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {departmentError ? (
            <Alert tone="danger" title="Could not create the department">
              {departmentError}
            </Alert>
          ) : null}

          <Field label="Name" htmlFor="department-name" required>
            <Input
              id="department-name"
              value={newDepartment.name}
              onChange={(event) => setNewDepartment({ ...newDepartment, name: event.target.value })}
              placeholder="Information Technology"
            />
          </Field>
          <Field
            label="Code"
            htmlFor="department-code"
            hint="2–12 characters: letters, numbers, or hyphens."
            required
          >
            <Input
              id="department-code"
              value={newDepartment.code}
              onChange={(event) =>
                setNewDepartment({ ...newDepartment, code: event.target.value.toUpperCase() })
              }
              placeholder="IT"
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
