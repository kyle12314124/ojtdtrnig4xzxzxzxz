import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/features/auth/auth-context'
import { isSupabaseConfigured } from '@/lib/env'
import { LoadingState } from '@/components/ui/spinner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { UserRole } from '@/types'

/** Blocks rendering until a valid session and linked profile exist. */
export function RequireAuth({ roles }: { roles?: UserRole[] }) {
  const { session, profile, initializing, profileLoading, profileError, refreshProfile, signOut } =
    useAuth()
  const location = useLocation()

  if (!isSupabaseConfigured) {
    return <Navigate to="/setup" replace state={{ from: location.pathname }} />
  }

  if (initializing) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingState label="Restoring your session…" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (profileLoading && !profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingState label="Loading your profile…" />
      </div>
    )
  }

  if (!profile) {
    const networkIssue = Boolean(
      profileError && /fetch|network|timeout|load failed|offline/i.test(profileError),
    )
    return (
      <div className="bg-canvas flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-md p-6">
          <h1 className="text-ink-900 text-lg font-semibold">
            {networkIssue ? 'Connection problem' : 'Account not provisioned'}
          </h1>
          <p className="text-ink-500 mt-2 text-sm">
            {networkIssue
              ? 'We could not reach the database. Check your internet connection, then try again.'
              : (profileError ??
                'Your sign-in succeeded, but no employee profile is linked to this account.')}
          </p>
          <Alert tone="info" className="mt-4">
            {networkIssue
              ? 'If the problem continues, the service may be briefly unavailable. Your attendance data is safe.'
              : 'Ask your administrator to verify that your account has a matching profile and employee record.'}
          </Alert>
          <div className="mt-5 flex gap-2">
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
            <Button onClick={() => void refreshProfile()}>
              {networkIssue ? 'Try again' : 'Retry'}
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  if (!profile.is_active) {
    return (
      <div className="bg-canvas flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-md p-6 text-center">
          <ShieldAlert className="text-danger-600 mx-auto size-8" aria-hidden />
          <h1 className="text-ink-900 mt-3 text-lg font-semibold">Account deactivated</h1>
          <p className="text-ink-500 mt-2 text-sm">
            This account is no longer active. Contact your administrator if you believe this is a
            mistake.
          </p>
          <Button variant="outline" className="mt-5" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Card>
      </div>
    )
  }

  if (roles && !roles.includes(profile.role)) {
    return (
      <div className="bg-canvas flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-md p-6 text-center">
          <ShieldAlert className="text-warning-600 mx-auto size-8" aria-hidden />
          <h1 className="text-ink-900 mt-3 text-lg font-semibold">Access restricted</h1>
          <p className="text-ink-500 mt-2 text-sm">
            Your role does not have permission to view this page.
          </p>
          <Button variant="outline" className="mt-5" onClick={() => history.back()}>
            Go back
          </Button>
        </Card>
      </div>
    )
  }

  return <Outlet />
}
