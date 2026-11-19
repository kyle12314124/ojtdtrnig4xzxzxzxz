import { Mail, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '@/features/auth/auth-context'
import { env } from '@/lib/env'
import { formatDateTime } from '@/lib/dates'
import { ROLE_LABELS } from '@/lib/constants'
import { Alert } from '@/components/ui/alert'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'

export function AccountPage() {
  const { profile } = useAuth()

  const nameParts = (profile?.full_name ?? '').split(' ')
  const firstName = nameParts[0] ?? ''
  const lastName = nameParts.slice(1).join(' ')

  return (
    <div className="space-y-6">
      <PageHeader
        title="My account"
        description="Your identity and access details. Contact your HR administrator to request changes."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <Badge tone="brand">{profile?.role ? ROLE_LABELS[profile.role] : '—'}</Badge>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Avatar
                firstName={firstName}
                lastName={lastName}
                src={profile?.avatar_url}
                size="xl"
              />
              <div className="min-w-0">
                <p className="text-ink-900 truncate text-lg font-semibold">{profile?.full_name}</p>
                <p className="text-ink-500 truncate text-sm">{profile?.email}</p>
                <Badge tone={profile?.is_active ? 'success' : 'danger'} dot className="mt-1.5">
                  {profile?.is_active ? 'Active account' : 'Inactive account'}
                </Badge>
              </div>
            </div>

            <dl className="border-ink-100 mt-6 grid gap-4 border-t pt-5 sm:grid-cols-2">
              <div>
                <dt className="text-ink-500 flex items-center gap-1.5 text-xs">
                  <Mail className="size-3.5" aria-hidden />
                  Email
                </dt>
                <dd className="text-ink-800 mt-1 text-sm font-medium break-all">
                  {profile?.email ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500 flex items-center gap-1.5 text-xs">
                  <Phone className="size-3.5" aria-hidden />
                  Phone
                </dt>
                <dd className="text-ink-800 mt-1 text-sm font-medium">
                  {profile?.phone ?? 'Not provided'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500 flex items-center gap-1.5 text-xs">
                  <UserRound className="size-3.5" aria-hidden />
                  Account created
                </dt>
                <dd className="text-ink-800 mt-1 text-sm font-medium">
                  {formatDateTime(profile?.created_at)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500 flex items-center gap-1.5 text-xs">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  Timezone
                </dt>
                <dd className="text-ink-800 mt-1 text-sm font-medium">{env.timezone}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-ink-500 text-xs">Role</p>
              <p className="text-ink-800 mt-1 text-sm font-medium">
                {profile?.role ? ROLE_LABELS[profile.role] : '—'}
              </p>
            </div>
            <div>
              <p className="text-ink-500 text-xs">Permissions</p>
              <ul className="text-ink-600 mt-1.5 space-y-1 text-xs leading-relaxed">
                {profile?.role === 'admin' ? (
                  <>
                    <li>• Manage employees and schedules</li>
                    <li>• View all attendance records</li>
                    <li>• Approve corrections and export reports</li>
                  </>
                ) : profile?.role === 'supervisor' ? (
                  <>
                    <li>• Review assigned employees</li>
                    <li>• Approve or reject corrections</li>
                    <li>• View team attendance</li>
                  </>
                ) : (
                  <>
                    <li>• Record your own time in/out</li>
                    <li>• View your attendance history</li>
                    <li>• Request attendance corrections</li>
                  </>
                )}
              </ul>
            </div>
            <Alert tone="info">
              Profile editing, including name and contact details, is handled by HR so official
              records stay consistent.
            </Alert>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
