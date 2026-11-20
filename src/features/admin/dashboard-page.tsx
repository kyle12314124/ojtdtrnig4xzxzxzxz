import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  CalendarDays,
  Clock,
  RefreshCw,
  Timer,
  TrendingUp,
  UserCheck,
  Users,
  Wrench,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { StatCard } from '@/components/ui/stat-card'
import { Skeleton } from '@/components/ui/spinner'
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
import { formatDateOnly, formatTime } from '@/lib/dates'
import { errorMessage, formatMinutes, pluralize } from '@/lib/utils'
import { useScheduleScope } from '@/features/schedule/schedule-scope-context'
import type { AdminDashboard } from '@/types'

function friendly(message: string): string {
  if (message.includes('admin_dashboard')) {
    return 'The database is missing the schedule filter migration. Apply 20261119001800_schedule_filters.sql, then reload.'
  }
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The database is missing the dashboard migration. Apply 20261119000800_dashboard_and_employees.sql, then reload.'
  }
  if (message.includes('FORBIDDEN')) return 'Your account is not allowed to view the dashboard.'
  return message
}

export function AdminDashboardPage() {
  const { scheduleId, setScheduleId, schedules, activeSchedule } = useScheduleScope()
  const [data, setData] = useState<AdminDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: result, error: rpcError } = await getSupabase().rpc('admin_dashboard', {
        p_date: null,
        p_schedule_id: scheduleId || null,
      })
      if (rpcError) throw rpcError
      setData(result as AdminDashboard)
    } catch (caught) {
      setError(friendly(errorMessage(caught)))
    } finally {
      setLoading(false)
    }
  }, [scheduleId])

  useEffect(() => {
    void load()
  }, [load])

  const chartData =
    data?.trend.map((point) => ({
      day: formatDateOnly(point.day).replace(/,\s*\d{4}$/, ''),
      present: point.present,
      late: point.late,
    })) ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Dashboard"
        description="Live attendance from the database — no cached numbers. Filter by schedule to track one group at a time."
        actions={
          <>
            <Select
              value={scheduleId}
              onChange={(event) => setScheduleId(event.target.value)}
              aria-label="Filter dashboard by schedule"
              className="w-56"
            >
              <option value="">All schedules</option>
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => void load()} loading={loading}>
              {loading ? null : <RefreshCw aria-hidden />}
              Refresh
            </Button>
          </>
        }
      />

      {activeSchedule ? (
        <p className="text-ink-500 -mt-2 text-xs">
          Showing only <span className="text-ink-700 font-medium">{activeSchedule.name}</span>. The
          same schedule stays selected on Attendance, Corrections, and Employee DTR.
        </p>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Could not load the dashboard">
          {error}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Active students"
          value={data?.total_employees ?? 0}
          icon={Users}
          tone="brand"
          hint="Approved and able to time in"
          loading={loading && !data}
        />
        <StatCard
          label="Present today"
          value={data?.present_today ?? 0}
          icon={UserCheck}
          tone="success"
          hint={data ? formatDateOnly(data.date) : undefined}
          loading={loading && !data}
        />
        <StatCard
          label="Late today"
          value={data?.late_today ?? 0}
          icon={Clock}
          tone="warning"
          hint="Past the grace period"
          loading={loading && !data}
        />
        <StatCard
          label="Absent today"
          value={data?.absent_today ?? 0}
          icon={CalendarDays}
          tone="danger"
          hint="Scheduled but no time-in"
          loading={loading && !data}
        />
        <StatCard
          label="Clocked in now"
          value={data?.currently_working ?? 0}
          icon={Activity}
          tone="info"
          hint="Open sessions"
          loading={loading && !data}
        />
        <StatCard
          label="Hours today"
          value={formatMinutes(data?.worked_minutes_today ?? 0)}
          icon={Timer}
          tone="brand"
          hint="Total worked across all students"
          loading={loading && !data}
        />
        <StatCard
          label="Pending approvals"
          value={data?.pending_onboarding ?? 0}
          icon={TrendingUp}
          tone="warning"
          hint="OJT profiles awaiting review"
          loading={loading && !data}
        />
        <StatCard
          label="Pending corrections"
          value={data?.pending_corrections ?? 0}
          icon={Wrench}
          tone="neutral"
          hint="Attendance fixes to review"
          loading={loading && !data}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Attendance trend</CardTitle>
              <CardDescription>Present and late counts over the last 14 days.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {loading && !data ? (
              <Skeleton className="h-64 w-full" />
            ) : chartData.length === 0 ? (
              <EmptyState
                title="No attendance yet"
                description="The chart fills in as students time in."
                className="border-0 py-8"
              />
            ) : (
              <div className="h-56 w-full sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-ink-200)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={12}
                      tick={{ fontSize: 11, fill: 'var(--color-ink-500)' }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: 'var(--color-ink-500)' }}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 10,
                        borderColor: 'var(--color-ink-200)',
                        backgroundColor: 'var(--color-surface)',
                        color: 'var(--color-ink-700)',
                        fontSize: 12,
                        boxShadow: '0 10px 30px -10px rgb(23 32 25 / 0.18)',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-ink-500)' }} />
                    <Bar
                      dataKey="present"
                      name="Present"
                      fill="var(--color-brand-500)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={26}
                    />
                    <Bar
                      dataKey="late"
                      name="Late"
                      fill="var(--color-warning-600)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={26}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>By department</CardTitle>
              <CardDescription>Active students per department.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {loading && !data ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (data?.departments.length ?? 0) === 0 ? (
              <p className="text-ink-500 text-sm">No departments recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {data?.departments.map((department) => {
                  const max = Math.max(...(data?.departments.map((d) => d.count) ?? [1]), 1)
                  return (
                    <li key={department.department}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                        <span className="text-ink-700 truncate">{department.department}</span>
                        <span className="numeric text-ink-500 text-xs">
                          {pluralize(department.count, 'student')}
                        </span>
                      </div>
                      <div className="bg-ink-100 h-1.5 overflow-hidden rounded-full">
                        <div
                          className="bg-brand-500 h-full rounded-full"
                          style={{ width: `${Math.max(6, (department.count / max) * 100)}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent punches</CardTitle>
            <CardDescription>The latest time-in and time-out activity.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {loading && !data ? (
            <div className="px-5 pb-5">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (data?.recent.length ?? 0) === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                title="No punches yet"
                description="Punches appear here as soon as students use the time clock."
                className="border-0 py-8"
              />
            </div>
          ) : (
            <>
              <ul className="divide-ink-100 divide-y sm:hidden">
                {data?.recent.map((punch) => (
                  <li
                    key={`${punch.employee_id}-${punch.time_in}`}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-ink-900 truncate text-sm font-medium">
                        {punch.employee_name}
                      </p>
                      <p className="text-ink-500 mt-0.5 text-xs">
                        {formatDateOnly(punch.work_date)} · in {formatTime(punch.time_in)}
                      </p>
                    </div>
                    <span className="numeric text-ink-700 shrink-0 text-xs font-medium">
                      {punch.time_out ? (
                        `out ${formatTime(punch.time_out)}`
                      ) : (
                        <span className="text-success-700">Open</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <TableWrapper className="hidden rounded-none border-x-0 border-b-0 sm:block">
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Student</TableHeaderCell>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell>Time in</TableHeaderCell>
                      <TableHeaderCell>Time out</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {data?.recent.map((punch) => (
                      <TableRow key={`${punch.employee_id}-${punch.time_in}`}>
                        <TableCell>
                          <p className="text-ink-900 font-medium">{punch.employee_name}</p>
                          <p className="text-ink-500 numeric text-xs">{punch.employee_no}</p>
                        </TableCell>
                        <TableCell className="text-ink-600">
                          {formatDateOnly(punch.work_date)}
                        </TableCell>
                        <TableCell className="numeric">{formatTime(punch.time_in)}</TableCell>
                        <TableCell className="numeric">
                          {punch.time_out ? (
                            formatTime(punch.time_out)
                          ) : (
                            <span className="text-success-700 font-medium">Open</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
