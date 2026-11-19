import { Outlet } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { useAuth } from '@/features/auth/auth-context'
import { ScheduleScopeProvider } from '@/features/schedule/schedule-scope'
import { getNavigation } from '@/lib/navigation'

export function ProtectedLayout() {
  const { role } = useAuth()
  return (
    <ScheduleScopeProvider>
      <AppShell navigation={getNavigation(role)} />
    </ScheduleScopeProvider>
  )
}

/** Indirection point where each phase nests its new feature routes. */
export function FeatureRoutes() {
  return <Outlet />
}
