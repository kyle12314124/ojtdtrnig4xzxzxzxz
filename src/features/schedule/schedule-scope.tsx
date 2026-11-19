import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSupabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/auth-context'
import {
  SCHEDULE_SCOPE_STORAGE_KEY as STORAGE_KEY,
  ScheduleScopeContext,
  type ScheduleScopeValue,
} from '@/features/schedule/schedule-scope-context'
import type { WorkSchedule } from '@/types'

function readStored(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * One schedule selection shared by every administrative view. Reviewers pick a
 * schedule once in the top bar and the dashboard, attendance list, correction
 * queue, employee directory, and employee DTR all narrow to that group.
 */
export function ScheduleScopeProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth()
  const canScope = role === 'admin' || role === 'supervisor'
  const [scheduleId, setScheduleIdState] = useState(readStored)
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!canScope) return
    setLoading(true)
    try {
      const { data, error } = await getSupabase().rpc('list_work_schedules')
      if (error) return
      const list = (data as WorkSchedule[] | null) ?? []
      setSchedules(list)
      setScheduleIdState((current) => {
        if (current && !list.some((schedule) => schedule.id === current)) {
          try {
            window.localStorage.removeItem(STORAGE_KEY)
          } catch {
            // Storage is optional; ignore private-mode failures.
          }
          return ''
        }
        return current
      })
    } finally {
      setLoading(false)
    }
  }, [canScope])

  useEffect(() => {
    void reload()
  }, [reload])

  const setScheduleId = useCallback((id: string) => {
    setScheduleIdState(id)
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage is optional; the in-memory selection still works.
    }
  }, [])

  const value = useMemo<ScheduleScopeValue>(
    () => ({
      scheduleId: canScope ? scheduleId : '',
      setScheduleId,
      schedules: canScope ? schedules : [],
      activeSchedule:
        (canScope ? schedules.find((schedule) => schedule.id === scheduleId) : undefined) ?? null,
      loading,
      reload,
    }),
    [canScope, scheduleId, schedules, loading, setScheduleId, reload],
  )

  return <ScheduleScopeContext.Provider value={value}>{children}</ScheduleScopeContext.Provider>
}
