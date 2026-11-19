import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context'
import { LoadingState } from '@/components/ui/spinner'

/**
 * Sits inside `<RequireAuth />`. Sends accounts that have not finished
 * onboarding (or are still waiting for approval) to the right screen, so the
 * application shell is never rendered for them.
 */
export function RequireApproved() {
  const { onboarding, profileLoading, profile } = useAuth()
  const location = useLocation()

  if (profileLoading && !profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingState label="Loading your account…" />
      </div>
    )
  }

  if (onboarding === 'needs_onboarding') {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />
  }

  if (onboarding === 'pending' || onboarding === 'inactive') {
    return <Navigate to="/pending-approval" replace />
  }

  return <Outlet />
}
