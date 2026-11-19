import { createContext, useContext } from 'react'
import type { WorkSchedule } from '@/types'

export const SCHEDULE_SCOPE_STORAGE_KEY = 'dtr.scheduleScope'

export interface ScheduleScopeValue {
  /** Selected schedule id, or '' for every schedule. */
  scheduleId: string
  setScheduleId: (id: string) => void
  schedules: WorkSchedule[]
  activeSchedule: WorkSchedule | null
  loading: boolean
  reload: () => Promise<void>
}

export const ScheduleScopeContext = createContext<ScheduleScopeValue | null>(null)

export function useScheduleScope(): ScheduleScopeValue {
  const context = useContext(ScheduleScopeContext)
  if (!context) throw new Error('useScheduleScope must be used inside ScheduleScopeProvider')
  return context
}
