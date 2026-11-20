import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarOff, Clock, LogIn, LogOut, RefreshCw, TriangleAlert } from 'lucide-react'
import { useAuth } from '@/features/auth/auth-context'
import { getSupabase } from '@/lib/supabase'
import { formatDateOnly, formatTime } from '@/lib/dates'
import { errorMessage, formatMinutes, isSessionError, SESSION_EXPIRED_MESSAGE } from '@/lib/utils'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/spinner'
import type { AttendanceRecord, MyDay } from '@/types'

function friendlyPunchError(message: string): string {
  if (isSessionError(message)) return SESSION_EXPIRED_MESSAGE
  if (message.includes('SCHEDULE_NOT_ASSIGNED')) {
    return 'Join a work schedule on the My schedule page before timing in.'
  }
  if (message.includes('ALREADY_TIMED_IN')) {
    return 'You already have an open time-in. Refresh to see it.'
  }
  if (message.includes('NOT_TIMED_IN')) {
    return 'There is no open time-in to close. Refresh the page.'
  }
  if (message.includes('EMPLOYEE_NOT_ACTIVE')) {
    return 'Your account is not active yet, so it cannot record attendance.'
  }
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The database is missing the attendance migration. Apply 20261119000700_time_clock.sql.'
  }
  return message
}

function Totals({ record }: { record: AttendanceRecord | null }) {
  const items = [
    { label: 'Worked', value: record?.worked_minutes ?? 0, tone: 'text-ink-900' },
    { label: 'Late', value: record?.late_minutes ?? 0, tone: 'text-warning-700' },
    { label: 'Undertime', value: record?.undertime_minutes ?? 0, tone: 'text-danger-700' },
    { label: 'Overtime', value: record?.overtime_minutes ?? 0, tone: 'text-success-700' },
  ]

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="bg-ink-50/70 rounded-lg px-3 py-2">
          <dt className="text-ink-500 text-[11px] font-medium tracking-wide uppercase">
            {item.label}
          </dt>
          <dd className={`numeric mt-0.5 text-sm font-semibold ${item.tone}`}>
            {formatMinutes(item.value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function TimeClock({ onChanged }: { onChanged?: () => void }) {
  const { employee, refreshProfile } = useAuth()
  const [day, setDay] = useState<MyDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [punching, setPunching] = useState<'in' | 'out' | null>(null)
  const [punchError, setPunchError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('get_my_day')
      if (rpcError) throw rpcError
      setDay(data as MyDay)
    } catch (caught) {
      setError(friendlyPunchError(errorMessage(caught)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (employee) void load()
  }, [employee, load])

  async function punch(action: 'in' | 'out') {
    setPunching(action)
    setPunchError(null)
    setNotice(null)
    try {
      const { error: rpcError } = await getSupabase().rpc(action === 'in' ? 'time_in' : 'time_out')
      if (rpcError) throw rpcError
      await Promise.all([load(), refreshProfile()])
      onChanged?.()
      setNotice(
        action === 'in'
          ? 'Time in recorded with the server clock.'
          : 'Time out recorded. Your totals are updated.',
      )
    } catch (caught) {
      setPunchError(friendlyPunchError(errorMessage(caught)))
    } finally {
      setPunching(null)
    }
  }

  if (!employee) return null

  const open = day?.open_session ?? null
  const schedule = day?.schedule ?? null
  const sessions = day?.sessions ?? []

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Clock className="text-brand-600 size-4" aria-hidden />
            Time clock
          </CardTitle>
          <p className="text-ink-500 mt-0.5 text-sm">
            {schedule ? (
              <>
                {schedule.name} · grace {schedule.grace_minutes} min
              </>
            ) : (
              <>
                No schedule joined ·{' '}
                <Link to="/my-schedule" className="text-brand-700 font-medium hover:underline">
                  join a schedule
                </Link>
              </>
            )}
          </p>
        </div>
        {loading ? (
          <Skeleton className="h-6 w-24 rounded-full" />
        ) : open ? (
          <Badge tone="success" dot>
            Clocked in since {formatTime(open.time_in)}
          </Badge>
        ) : (
          <Badge tone="neutral" dot>
            Not clocked in
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <Alert
            tone="danger"
            title="Could not load today's attendance"
            action={
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            }
          >
            {error}
          </Alert>
        ) : null}

        {punchError ? (
          <Alert tone="danger" title="Punch failed">
            {punchError}
          </Alert>
        ) : null}

        {notice ? (
          <Alert tone="success" title="Recorded">
            {notice}
          </Alert>
        ) : null}

        {!loading && schedule && !day?.is_work_day && !open ? (
          <Alert tone="info" title="Rest day">
            <span className="flex items-center gap-2">
              <CalendarOff className="size-4" aria-hidden />
              Today is not a scheduled work day. Punches are still recorded and counted as overtime.
            </span>
          </Alert>
        ) : null}

        {!loading && day?.holiday ? (
          <Alert tone="info" title={day.holiday.name}>
            Today is a {day.holiday.holiday_type.replaceAll('_', ' ')}. Work is recorded as
            overtime.
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-ink-500 text-xs font-medium tracking-wide uppercase">Today</p>
            <p className="numeric text-ink-900 text-lg font-semibold">
              {day ? formatDateOnly(day.work_date) : '—'}
            </p>
            {day ? (
              <p className="text-ink-500 text-xs">
                Server time {formatTime(day.server_time)}
                {open ? ` · open since ${formatTime(open.time_in)}` : ''}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh attendance"
            >
              <RefreshCw className={loading ? 'animate-spin' : undefined} />
            </Button>
            {open ? (
              <Button
                size="lg"
                variant="danger"
                onClick={() => void punch('out')}
                loading={punching === 'out'}
                disabled={punching !== null}
              >
                {punching === 'out' ? null : <LogOut aria-hidden />}
                {punching === 'out' ? 'Recording…' : 'Time out'}
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={() => void punch('in')}
                loading={punching === 'in'}
                disabled={punching !== null || !schedule || loading}
              >
                {punching === 'in' ? null : <LogIn aria-hidden />}
                {punching === 'in' ? 'Recording…' : 'Time in'}
              </Button>
            )}
          </div>
        </div>

        {schedule ? (
          <div className="border-ink-100 rounded-lg border px-3 py-2">
            <p className="text-ink-500 text-[11px] font-medium tracking-wide uppercase">
              Paid periods (breaks between them are unpaid)
            </p>
            <p className="text-ink-700 mt-1 text-sm">
              {schedule.periods
                .map((period) => `${period.start_time.slice(0, 5)}–${period.end_time.slice(0, 5)}`)
                .join(' · ')}
            </p>
            <p className="text-ink-500 mt-0.5 text-xs">
              Grace period {schedule.grace_minutes} min · {schedule.timezone.replace('_', ' ')}
            </p>
          </div>
        ) : null}

        {loading && !day ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : sessions.length > 0 ? (
          <div className="border-ink-200 overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/80">
                <tr>
                  <th className="text-ink-500 px-3 py-2 text-left text-[11px] font-semibold tracking-wider uppercase">
                    Time in
                  </th>
                  <th className="text-ink-500 px-3 py-2 text-left text-[11px] font-semibold tracking-wider uppercase">
                    Time out
                  </th>
                  <th className="text-ink-500 px-3 py-2 text-right text-[11px] font-semibold tracking-wider uppercase">
                    Worked
                  </th>
                </tr>
              </thead>
              <tbody className="divide-ink-100 divide-y">
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td className="numeric text-ink-800 px-3 py-2">
                      {formatTime(session.time_in)}
                    </td>
                    <td className="numeric text-ink-800 px-3 py-2">
                      {session.time_out ? (
                        formatTime(session.time_out)
                      ) : (
                        <span className="text-success-700 font-medium">Open</span>
                      )}
                    </td>
                    <td className="numeric text-ink-700 px-3 py-2 text-right">
                      {session.time_out ? formatMinutes(session.worked_minutes) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && (
            <p className="text-ink-500 flex items-center gap-2 text-sm">
              <TriangleAlert className="text-ink-400 size-4" aria-hidden />
              No punches recorded today yet.
            </p>
          )
        )}

        <Totals record={day?.record ?? null} />
      </CardContent>
    </Card>
  )
}
