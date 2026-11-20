import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, RefreshCw, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/spinner'
import { useAuth } from '@/features/auth/auth-context'
import { getSupabase } from '@/lib/supabase'
import { errorMessage, isSessionError, pluralize, SESSION_EXPIRED_MESSAGE } from '@/lib/utils'
import type { WorkSchedule } from '@/types'

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function friendlyScheduleError(message: string): string {
  if (isSessionError(message)) return SESSION_EXPIRED_MESSAGE
  if (message.includes('EMPLOYEE_NOT_ACTIVE')) {
    return 'Your account is not active. Ask your administrator to activate it.'
  }
  if (message.includes('OPEN_SESSION_EXISTS')) {
    return 'Time out first, then change or leave your schedule.'
  }
  if (message.includes('SCHEDULE_INACTIVE')) {
    return 'That schedule is no longer available. Refresh the list and pick another one.'
  }
  if (message.includes('SCHEDULE_NOT_FOUND')) {
    return 'That schedule no longer exists. Refresh the list.'
  }
  if (
    message.includes('list_joinable_schedules') ||
    message.includes('join_work_schedule') ||
    message.includes('leave_work_schedule')
  ) {
    return 'The database is missing the schedule joining migration. Apply 20261119001500_join_schedule.sql.'
  }
  if (message.includes('FORBIDDEN')) {
    return 'Only signed-in employees can join a schedule.'
  }
  return message
}

function daySummary(days: number[]): string {
  return (
    days
      .map((day) => DAY_SHORT[day - 1])
      .filter(Boolean)
      .join(', ') || 'No working days'
  )
}

function periodSummary(schedule: WorkSchedule): string {
  const periods = schedule.periods ?? []
  if (periods.length === 0) return 'No paid periods'
  return periods
    .map((period) => `${period.start_time.slice(0, 5)}–${period.end_time.slice(0, 5)}`)
    .join(' · ')
}

export function MySchedulePage() {
  const { refreshProfile } = useAuth()
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<WorkSchedule | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('list_joinable_schedules')
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

  const current = schedules.find((schedule) => schedule.is_mine) ?? null
  const others = schedules.filter((schedule) => !schedule.is_mine)

  async function joinSchedule() {
    if (!confirmTarget) return
    setJoiningId(confirmTarget.id)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('join_work_schedule', {
        p_schedule_id: confirmTarget.id,
      })
      if (rpcError) throw rpcError
      const result = data as { name?: string; changed?: boolean } | null
      setNotice(
        result?.changed === false
          ? `You are already on "${result.name ?? confirmTarget.name}".`
          : `You joined "${result?.name ?? confirmTarget.name}". It starts today.`,
      )
      setConfirmTarget(null)
      await Promise.all([load(), refreshProfile()])
    } catch (caught) {
      setError(friendlyScheduleError(errorMessage(caught)))
      setConfirmTarget(null)
    } finally {
      setJoiningId(null)
    }
  }

  async function leaveSchedule() {
    setLeaving(true)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('leave_work_schedule')
      if (rpcError) throw rpcError
      const result = data as { changed?: boolean; name?: string } | null
      setNotice(
        result?.changed === false
          ? 'You are not on a schedule.'
          : `You left "${result?.name ?? current?.name ?? 'your schedule'}". Time in is locked until you join again.`,
      )
      setLeaveOpen(false)
      await Promise.all([load(), refreshProfile()])
    } catch (caught) {
      setError(friendlyScheduleError(errorMessage(caught)))
      setLeaveOpen(false)
    } finally {
      setLeaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My time"
        title="My work schedule"
        description="Pick the schedule your administrator published for your OJT. New schedules start today; past DTR days keep their original schedule."
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
        <Alert tone="danger" title="Schedule problem">
          {error}
        </Alert>
      ) : null}

      {loading && schedules.length === 0 ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No schedules published yet"
          description="Your administrator has not opened any schedules for joining. Ask them to create one from Administration → Work schedules."
          action={
            <Button variant="outline" onClick={() => void load()}>
              Check again
            </Button>
          }
        />
      ) : (
        <>
          {current ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Current schedule</CardTitle>
                  <p className="text-ink-500 mt-0.5 text-sm">{current.name}</p>
                </div>
                <Badge tone="success" dot>
                  Joined
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-ink-500 text-xs">Working days</p>
                    <p className="text-ink-800 mt-0.5 font-medium">
                      {daySummary(current.work_days)}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-500 text-xs">Paid periods</p>
                    <p className="text-ink-800 mt-0.5 font-medium">{periodSummary(current)}</p>
                  </div>
                  <div>
                    <p className="text-ink-500 text-xs">Grace period</p>
                    <p className="text-ink-800 mt-0.5 font-medium">
                      {current.grace_minutes} minutes
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p className="text-ink-500 text-xs">
                    <CheckCircle2 className="text-success-600 mr-1 inline size-3.5 align-[-2px]" />
                    Your time in/out now uses this schedule.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                    onClick={() => setLeaveOpen(true)}
                  >
                    Leave schedule
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Alert tone="warning" title="No schedule joined yet">
              Choose one of the schedules below. Time in stays locked until you join.
            </Alert>
          )}

          <div className="space-y-3">
            <div>
              <h2 className="text-ink-900 text-sm font-semibold">
                {current ? 'Available schedules' : 'Schedules you can join'}
              </h2>
              <p className="text-ink-500 mt-0.5 text-xs">
                Joining a different schedule starts today. Your past DTRs do not change.
              </p>
            </div>

            {others.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No other schedules"
                description="Your administrator has only published the schedule you are already on."
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {others.map((schedule) => (
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
                        {pluralize(schedule.assigned_count ?? 0, 'classmate')}
                      </span>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-1 text-sm">
                        <p className="text-ink-700">{periodSummary(schedule)}</p>
                        <p className="text-ink-500 text-xs">
                          {daySummary(schedule.work_days)} · grace {schedule.grace_minutes} min
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmTarget(schedule)}
                        loading={joiningId === schedule.id}
                      >
                        Join this schedule
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => {
          if (!joiningId) setConfirmTarget(null)
        }}
        onConfirm={() => void joinSchedule()}
        title={current ? 'Change your schedule?' : 'Join this schedule?'}
        description={
          confirmTarget
            ? `${confirmTarget.name} · ${periodSummary(confirmTarget)} (${daySummary(
                confirmTarget.work_days,
              )}). ${current ? 'Your previous schedule ends yesterday and this one starts today.' : 'This takes effect today.'}`
            : ''
        }
        confirmLabel={current ? 'Change schedule' : 'Join schedule'}
        loading={joiningId !== null}
      />

      <ConfirmDialog
        open={leaveOpen}
        onClose={() => {
          if (!leaving) setLeaveOpen(false)
        }}
        onConfirm={() => void leaveSchedule()}
        title="Leave this schedule?"
        description={`You will be unassigned from "${current?.name ?? 'your schedule'}". Time in stays locked until you join or are assigned a schedule again. Past DTR days are not affected.`}
        confirmLabel="Leave schedule"
        loading={leaving}
      />
    </div>
  )
}
