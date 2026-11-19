import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { CheckCircle2, Clock3, RefreshCw, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/features/auth/auth-context'
import { AuthFrame } from '@/components/layout/auth-frame'
import { formatDateTime } from '@/lib/dates'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function PendingApprovalPage() {
  const { employee, onboarding, profile, refreshProfile, signOut } = useAuth()
  const [refreshing, setRefreshing] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date>(() => new Date())

  useEffect(() => {
    if (onboarding !== 'pending') return
    const timer = window.setInterval(() => {
      void refreshProfile().then(() => setLastChecked(new Date()))
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [onboarding, refreshProfile])

  if (onboarding === 'active') {
    return <Navigate to="/" replace />
  }
  if (onboarding === 'needs_onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await refreshProfile()
      setLastChecked(new Date())
    } finally {
      setRefreshing(false)
    }
  }

  const isRejected = onboarding === 'inactive'

  return (
    <AuthFrame
      eyebrow={isRejected ? 'Account inactive' : 'Step 2 of 2'}
      title={isRejected ? 'Your account is not active' : 'Waiting for approval'}
      description={
        isRejected
          ? 'This OJT account has been deactivated or rejected. Contact your administrator if you believe this is a mistake.'
          : 'Your OJT details were submitted. An administrator will review your account shortly — this page updates automatically.'
      }
      width="lg"
      footer={
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      }
    >
      {isRejected ? (
        <Alert tone="danger" title="Access is closed">
          Your attendance cannot be recorded while the account is inactive. Ask your administrator
          to reactivate it.
        </Alert>
      ) : (
        <Alert tone="info" title="What happens next?">
          An administrator checks your student number and name against the class list, then approves
          the account. Time in and time out unlock immediately after approval.
        </Alert>
      )}

      <dl className="divide-ink-100 border-ink-200 mt-6 divide-y rounded-xl border">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <dt className="text-ink-500 text-xs font-medium tracking-wide uppercase">Account</dt>
          <dd className="text-ink-900 truncate text-sm font-medium">{profile?.email}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <dt className="text-ink-500 text-xs font-medium tracking-wide uppercase">Student no.</dt>
          <dd className="numeric text-ink-900 text-sm font-medium">
            {employee?.employee_no ?? '—'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <dt className="text-ink-500 text-xs font-medium tracking-wide uppercase">Name</dt>
          <dd className="text-ink-900 text-sm font-medium">
            {employee
              ? [employee.first_name, employee.middle_name, employee.last_name]
                  .filter(Boolean)
                  .join(' ')
              : '—'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <dt className="text-ink-500 text-xs font-medium tracking-wide uppercase">Position</dt>
          <dd className="text-ink-900 text-sm">{employee?.position ?? '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <dt className="text-ink-500 text-xs font-medium tracking-wide uppercase">Status</dt>
          <dd>
            {isRejected ? (
              <Badge tone="danger" dot>
                Inactive
              </Badge>
            ) : (
              <Badge tone="warning" dot>
                Pending approval
              </Badge>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-ink-400 flex items-center gap-1.5 text-[11px]">
          <Clock3 className="size-3.5" aria-hidden />
          Last checked {formatDateTime(lastChecked)}
        </p>
        <Button variant="outline" onClick={() => void handleRefresh()} loading={refreshing}>
          {refreshing ? null : <RefreshCw aria-hidden />}
          Check again
        </Button>
      </div>

      <div className="text-ink-500 mt-6 space-y-2 text-xs leading-relaxed">
        <p className="flex items-start gap-2">
          <CheckCircle2 className="text-success-600 mt-0.5 size-3.5 shrink-0" aria-hidden />
          Your submission is stored with an audit trail; nothing is silently edited.
        </p>
        <p className="flex items-start gap-2">
          <ShieldAlert className="text-ink-400 mt-0.5 size-3.5 shrink-0" aria-hidden />
          Do not create a second account — duplicate student numbers are rejected by the database.
        </p>
      </div>
    </AuthFrame>
  )
}
