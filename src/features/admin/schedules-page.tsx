import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, Plus, RefreshCw, Trash2, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Skeleton } from '@/components/ui/spinner'
import { useAuth } from '@/features/auth/auth-context'
import { getSupabase } from '@/lib/supabase'
import { DAY_LABELS } from '@/lib/constants'
import { errorMessage, pluralize, isSessionError, SESSION_EXPIRED_MESSAGE } from '@/lib/utils'
import type { WorkSchedule } from '@/types'

const DAY_VALUES = [1, 2, 3, 4, 5, 6, 7] as const
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type PeriodDraft = { label: string; start: string; end: string }

const DEFAULT_PERIODS: PeriodDraft[] = [
  { label: 'Morning', start: '08:00', end: '12:00' },
  { label: 'Afternoon', start: '13:00', end: '17:00' },
]

function friendlyScheduleError(message: string): string {
  if (isSessionError(message)) return SESSION_EXPIRED_MESSAGE
  if (message.includes('SCHEDULE_NAME_TAKEN')) {
    return 'A schedule with that name already exists. Choose another name.'
  }
  if (message.includes('PERIODS_INVALID') || message.includes('PERIOD_TIME_INVALID')) {
    return 'Add at least one paid period, each with a different start and end time.'
  }
  if (message.includes('WORK_DAYS_INVALID')) {
    return 'Select at least one working day.'
  }
  if (message.includes('SCHEDULE_NAME_INVALID')) {
    return 'The schedule name must be between 2 and 80 characters.'
  }
  if (message.includes('SCHEDULE_ASSIGNED')) {
    return 'This schedule is still assigned to one or more employees. Unassign them below, or reassign them on the Employees page.'
  }
  if (message.includes('SCHEDULE_HAS_ATTENDANCE')) {
    return 'This schedule was used for attendance. Tick “Delete anyway” to detach those DTR days, or keep the schedule.'
  }
  if (message.includes('SCHEDULE_NOT_FOUND')) {
    return 'That schedule no longer exists. Refresh the list.'
  }
  if (message.includes('FORBIDDEN')) {
    return 'Only administrators can manage schedules.'
  }
  if (message.includes('delete_work_schedule')) {
    return 'The database is missing the schedule delete migration. Apply 20261119001300_delete_schedule.sql.'
  }
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The database is missing the attendance migration. Apply 20261119000700_time_clock.sql.'
  }
  return message
}

function PeriodsSummary({ schedule }: { schedule: WorkSchedule }) {
  const periods = schedule.periods ?? []
  const days = schedule.work_days
    .map((day) => DAY_SHORT[day - 1])
    .filter(Boolean)
    .join(', ')

  return (
    <div className="space-y-2">
      <p className="text-ink-700 text-sm">
        {periods.length === 0
          ? 'No paid periods'
          : periods
              .map((period) => `${period.start_time.slice(0, 5)}–${period.end_time.slice(0, 5)}`)
              .join(' · ')}
      </p>
      <p className="text-ink-500 text-xs">
        {days || 'No working days'} · grace {schedule.grace_minutes} min
      </p>
    </div>
  )
}

export function SchedulesPage() {
  const { refreshProfile } = useAuth()
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creatingDefault, setCreatingDefault] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('OJT Standard')
  const [grace, setGrace] = useState('10')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [periods, setPeriods] = useState<PeriodDraft[]>(DEFAULT_PERIODS)
  const [assignUnassigned, setAssignUnassigned] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<WorkSchedule | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteUnassign, setDeleteUnassign] = useState(false)
  const [deleteForce, setDeleteForce] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('list_work_schedules')
      if (rpcError) throw rpcError
      setSchedules((data as WorkSchedule[] | null) ?? [])
    } catch (caught) {
      setError(friendlyScheduleError(errorMessage(caught)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setName('OJT Standard')
    setGrace('10')
    setDays([1, 2, 3, 4, 5])
    setPeriods(DEFAULT_PERIODS.map((period) => ({ ...period })))
    setAssignUnassigned(true)
    setFormError(null)
  }

  function openModal() {
    resetForm()
    setModalOpen(true)
  }

  function toggleDay(value: number) {
    setDays((current) =>
      current.includes(value)
        ? current.filter((day) => day !== value)
        : [...current, value].sort((a, b) => a - b),
    )
  }

  function updatePeriod(index: number, patch: Partial<PeriodDraft>) {
    setPeriods((current) =>
      current.map((period, position) => (position === index ? { ...period, ...patch } : period)),
    )
  }

  async function createSchedule() {
    setFormError(null)
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setFormError('Enter a schedule name.')
      return
    }
    if (days.length === 0) {
      setFormError('Select at least one working day.')
      return
    }
    if (periods.length === 0) {
      setFormError('Add at least one paid period.')
      return
    }
    if (periods.some((period) => !period.start || !period.end || period.start === period.end)) {
      setFormError('Each period needs a start and end time, and they must differ.')
      return
    }

    setSaving(true)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('create_work_schedule', {
        p_name: trimmed,
        p_description: null,
        p_grace_minutes: Number(grace) || 0,
        p_work_days: days,
        p_periods: periods.map((period) => ({
          label: period.label.trim() || 'Period',
          start: period.start,
          end: period.end,
        })),
        p_assign_unassigned: assignUnassigned,
      })
      if (rpcError) throw rpcError

      const result = data as { assigned_employees?: number } | null
      setModalOpen(false)
      setNotice(
        result && result.assigned_employees
          ? `Schedule created and assigned to ${pluralize(result.assigned_employees, 'employee')}.`
          : 'Schedule created.',
      )
      await Promise.all([load(), refreshProfile()])
    } catch (caught) {
      setFormError(friendlyScheduleError(errorMessage(caught)))
    } finally {
      setSaving(false)
    }
  }

  async function createDefault() {
    setCreatingDefault(true)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('ensure_default_schedule')
      if (rpcError) throw rpcError
      const result = data as { name?: string; assigned_employees?: number } | null
      setNotice(
        result?.assigned_employees
          ? `"${result.name}" created and assigned to ${pluralize(result.assigned_employees, 'employee')}.`
          : `"${result?.name ?? 'Schedule'}" is ready.`,
      )
      await Promise.all([load(), refreshProfile()])
    } catch (caught) {
      setError(friendlyScheduleError(errorMessage(caught)))
    } finally {
      setCreatingDefault(false)
    }
  }

  async function assignUnassignedTo(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('assign_schedule_to_unassigned', {
        p_schedule_id: id,
      })
      if (rpcError) throw rpcError
      const result = data as { assigned_employees?: number } | null
      setNotice(
        result?.assigned_employees
          ? `Assigned to ${pluralize(result.assigned_employees, 'employee')}.`
          : 'Every active employee already has a schedule.',
      )
      await Promise.all([load(), refreshProfile()])
    } catch (caught) {
      setError(friendlyScheduleError(errorMessage(caught)))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteSchedule() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('delete_work_schedule', {
        p_schedule_id: deleteTarget.id,
        p_unassign: deleteUnassign,
        p_force: deleteForce,
      })
      if (rpcError) throw rpcError
      const result = data as {
        unassigned_employees?: number
        detached_attendance_days?: number
      } | null
      const details = [
        result?.unassigned_employees
          ? `${pluralize(result.unassigned_employees, 'employee')} unassigned`
          : null,
        result?.detached_attendance_days
          ? `${pluralize(result.detached_attendance_days, 'attendance day')} detached`
          : null,
      ].filter(Boolean)
      setNotice(
        details.length > 0
          ? `"${deleteTarget.name}" deleted (${details.join(', ')}).`
          : `"${deleteTarget.name}" deleted.`,
      )
      setDeleteTarget(null)
      await Promise.all([load(), refreshProfile()])
    } catch (caught) {
      setDeleteError(friendlyScheduleError(errorMessage(caught)))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Work schedules"
        description="Define paid periods and working days. Gaps between periods are unpaid breaks, and time outside the day counts as overtime."
        actions={
          <>
            <Button variant="outline" onClick={() => void load()} loading={loading}>
              {loading ? null : <RefreshCw aria-hidden />}
              Refresh
            </Button>
            <Button onClick={openModal}>
              <Plus aria-hidden />
              New schedule
            </Button>
          </>
        }
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Schedule problem">
          {error}
        </Alert>
      ) : null}

      {loading && schedules.length === 0 ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={CalendarPlus}
          title="No work schedules yet"
          description="Create the standard Monday–Friday 8:00–12:00 / 13:00–17:00 schedule, then assign it to your classmates. Without a schedule, time in stays locked."
          action={
            <Button onClick={() => void createDefault()} loading={creatingDefault}>
              Create the standard OJT schedule
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {schedules.map((schedule) => (
            <Card key={schedule.id}>
              <CardHeader>
                <div>
                  <CardTitle>{schedule.name}</CardTitle>
                  {schedule.description ? (
                    <p className="text-ink-500 mt-0.5 text-sm">{schedule.description}</p>
                  ) : null}
                </div>
                <span className="text-ink-500 inline-flex items-center gap-1.5 text-xs">
                  <Users className="size-3.5" aria-hidden />
                  {pluralize(schedule.assigned_count ?? 0, 'employee')}
                </span>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <PeriodsSummary schedule={schedule} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void assignUnassignedTo(schedule.id)}
                    loading={busyId === schedule.id}
                  >
                    Assign to unassigned
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                    onClick={() => {
                      setDeleteError(null)
                      setDeleteUnassign(false)
                      setDeleteForce(false)
                      setDeleteTarget(schedule)
                    }}
                  >
                    <Trash2 aria-hidden />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!saving) setModalOpen(false)
        }}
        title="New work schedule"
        description="Paid periods are the working windows. The gaps between them are unpaid breaks."
        size="lg"
        preventClose={saving}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void createSchedule()} loading={saving}>
              Create schedule
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? (
            <Alert tone="danger" title="Could not create the schedule">
              {formError}
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Name" htmlFor="schedule-name" required>
              <Input
                id="schedule-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="OJT Standard"
              />
            </Field>
            <Field label="Grace (minutes)" htmlFor="schedule-grace">
              <Input
                id="schedule-grace"
                type="number"
                min={0}
                max={120}
                value={grace}
                onChange={(event) => setGrace(event.target.value)}
              />
            </Field>
          </div>

          <fieldset>
            <legend className="text-ink-700 mb-1.5 block text-sm font-medium">Working days</legend>
            <div className="flex flex-wrap gap-2">
              {DAY_VALUES.map((value) => {
                const active = days.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleDay(value)}
                    className={
                      active
                        ? 'bg-solid-brand rounded-md px-3 py-1.5 text-xs font-medium text-white'
                        : 'border-ink-300 text-ink-600 hover:bg-ink-50 rounded-md border px-3 py-1.5 text-xs font-medium'
                    }
                  >
                    {DAY_LABELS[value === 7 ? 0 : value]}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset>
            <div className="mb-1.5 flex items-center justify-between">
              <legend className="text-ink-700 block text-sm font-medium">Paid periods</legend>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPeriods((current) => [
                    ...current,
                    { label: `Period ${current.length + 1}`, start: '08:00', end: '09:00' },
                  ])
                }
                disabled={periods.length >= 6}
              >
                <Plus aria-hidden />
                Add period
              </Button>
            </div>

            <div className="space-y-2">
              {periods.map((period, index) => (
                <div
                  key={index}
                  className="border-ink-200 grid grid-cols-[1fr_100px_100px_36px] items-center gap-2 rounded-lg border px-2 py-2"
                >
                  <Input
                    aria-label={`Period ${index + 1} label`}
                    value={period.label}
                    onChange={(event) => updatePeriod(index, { label: event.target.value })}
                    placeholder="Morning"
                  />
                  <Input
                    aria-label={`Period ${index + 1} start`}
                    type="time"
                    value={period.start}
                    onChange={(event) => updatePeriod(index, { start: event.target.value })}
                  />
                  <Input
                    aria-label={`Period ${index + 1} end`}
                    type="time"
                    value={period.end}
                    onChange={(event) => updatePeriod(index, { end: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-ink-400 hover:text-danger-600 size-8"
                    aria-label={`Remove period ${index + 1}`}
                    onClick={() => setPeriods((current) => current.filter((_, i) => i !== index))}
                    disabled={periods.length === 1}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </fieldset>

          <label className="border-ink-200 flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
            <input
              type="checkbox"
              checked={assignUnassigned}
              onChange={(event) => setAssignUnassigned(event.target.checked)}
              className="accent-brand-600 mt-0.5 size-4"
            />
            <span className="text-sm">
              <span className="text-ink-900 block font-medium">
                Assign to employees without a schedule
              </span>
              <span className="text-ink-500 text-xs">
                Active classmates who have not been assigned a schedule yet.
              </span>
            </span>
          </label>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        title="Delete work schedule"
        description={deleteTarget?.name}
        size="sm"
        preventClose={deleting}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void deleteSchedule()}
              loading={deleting}
              disabled={Boolean(
                deleteTarget && (deleteTarget.attendance_days ?? 0) > 0 && !deleteForce,
              )}
            >
              Delete schedule
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {deleteError ? (
            <Alert tone="danger" title="Could not delete the schedule">
              {deleteError}
            </Alert>
          ) : null}

          <p className="text-ink-700 text-sm">
            This permanently removes the schedule and its paid periods. It cannot be undone.
          </p>

          {deleteTarget && (deleteTarget.assigned_count ?? 0) > 0 ? (
            <>
              <Alert tone="warning" title="Still assigned">
                {pluralize(deleteTarget.assigned_count ?? 0, 'employee')} currently use this
                schedule. Reassign them on the Employees page, or unassign them below.
              </Alert>

              <label className="border-ink-200 flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={deleteUnassign}
                  onChange={(event) => setDeleteUnassign(event.target.checked)}
                  className="accent-danger-600 mt-0.5 size-4"
                />
                <span className="text-sm">
                  <span className="text-ink-900 block font-medium">
                    Unassign these employees when deleting
                  </span>
                  <span className="text-ink-500 text-xs">
                    They will not be able to time in until they join or are assigned another
                    schedule.
                  </span>
                </span>
              </label>
            </>
          ) : null}

          {deleteTarget && (deleteTarget.attendance_days ?? 0) > 0 ? (
            <>
              <Alert tone="danger" title="Attendance history">
                {pluralize(deleteTarget.attendance_days ?? 0, 'attendance day')} reference this
                schedule. Deleting keeps those DTR rows but detaches them from the schedule.
              </Alert>

              <label className="border-danger-200 bg-danger-50 flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={deleteForce}
                  onChange={(event) => setDeleteForce(event.target.checked)}
                  className="accent-danger-600 mt-0.5 size-4"
                />
                <span className="text-sm">
                  <span className="text-danger-900 block font-medium">Delete anyway</span>
                  <span className="text-danger-700 text-xs">
                    Required before an attendance-backed schedule can be removed.
                  </span>
                </span>
              </label>
            </>
          ) : null}

          <p className="text-ink-500 text-xs">
            Deleting a schedule never erases attendance. If it was used, those DTR rows stay and are
            only detached from the schedule.
          </p>
        </div>
      </Modal>
    </div>
  )
}
