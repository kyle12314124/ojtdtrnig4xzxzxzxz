import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, RefreshCw, Search, Settings2, UserCheck, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Field, Textarea } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { TableSkeleton } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/components/ui/table'
import { Toggle } from '@/components/ui/toggle'
import { useAuth } from '@/features/auth/auth-context'
import { getSupabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/dates'
import { errorMessage } from '@/lib/utils'
import type { OnboardingRequest, OnboardingSettings } from '@/types'

type PendingAction = { type: 'approve' | 'reject'; request: OnboardingRequest }

function describeSettingsError(message: string): string {
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The database is missing the automatic-approval migration. Apply 20261119000600_auto_approve.sql, then reload this page.'
  }
  return message
}

export function ApprovalsPage() {
  const { refreshProfile } = useAuth()
  const [requests, setRequests] = useState<OnboardingRequest[]>([])
  const [settings, setSettings] = useState<OnboardingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [action, setAction] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [autoModalOpen, setAutoModalOpen] = useState(false)
  const [applyPending, setApplyPending] = useState(true)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const client = getSupabase()
      const [requestsResult, settingsResult] = await Promise.all([
        client.rpc('list_onboarding_requests'),
        client.rpc('get_onboarding_settings'),
      ])
      if (requestsResult.error) throw requestsResult.error
      if (settingsResult.error) throw settingsResult.error

      setRequests((requestsResult.data as OnboardingRequest[] | null) ?? [])
      setSettings((settingsResult.data as OnboardingSettings | null) ?? null)
    } catch (error) {
      setLoadError(describeSettingsError(errorMessage(error)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return requests
    return requests.filter((request) =>
      [request.employee_no, request.full_name, request.email, request.position]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(term)),
    )
  }, [requests, search])

  function openAction(type: 'approve' | 'reject', request: OnboardingRequest) {
    setAction({ type, request })
    setReason('')
    setReasonError(null)
    setActionError(null)
  }

  function closeAction() {
    if (submitting) return
    setAction(null)
    setReason('')
    setReasonError(null)
    setActionError(null)
  }

  async function submitAction() {
    if (!action) return
    setActionError(null)
    const trimmed = reason.trim()
    if (action.type === 'reject' && trimmed.length < 5) {
      setReasonError('Give a short reason (at least 5 characters).')
      return
    }

    setSubmitting(true)
    try {
      const { error } = await getSupabase().rpc('review_onboarding', {
        p_employee_id: action.request.employee_id,
        p_approve: action.type === 'approve',
        p_notes: trimmed ? trimmed : null,
      })
      if (error) throw error

      setNotice(
        action.type === 'approve'
          ? `${action.request.full_name} was approved and can now record attendance.`
          : `${action.request.full_name}'s request was rejected.`,
      )
      setAction(null)
      setReason('')
      await Promise.all([load(), refreshProfile()])
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function applyAutoApprove(enabled: boolean, includePending: boolean) {
    setSettingsBusy(true)
    setSettingsError(null)
    try {
      const { data, error } = await getSupabase().rpc('set_auto_approve', {
        p_enabled: enabled,
        p_apply_pending: includePending,
      })
      if (error) throw error

      const result = data as { auto_approve_onboarding: boolean; approved_pending: number } | null
      setAutoModalOpen(false)
      setNotice(
        enabled
          ? result && result.approved_pending > 0
            ? `Automatic approval is on. ${result.approved_pending} pending student${
                result.approved_pending === 1 ? ' was' : 's were'
              } approved.`
            : 'Automatic approval is on. New students are activated as soon as they submit.'
          : 'Automatic approval is off. New students wait for your review.',
      )
      await Promise.all([load(), refreshProfile()])
    } catch (error) {
      setSettingsError(describeSettingsError(errorMessage(error)))
    } finally {
      setSettingsBusy(false)
    }
  }

  function handleToggle(next: boolean) {
    setNotice(null)
    setSettingsError(null)
    if (next) {
      setApplyPending((settings?.pending_count ?? 0) > 0)
      setAutoModalOpen(true)
      return
    }
    void applyAutoApprove(false, false)
  }

  const autoOn = settings?.auto_approve_onboarding ?? false

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="OJT approvals"
        description="Review student submissions before timekeeping unlocks. Approval is recorded in the audit trail."
        actions={
          <Button variant="outline" onClick={() => void load()} loading={loading}>
            {loading ? null : <RefreshCw aria-hidden />}
            Refresh
          </Button>
        }
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}

      {settingsError ? (
        <Alert tone="danger" title="Could not save the setting">
          {settingsError}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="text-ink-400 size-4" aria-hidden />
            Approval settings
          </CardTitle>
          {autoOn ? (
            <span className="bg-success-50 text-success-700 ring-success-100 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset">
              <span className="bg-success-600 size-1.5 rounded-full" aria-hidden />
              Automatic
            </span>
          ) : (
            <span className="bg-ink-100 text-ink-600 ring-ink-200 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset">
              Manual
            </span>
          )}
        </CardHeader>
        <CardContent>
          <Toggle
            id="auto-approve"
            checked={autoOn}
            disabled={settingsBusy || loading || !settings}
            onChange={handleToggle}
            label="Automatically approve new students"
            description={
              autoOn
                ? 'A student is activated as soon as they submit their OJT profile. Use this only while you can verify the class list yourself.'
                : 'When off, every submission waits in the queue below for your decision.'
            }
          />
          <p className="text-ink-400 mt-3 text-xs">
            {settings
              ? `Applies to every device. Last changed ${formatDateTime(settings.updated_at)}.`
              : 'Loading current settingâ€¦'}
            {settings && settings.pending_count > 0 ? ` Â· ${settings.pending_count} pending` : ''}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="text-ink-400 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, number, or email"
            aria-label="Search pending requests"
            className="pl-9"
          />
        </div>
        <p className="text-ink-500 text-xs">
          {requests.length} pending Â·{' '}
          {requests.length === 0 ? 'nothing to review' : 'oldest first'}
        </p>
      </div>

      {loadError ? (
        <ErrorState
          title="Could not load the approval queue"
          description={loadError}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : loading && requests.length === 0 ? (
        <TableWrapper>
          <TableSkeleton rows={4} columns={5} />
        </TableWrapper>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title={
            requests.length === 0
              ? autoOn
                ? 'Automatic approval is handling new students'
                : 'No pending submissions'
              : 'No matches'
          }
          description={
            requests.length === 0
              ? autoOn
                ? 'Turn the setting off to review each student before they can record attendance.'
                : 'When a classmate registers and submits their OJT details, they appear here for review.'
              : 'Try a different name, student number, or email.'
          }
        />
      ) : (
        <>
          <div className="space-y-2 sm:hidden">
            {filtered.map((request) => (
              <div
                key={request.employee_id}
                className="border-ink-200/80 shadow-card bg-surface rounded-xl border p-4"
              >
                <p className="text-ink-900 truncate text-sm font-semibold">{request.full_name}</p>
                <p className="text-ink-500 mt-0.5 truncate text-xs">{request.email}</p>
                <p className="text-ink-500 numeric mt-1 text-xs">
                  {request.employee_no} Â· {request.position ?? 'No position'} Â·{' '}
                  {request.schedule_name ?? 'Unassigned'}
                </p>
                <p className="text-ink-400 mt-1 text-[11px]">
                  Submitted {formatDateTime(request.submitted_at)}
                </p>
                <div className="border-ink-100 mt-3 flex gap-2 border-t pt-2.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => openAction('reject', request)}
                  >
                    <X aria-hidden />
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => openAction('approve', request)}
                  >
                    <Check aria-hidden />
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <TableWrapper className="hidden sm:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Student no.</TableHeaderCell>
                  <TableHeaderCell>Position</TableHeaderCell>
                  <TableHeaderCell>Schedule</TableHeaderCell>
                  <TableHeaderCell>Submitted</TableHeaderCell>
                  <TableHeaderCell className="text-right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {filtered.map((request) => (
                  <TableRow key={request.employee_id}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="text-ink-900 truncate font-medium">{request.full_name}</p>
                        <p className="text-ink-500 truncate text-xs">{request.email}</p>
                      </div>
                    </TableCell>
                    <TableCell className="numeric font-medium">{request.employee_no}</TableCell>
                    <TableCell>{request.position ?? 'â€”'}</TableCell>
                    <TableCell>{request.schedule_name ?? 'Unassigned'}</TableCell>
                    <TableCell className="text-ink-500 text-xs">
                      {formatDateTime(request.submitted_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openAction('reject', request)}
                        >
                          <X aria-hidden />
                          Reject
                        </Button>
                        <Button size="sm" onClick={() => openAction('approve', request)}>
                          <Check aria-hidden />
                          Approve
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        </>
      )}

      {/* Approve / reject a single request */}
      <Modal
        open={action !== null}
        onClose={closeAction}
        title={action?.type === 'approve' ? 'Approve OJT account' : 'Reject OJT account'}
        description={
          action?.type === 'approve'
            ? `Activate ${action.request.full_name} (${action.request.employee_no}) so they can record attendance.`
            : `Archive ${action?.request.full_name}'s submission. They will not be able to record attendance.`
        }
        preventClose={submitting}
        footer={
          <>
            <Button variant="outline" onClick={closeAction} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant={action?.type === 'approve' ? 'primary' : 'danger'}
              onClick={() => void submitAction()}
              loading={submitting}
            >
              {action?.type === 'approve' ? 'Approve account' : 'Reject request'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {actionError ? (
            <Alert tone="danger" title="Action failed">
              {actionError}
            </Alert>
          ) : null}

          {action?.type === 'reject' ? (
            <Field
              label="Reason for rejection"
              htmlFor="rejection-reason"
              error={reasonError ?? undefined}
              hint="Shared with the student in the audit trail. Be specific and respectful."
              required
            >
              <Textarea
                id="rejection-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value)
                  if (reasonError) setReasonError(null)
                }}
                placeholder="Student number does not match the class list."
                aria-invalid={Boolean(reasonError)}
              />
            </Field>
          ) : (
            <dl className="divide-ink-100 border-ink-200 divide-y rounded-lg border text-sm">
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-500">Student</dt>
                <dd className="text-ink-900 font-medium">{action?.request.full_name}</dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-500">Student no.</dt>
                <dd className="numeric text-ink-900 font-medium">{action?.request.employee_no}</dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-500">Schedule</dt>
                <dd className="text-ink-900">{action?.request.schedule_name ?? 'Unassigned'}</dd>
              </div>
            </dl>
          )}
        </div>
      </Modal>

      {/* Enable automatic approval */}
      <Modal
        open={autoModalOpen}
        onClose={() => {
          if (!settingsBusy) setAutoModalOpen(false)
        }}
        title="Turn on automatic approval?"
        description="New students will skip this queue and be able to record attendance immediately after submitting their OJT profile."
        size="sm"
        preventClose={settingsBusy}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setAutoModalOpen(false)}
              disabled={settingsBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void applyAutoApprove(true, applyPending)}
              loading={settingsBusy}
            >
              Turn on
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-ink-600 text-sm leading-relaxed">
            You remain responsible for verifying that every account belongs to a real classmate.
            Approvals made automatically are still recorded in the audit trail.
          </p>

          {(settings?.pending_count ?? 0) > 0 ? (
            <label className="border-ink-200 flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
              <input
                type="checkbox"
                checked={applyPending}
                onChange={(event) => setApplyPending(event.target.checked)}
                className="accent-brand-600 mt-0.5 size-4"
              />
              <span className="text-sm">
                <span className="text-ink-900 block font-medium">
                  Also approve the {settings?.pending_count} pending request
                  {settings?.pending_count === 1 ? '' : 's'}
                </span>
                <span className="text-ink-500 text-xs">
                  Otherwise they stay in the queue and only new submissions are automatic.
                </span>
              </span>
            </label>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
