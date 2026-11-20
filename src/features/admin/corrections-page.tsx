import { useCallback, useEffect, useState } from 'react'
import { Check, ClipboardCheck, RefreshCw, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { CorrectionBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Field, Textarea } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'
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
import { getSupabase } from '@/lib/supabase'
import { formatDateOnly, formatDateTime, formatTime } from '@/lib/dates'
import { CORRECTION_TYPE_LABELS } from '@/lib/constants'
import { errorMessage, pluralize, isSessionError, SESSION_EXPIRED_MESSAGE } from '@/lib/utils'
import { useScheduleScope } from '@/features/schedule/schedule-scope-context'
import type { CorrectionListItem } from '@/types'

type Decision = { request: CorrectionListItem; approve: boolean }

function friendly(message: string): string {
  if (isSessionError(message)) return SESSION_EXPIRED_MESSAGE
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The database is missing the corrections migration. Apply 20261119001000_corrections.sql, then reload.'
  }
  if (message.includes('CORRECTION_CONFLICT')) {
    return 'The requested times overlap another punch or break the time order. Adjust or reject the request.'
  }
  if (message.includes('NO_SESSION_TO_COMPLETE')) {
    return 'There is no punch on that date to complete. Use “incorrect timestamp” instead.'
  }
  if (message.includes('ALREADY_REVIEWED')) return 'This request has already been reviewed.'
  if (message.includes('FORBIDDEN'))
    return 'Only administrators and supervisors can review requests.'
  return message
}

export function CorrectionsPage() {
  const { scheduleId, setScheduleId, schedules, activeSchedule } = useScheduleScope()
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [items, setItems] = useState<CorrectionListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [decision, setDecision] = useState<Decision | null>(null)
  const [notes, setNotes] = useState('')
  const [notesError, setNotesError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('list_corrections', {
        p_status: status || null,
        p_page: page,
        p_page_size: pageSize,
        p_schedule_id: scheduleId || null,
      })
      if (rpcError) throw rpcError
      const result = data as { items: CorrectionListItem[]; total: number }
      setItems(result.items)
      setTotal(result.total)
    } catch (caught) {
      setError(friendly(errorMessage(caught)))
    } finally {
      setLoading(false)
    }
  }, [status, page, pageSize, scheduleId])

  useEffect(() => {
    void load()
  }, [load])

  function openDecision(request: CorrectionListItem, approve: boolean) {
    setDecision({ request, approve })
    setNotes('')
    setNotesError(null)
    setDecisionError(null)
  }

  async function submitDecision() {
    if (!decision) return
    const trimmed = notes.trim()
    if (!decision.approve && trimmed.length < 5) {
      setNotesError('Give a short reason for rejecting (at least 5 characters).')
      return
    }

    setBusy(true)
    setDecisionError(null)
    try {
      const { error: rpcError } = await getSupabase().rpc('review_correction', {
        p_id: decision.request.id,
        p_approve: decision.approve,
        p_notes: trimmed || null,
      })
      if (rpcError) throw rpcError
      setNotice(
        decision.approve
          ? `Approved ${decision.request.employee_name}'s correction for ${formatDateOnly(
              decision.request.work_date,
            )}. The DTR was recomputed.`
          : `Rejected ${decision.request.employee_name}'s request.`,
      )
      setDecision(null)
      await load()
    } catch (caught) {
      setDecisionError(friendly(errorMessage(caught)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Attendance corrections"
        description="Review punch fixes. Approval applies the change and snapshots the original values; nothing is overwritten silently."
        actions={
          <Button variant="outline" onClick={() => void load()} loading={loading}>
            {loading ? null : <RefreshCw aria-hidden />}
            Refresh
          </Button>
        }
      />

      {notice ? (
        <Alert tone="success" title="Saved">
          {notice}
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Correction problem">
          {error}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-[13rem_13rem_1fr] sm:items-end">
          <Field label="Status" htmlFor="correction-status">
            <Select
              id="correction-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
              }}
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
              <option value="">All requests</option>
            </Select>
          </Field>
          <Field label="Schedule" htmlFor="correction-schedule">
            <Select
              id="correction-schedule"
              value={scheduleId}
              onChange={(event) => {
                setScheduleId(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All schedules</option>
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-ink-500 text-xs sm:justify-self-end">
            {loading
              ? 'Loading…'
              : `${pluralize(total, 'request')}${
                  activeSchedule ? ` in ${activeSchedule.name}` : ''
                }`}
          </p>
        </CardContent>
      </Card>

      {error && items.length === 0 ? (
        <ErrorState
          title="Could not load correction requests"
          description={error}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : loading && items.length === 0 ? (
        <TableWrapper>
          <TableSkeleton rows={6} columns={7} />
        </TableWrapper>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={status === 'pending' ? 'Nothing to review' : 'No requests found'}
          description={
            status === 'pending'
              ? 'Students can request fixes from their DTR when a punch is missing or wrong.'
              : 'Try a different status filter.'
          }
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Requested</TableHeaderCell>
                  <TableHeaderCell>Reason</TableHeaderCell>
                  <TableHeaderCell>Filed</TableHeaderCell>
                  <TableHeaderCell className="text-right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="text-ink-900 font-medium">{item.employee_name}</p>
                      <p className="text-ink-500 numeric text-xs">{item.employee_no}</p>
                    </TableCell>
                    <TableCell className="numeric">{formatDateOnly(item.work_date)}</TableCell>
                    <TableCell>{CORRECTION_TYPE_LABELS[item.correction_type]}</TableCell>
                    <TableCell className="numeric text-xs">
                      {item.requested_time_in ? formatTime(item.requested_time_in) : '—'} –{' '}
                      {item.requested_time_out ? formatTime(item.requested_time_out) : '—'}
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal">{item.reason}</TableCell>
                    <TableCell className="text-ink-500 text-xs">
                      {formatDateTime(item.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {item.status === 'pending' ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openDecision(item, false)}
                            >
                              <X aria-hidden />
                              Reject
                            </Button>
                            <Button size="sm" onClick={() => openDecision(item, true)}>
                              <Check aria-hidden />
                              Approve
                            </Button>
                          </>
                        ) : (
                          <CorrectionBadge status={item.status} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </>
      )}

      <Modal
        open={decision !== null}
        onClose={() => {
          if (!busy) setDecision(null)
        }}
        title={decision?.approve ? 'Approve correction' : 'Reject correction'}
        description={
          decision
            ? `${decision.request.employee_name} · ${formatDateOnly(decision.request.work_date)}`
            : undefined
        }
        size="lg"
        preventClose={busy}
        footer={
          <>
            <Button variant="outline" onClick={() => setDecision(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={decision?.approve ? 'primary' : 'danger'}
              onClick={() => void submitDecision()}
              loading={busy}
            >
              {decision?.approve ? 'Approve and apply' : 'Reject request'}
            </Button>
          </>
        }
      >
        {decision ? (
          <div className="space-y-4">
            {decisionError ? (
              <Alert tone="danger" title="Could not review the request">
                {decisionError}
              </Alert>
            ) : null}

            <dl className="divide-ink-100 border-ink-200 divide-y rounded-lg border text-sm">
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-500">Type</dt>
                <dd className="text-ink-900 font-medium">
                  {CORRECTION_TYPE_LABELS[decision.request.correction_type]}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-500">Requested time in</dt>
                <dd className="numeric text-ink-900">
                  {decision.request.requested_time_in
                    ? formatDateTime(decision.request.requested_time_in)
                    : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-500">Requested time out</dt>
                <dd className="numeric text-ink-900">
                  {decision.request.requested_time_out
                    ? formatDateTime(decision.request.requested_time_out)
                    : '—'}
                </dd>
              </div>
              <div className="px-3 py-2">
                <dt className="text-ink-500">Reason</dt>
                <dd className="text-ink-800 mt-1 whitespace-pre-wrap">{decision.request.reason}</dd>
              </div>
            </dl>

            <Field
              label={decision.approve ? 'Review notes (optional)' : 'Reason for rejection'}
              htmlFor="review-notes"
              error={notesError ?? undefined}
              hint={
                decision.approve
                  ? 'Stored with the approved request and visible to the student.'
                  : 'Stored with the request and visible to the student.'
              }
              required={!decision.approve}
            >
              <Textarea
                id="review-notes"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value)
                  if (notesError) setNotesError(null)
                }}
                placeholder={
                  decision.approve
                    ? 'Verified against the class logbook.'
                    : 'The requested time does not match the logbook.'
                }
              />
            </Field>

            {decision.approve ? (
              <Alert tone="warning" title="This changes the official record">
                The punch is updated, the day is recomputed (worked, late, undertime, overtime), and
                the original values stay in the audit trail.
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
