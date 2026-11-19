import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, RefreshCw, Wrench, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { CorrectionBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/modal'
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
import { errorMessage } from '@/lib/utils'
import type { CorrectionListItem } from '@/types'

function friendly(message: string): string {
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The database is missing the corrections migration. Apply 20261119001000_corrections.sql, then reload.'
  }
  return message
}

export function MyCorrectionsPage() {
  const [items, setItems] = useState<CorrectionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<CorrectionListItem | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await getSupabase().rpc('list_my_corrections', {
        p_limit: 100,
      })
      if (rpcError) throw rpcError
      setItems((data as CorrectionListItem[]) ?? [])
    } catch (caught) {
      setError(friendly(errorMessage(caught)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function cancel() {
    if (!cancelTarget) return
    setCancelling(true)
    setError(null)
    try {
      const { error: rpcError } = await getSupabase().rpc('cancel_correction', {
        p_id: cancelTarget.id,
      })
      if (rpcError) throw rpcError
      setNotice('Request cancelled.')
      setCancelTarget(null)
      await load()
    } catch (caught) {
      setError(friendly(errorMessage(caught)))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Time record"
        title="My correction requests"
        description="Ask for a missed or incorrect punch to be fixed. Original punches are snapshotted before any change."
        actions={
          <>
            <Button variant="outline" onClick={() => void load()} loading={loading}>
              {loading ? null : <RefreshCw aria-hidden />}
              Refresh
            </Button>
            <Link
              to="/dtr"
              className="bg-brand-600 hover:bg-brand-700 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white"
            >
              <Wrench className="size-4" aria-hidden />
              New request
            </Link>
          </>
        }
      />

      {notice ? (
        <Alert tone="success" title="Done">
          {notice}
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Correction problem">
          {error}
        </Alert>
      ) : null}

      {loading && items.length === 0 ? (
        <TableWrapper>
          <TableSkeleton rows={5} columns={6} />
        </TableWrapper>
      ) : error && items.length === 0 ? (
        <ErrorState
          title="Could not load your requests"
          description={error}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No correction requests"
          description="Open your DTR and use Request on a day whose punch is missing or wrong."
          action={
            <Link
              to="/dtr"
              className="bg-brand-600 hover:bg-brand-700 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white"
            >
              Open my DTR
            </Link>
          }
        />
      ) : (
        <>
          <div className="space-y-2 sm:hidden">
            {items.map((item) => (
              <div
                key={item.id}
                className="border-ink-200/80 shadow-card rounded-xl border bg-white p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="numeric text-ink-900 text-sm font-semibold">
                      {formatDateOnly(item.work_date)}
                    </p>
                    <p className="text-ink-500 mt-0.5 text-xs">
                      {CORRECTION_TYPE_LABELS[item.correction_type]}
                    </p>
                  </div>
                  <CorrectionBadge status={item.status} />
                </div>
                <p className="numeric text-ink-700 mt-2 text-xs">
                  Requested {item.requested_time_in ? formatTime(item.requested_time_in) : '—'} –{' '}
                  {item.requested_time_out ? formatTime(item.requested_time_out) : '—'}
                </p>
                <p className="text-ink-600 mt-1 line-clamp-2 text-xs">{item.reason}</p>
                {item.review_notes ? (
                  <p className="border-ink-100 text-ink-500 mt-2 border-l-2 pl-2 text-xs">
                    {item.review_notes}
                  </p>
                ) : null}
                <div className="border-ink-100 mt-3 flex items-center justify-between gap-2 border-t pt-2.5">
                  <p className="text-ink-400 text-[11px]">{formatDateTime(item.created_at)}</p>
                  {item.status === 'pending' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger-700 hover:bg-danger-50"
                      onClick={() => setCancelTarget(item)}
                    >
                      <X aria-hidden />
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <TableWrapper className="hidden sm:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Requested</TableHeaderCell>
                  <TableHeaderCell>Reason</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Filed</TableHeaderCell>
                  <TableHeaderCell className="text-right">Actions</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="numeric font-medium">
                      {formatDateOnly(item.work_date)}
                    </TableCell>
                    <TableCell>{CORRECTION_TYPE_LABELS[item.correction_type]}</TableCell>
                    <TableCell className="text-xs">
                      <span className="numeric">
                        {item.requested_time_in ? formatTime(item.requested_time_in) : '—'} –{' '}
                        {item.requested_time_out ? formatTime(item.requested_time_out) : '—'}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xs truncate whitespace-normal">
                      {item.reason}
                    </TableCell>
                    <TableCell>
                      <CorrectionBadge status={item.status} />
                      {item.review_notes ? (
                        <p className="text-ink-500 mt-1 max-w-xs text-xs">{item.review_notes}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-ink-500 text-xs">
                      {formatDateTime(item.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.status === 'pending' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger-700 hover:bg-danger-50"
                          onClick={() => setCancelTarget(item)}
                        >
                          <X aria-hidden />
                          Cancel
                        </Button>
                      ) : (
                        <span className="text-ink-400 text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        </>
      )}

      <Card>
        <CardContent className="text-ink-500 pt-4 text-xs leading-relaxed">
          Pending requests can be cancelled. Once approved, the corrected punch becomes part of your
          official DTR and the original values remain in the audit trail. Rejected requests keep the
          reviewer&apos;s note above.
        </CardContent>
      </Card>

      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => {
          if (!cancelling) setCancelTarget(null)
        }}
        onConfirm={() => void cancel()}
        title="Cancel this request?"
        description={
          cancelTarget
            ? `The ${CORRECTION_TYPE_LABELS[cancelTarget.correction_type].toLowerCase()} request for ${formatDateOnly(
                cancelTarget.work_date,
              )} will be withdrawn. You can submit a new one later.`
            : ''
        }
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        loading={cancelling}
      />
    </div>
  )
}
