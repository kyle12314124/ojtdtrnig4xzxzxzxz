import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  FileText,
  ShieldCheck,
  TrendingUp,
  UserRound,
} from 'lucide-react'
import { useAuth } from '@/features/auth/auth-context'
import { TimeClock } from '@/features/attendance/time-clock'
import { getSupabase } from '@/lib/supabase'
import { errorMessage, formatMinutes, pluralize } from '@/lib/utils'
import { formatDateOnly, formatMonth, formatTime, todayKey } from '@/lib/dates'
import { ROLE_LABELS } from '@/lib/constants'
import { Alert } from '@/components/ui/alert'
import { AttendanceBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/spinner'
import type { DtrPayload, DtrRow } from '@/types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TREND_DAYS = 14

function shiftDayKey(dayKey: string, delta: number): string {
  const date = new Date(`${dayKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

function monthKeys(month: string): { start: string; end: string } {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
  }
}

function weekdayLabel(dayKey: string): string {
  return new Date(`${dayKey}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  })
}

interface TrendBarsProps {
  rows: DtrRow[]
}

/** Lightweight CSS bar chart: no chart library, so the student bundle stays small. */
function TrendBars({ rows }: TrendBarsProps) {
  const scale = Math.max(8 * 60, ...rows.map((row) => row.record?.worked_minutes ?? 0))

  return (
    <div>
      <div
        className="flex h-28 items-end gap-[3px] sm:h-32 sm:gap-1.5"
        role="img"
        aria-label="Hours worked on each of the last 14 days"
      >
        {rows.map((row) => {
          const minutes = row.record?.worked_minutes ?? 0
          const late = row.record?.status === 'late'
          const tone = late ? 'bg-warning-500' : minutes > 0 ? 'bg-brand-500' : 'bg-ink-200'
          const label =
            minutes > 0 ? formatMinutes(minutes) : row.is_work_day ? 'No punch' : 'Rest day'

          return (
            <div key={row.work_date} className="flex h-full flex-1 flex-col justify-end">
              <div
                className={`w-full rounded-t-sm transition-colors ${tone}`}
                style={
                  minutes > 0
                    ? { height: `${Math.max(4, Math.round((minutes / scale) * 100))}%` }
                    : { height: 3 }
                }
                title={`${formatDateOnly(row.work_date)} Â· ${label}${late ? ' Â· Late' : ''}`}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-1.5 flex gap-[3px] sm:gap-1.5">
        {rows.map((row, index) => {
          const day = Number(row.work_date.slice(8, 10))
          return (
            <span
              key={row.work_date}
              className="text-ink-400 flex-1 text-center text-[9px] sm:text-[10px]"
            >
              <span className="hidden sm:inline">{day}</span>
              <span className="sm:hidden">{index % 2 === 0 ? day : ''}</span>
            </span>
          )
        })}
      </div>

      <div className="text-ink-500 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-brand-500 size-2 rounded-sm" aria-hidden />
          On time
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-warning-500 size-2 rounded-sm" aria-hidden />
          Late
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-ink-200 size-2 rounded-sm" aria-hidden />
          No punch
        </span>
      </div>
    </div>
  )
}

export function WorkspacePage() {
  const { profile, employee, role, isAdmin, signOut } = useAuth()
  const month = todayKey().slice(0, 7)
  const [summary, setSummary] = useState<DtrPayload | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [trend, setTrend] = useState<DtrPayload | null>(null)
  const [trendLoading, setTrendLoading] = useState(true)
  const [trendError, setTrendError] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    if (!employee?.id) {
      setSummaryLoading(false)
      return
    }
    const bounds = monthKeys(month)
    try {
      const { data, error } = await getSupabase().rpc('get_dtr', {
        p_employee_id: employee.id,
        p_start: bounds.start,
        p_end: bounds.end,
      })
      if (error) throw error
      setSummary(data as DtrPayload)
      setSummaryError(null)
    } catch (caught) {
      setSummaryError(errorMessage(caught))
    } finally {
      setSummaryLoading(false)
    }
  }, [employee?.id, month])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const loadTrend = useCallback(async () => {
    if (!employee?.id) {
      setTrendLoading(false)
      return
    }
    const end = todayKey()
    const start = shiftDayKey(end, -(TREND_DAYS - 1))
    try {
      const { data, error } = await getSupabase().rpc('get_dtr', {
        p_employee_id: employee.id,
        p_start: start,
        p_end: end,
      })
      if (error) throw error
      setTrend(data as DtrPayload)
      setTrendError(null)
    } catch (caught) {
      setTrendError(errorMessage(caught))
    } finally {
      setTrendLoading(false)
    }
  }, [employee?.id])

  useEffect(() => {
    void loadTrend()
  }, [loadTrend])

  const schedule = employee?.schedule ?? null
  const totals = summary?.totals
  const recent = (summary?.rows ?? [])
    .filter((row) => row.record !== null || row.sessions.length > 0)
    .slice(-5)
    .reverse()

  const trendRows = trend?.rows ?? []
  const trendMinutes = trendRows.reduce((sum, row) => sum + (row.record?.worked_minutes ?? 0), 0)
  const trendLateDays = trendRows.filter((row) => row.record?.status === 'late').length
  const trendPresentDays = trendRows.filter(
    (row) => row.record && row.record.status !== 'absent' && row.record.status !== 'on_leave',
  ).length

  const glance = [
    { label: 'Worked', value: formatMinutes(totals?.worked_minutes ?? 0), tone: 'text-ink-900' },
    { label: 'Late', value: formatMinutes(totals?.late_minutes ?? 0), tone: 'text-warning-700' },
    {
      label: 'Undertime',
      value: formatMinutes(totals?.undertime_minutes ?? 0),
      tone: 'text-danger-700',
    },
    {
      label: 'Overtime',
      value: formatMinutes(totals?.overtime_minutes ?? 0),
      tone: 'text-success-700',
    },
  ]

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title={`Welcome, ${profile?.full_name.split(' ')[0] ?? 'there'}`}
        description="Record your OJT attendance and open your daily time record. Timestamps come from the server clock, and unpaid breaks are excluded automatically."
        actions={
          <>
            <Link
              to="/dtr"
              className="border-ink-300 text-ink-700 hover:bg-ink-50 bg-surface inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-xs"
            >
              <FileText className="size-4" aria-hidden />
              My DTR
            </Link>
            {isAdmin ? (
              <Link
                to="/admin/dashboard"
                className="border-ink-300 text-ink-700 hover:bg-ink-50 bg-surface inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-xs"
              >
                <CalendarDays className="size-4" aria-hidden />
                Dashboard
              </Link>
            ) : null}
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </>
        }
      />

      <TimeClock
        onChanged={() => {
          void loadSummary()
          void loadTrend()
        }}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>This month</CardTitle>
                <p className="text-ink-500 mt-0.5 text-sm">
                  {formatMonth(`${month}-01`)}
                  {totals ? ` Â· ${pluralize(totals.days_present, 'day')} present` : ''}
                </p>
              </div>
              <Link
                to="/dtr"
                className="text-brand-700 inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                Open DTR
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </CardHeader>
            <CardContent>
              {summaryError ? (
                <Alert tone="danger" title="Could not load this month">
                  {summaryError}
                </Alert>
              ) : summaryLoading ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[0, 1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-16 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {glance.map((item) => (
                    <div key={item.label} className="bg-ink-50/70 rounded-lg px-3 py-2.5">
                      <dt className="text-ink-500 text-[11px] font-medium tracking-wide uppercase">
                        {item.label}
                      </dt>
                      <dd className={`numeric mt-0.5 text-base font-semibold ${item.tone}`}>
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="text-brand-600 size-4" aria-hidden />
                  Last {TREND_DAYS} days
                </CardTitle>
                <p className="text-ink-500 mt-0.5 text-sm">
                  Hours worked each day. Amber bars are late arrivals.
                </p>
              </div>
              {!trendLoading && !trendError && trendRows.length > 0 ? (
                <div className="shrink-0 text-right">
                  <p className="numeric text-ink-900 text-sm font-semibold">
                    {formatMinutes(trendMinutes)}
                  </p>
                  <p className="text-ink-500 text-[11px]">
                    {pluralize(trendPresentDays, 'day')} present
                    {trendLateDays > 0 ? ` Â· ${trendLateDays} late` : ''}
                  </p>
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              {trendError ? (
                <p className="text-ink-500 text-sm">Could not load your trend right now.</p>
              ) : trendLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : trendRows.length === 0 ? (
                <p className="text-ink-500 text-sm">
                  No days to show yet. Time in above to start your record.
                </p>
              ) : (
                <TrendBars rows={trendRows} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recent days</CardTitle>
                <p className="text-ink-500 mt-0.5 text-sm">Your latest recorded attendance.</p>
              </div>
              <Link to="/dtr" className="text-brand-700 text-xs font-medium hover:underline">
                View all
              </Link>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {summaryLoading ? (
                <div className="px-5 pb-5">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : recent.length === 0 ? (
                <p className="text-ink-500 px-5 pb-5 text-sm">
                  No punches recorded this month yet. Time in above to start your record.
                </p>
              ) : (
                <ul className="divide-ink-100 divide-y">
                  {recent.map((row) => (
                    <li
                      key={row.work_date}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="numeric text-ink-900 text-sm font-medium">
                          {formatDateOnly(row.work_date)}
                          <span className="text-ink-400 ml-2 text-xs font-normal">
                            {weekdayLabel(row.work_date)}
                          </span>
                        </p>
                        <p className="text-ink-500 mt-0.5 truncate text-xs">
                          {row.sessions.length === 0
                            ? 'No punch'
                            : row.sessions
                                .map(
                                  (session) =>
                                    `${formatTime(session.time_in)}â€“${
                                      session.time_out ? formatTime(session.time_out) : 'open'
                                    }`,
                                )
                                .join(' Â· ')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2.5">
                        {row.record ? <AttendanceBadge status={row.record.status} /> : null}
                        <span className="numeric text-ink-700 text-sm font-semibold">
                          {formatMinutes(row.record?.worked_minutes ?? 0)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="text-brand-600 size-4" aria-hidden />
                My schedule
              </CardTitle>
              <Link
                to="/my-schedule"
                className="text-brand-700 text-xs font-medium hover:underline"
              >
                {schedule ? 'Change' : 'Join'}
              </Link>
            </CardHeader>
            <CardContent>
              {schedule ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-ink-900 text-sm font-semibold">{schedule.name}</p>
                    <p className="text-ink-500 mt-0.5 text-xs">
                      Grace period {schedule.grace_minutes} min Â·{' '}
                      {schedule.timezone.replace('_', ' ')}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((label, index) => {
                      const dayNumber = index + 1
                      const works = schedule.work_days.includes(dayNumber)
                      return (
                        <span
                          key={label}
                          className={
                            works
                              ? 'bg-brand-100 text-brand-800 rounded-md px-1.5 py-1 text-[11px] font-medium'
                              : 'bg-ink-100 text-ink-400 rounded-md px-1.5 py-1 text-[11px]'
                          }
                        >
                          {label}
                        </span>
                      )
                    })}
                  </div>

                  <div className="border-ink-100 space-y-1 rounded-lg border px-3 py-2">
                    {schedule.periods.map((period) => (
                      <p key={period.id} className="text-ink-700 numeric text-xs">
                        {period.start_time.slice(0, 5)}â€“{period.end_time.slice(0, 5)}
                        <span className="text-ink-400 ml-1.5 font-sans">{period.label}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-ink-600 text-sm">
                    You are not in a schedule yet, so timing in is locked. Join the schedule your
                    administrator published.
                  </p>
                  <Link
                    to="/my-schedule"
                    className="bg-brand-600 hover:bg-brand-700 inline-flex h-9 w-full items-center justify-center rounded-lg px-3 text-sm font-medium text-white"
                  >
                    Join a schedule
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="text-brand-600 size-4" aria-hidden />
                My account
              </CardTitle>
              <Link to="/account" className="text-brand-700 text-xs font-medium hover:underline">
                Details
              </Link>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500 text-xs">Student no.</dt>
                  <dd className="numeric text-ink-800 font-medium">
                    {employee?.employee_no ?? 'â€”'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500 text-xs">Position</dt>
                  <dd className="text-ink-800 truncate font-medium">
                    {employee?.position ?? 'â€”'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500 text-xs">Department</dt>
                  <dd className="text-ink-800 truncate font-medium">
                    {employee?.department?.name ?? 'â€”'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500 text-xs">Role</dt>
                  <dd className="text-ink-800 font-medium">{role ? ROLE_LABELS[role] : 'â€”'}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-brand-200/70 bg-brand-50/40 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="text-brand-700 mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <h3 className="text-brand-900 text-sm font-semibold">Something looks wrong?</h3>
            <p className="text-brand-800/80 mt-1 text-sm leading-relaxed">
              Request a correction from <span className="font-medium">My DTR</span>. An
              administrator reviews it first, and the original punch stays in the audit trail.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
