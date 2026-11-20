import { useCallback, useEffect, useState } from 'react'
import { FileSearch, RefreshCw, ScrollText, Search } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Pagination } from '@/components/ui/pagination'
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
import { formatDateTime } from '@/lib/dates'
import { ROLE_LABELS } from '@/lib/constants'
import { errorMessage, pluralize, isSessionError, SESSION_EXPIRED_MESSAGE } from '@/lib/utils'
import type { AuditLogItem, AuditLogPage } from '@/types'

function friendly(message: string): string {
  if (isSessionError(message)) return SESSION_EXPIRED_MESSAGE
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The database is missing the audit migration. Apply 20261119001200_audit_logs.sql, then reload.'
  }
  if (message.includes('FORBIDDEN')) return 'Only administrators can read the audit trail.'
  return message
}

function pretty(value: Record<string, unknown> | null): string {
  if (!value) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function AuditPage() {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [data, setData] = useState<AuditLogPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AuditLogItem | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: result, error: rpcError } = await getSupabase().rpc('list_audit_logs', {
        p_search: debounced || null,
        p_page: page,
        p_page_size: pageSize,
      })
      if (rpcError) throw rpcError
      setData(result as AuditLogPage)
    } catch (caught) {
      setError(friendly(errorMessage(caught)))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [debounced, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const items = data?.items ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Audit trail"
        description="Read-only history of approvals, schedule and employee changes, punches, and correction decisions."
        actions={
          <Button variant="outline" onClick={() => void load()} loading={loading}>
            {loading ? null : <RefreshCw aria-hidden />}
            Refresh
          </Button>
        }
      />

      {error ? (
        <Alert tone="danger" title="Audit problem">
          {error}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search
              className="text-ink-400 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search action, entity, or summary"
              aria-label="Search audit trail"
              className="pl-9"
            />
          </div>
          <p className="text-ink-500 text-xs">
            {loading ? 'Loading…' : pluralize(data?.total ?? 0, 'entry', 'entries')}
          </p>
        </CardContent>
      </Card>

      {error && items.length === 0 ? (
        <ErrorState
          title="Could not load the audit trail"
          description={error}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : loading && items.length === 0 ? (
        <TableWrapper>
          <TableSkeleton rows={8} columns={5} />
        </TableWrapper>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit entries"
          description={
            search
              ? 'Try a different action, entity, or summary.'
              : 'Approvals, edits, and correction decisions appear here as they happen.'
          }
        />
      ) : (
        <>
          <div className="space-y-2 sm:hidden">
            {items.map((item) => (
              <div
                key={item.id}
                className="surface-dark border-ink-200/80 shadow-card bg-surface rounded-xl border p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Badge tone="brand">{item.action}</Badge>
                    <p className="text-ink-500 mt-1.5 text-xs">
                      {formatDateTime(item.created_at)} · {item.actor_name ?? 'System'}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setDetail(item)}>
                    <FileSearch aria-hidden />
                    View
                  </Button>
                </div>
                <p className="text-ink-700 mt-2 line-clamp-2 text-xs">{item.summary ?? '—'}</p>
                <p className="text-ink-400 numeric mt-1 truncate text-[11px]">
                  {item.entity_type}
                  {item.entity_id ? ` · ${item.entity_id}` : ''}
                </p>
              </div>
            ))}
          </div>

          <TableWrapper className="hidden sm:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>When</TableHeaderCell>
                  <TableHeaderCell>Actor</TableHeaderCell>
                  <TableHeaderCell>Action</TableHeaderCell>
                  <TableHeaderCell>Entity</TableHeaderCell>
                  <TableHeaderCell>Summary</TableHeaderCell>
                  <TableHeaderCell className="text-right">Details</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-ink-500 text-xs">
                      {formatDateTime(item.created_at)}
                    </TableCell>
                    <TableCell>
                      <p className="text-ink-800">{item.actor_name ?? 'System'}</p>
                      {item.actor_role ? (
                        <p className="text-ink-500 text-xs">{ROLE_LABELS[item.actor_role]}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge tone="brand">{item.action}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>{item.entity_type}</p>
                      {item.entity_id ? (
                        <p className="text-ink-400 numeric max-w-40 truncate">{item.entity_id}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-xs truncate whitespace-normal">
                      {item.summary ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(item)}>
                        <FileSearch aria-hidden />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </>
      )}

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="Audit entry"
        description={detail ? `${detail.action} · ${formatDateTime(detail.created_at)}` : undefined}
        size="lg"
        footer={
          <Button variant="outline" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail ? (
          <div className="space-y-4">
            <dl className="divide-ink-100 border-ink-200 divide-y rounded-lg border text-sm">
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-500">Actor</dt>
                <dd className="text-ink-900 font-medium">
                  {detail.actor_name ?? 'System'}
                  {detail.actor_role ? ` (${ROLE_LABELS[detail.actor_role]})` : ''}
                </dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-500">Entity</dt>
                <dd className="text-ink-900 numeric text-xs">
                  {detail.entity_type}
                  {detail.entity_id ? ` · ${detail.entity_id}` : ''}
                </dd>
              </div>
              <div className="px-3 py-2">
                <dt className="text-ink-500">Summary</dt>
                <dd className="text-ink-800 mt-1">{detail.summary ?? '—'}</dd>
              </div>
            </dl>

            <div className="grid gap-3">
              <div>
                <p className="text-ink-600 mb-1.5 text-xs font-semibold tracking-wide uppercase">
                  Before
                </p>
                <pre className="bg-ink-50 text-ink-700 max-h-56 overflow-auto rounded-lg p-3 text-xs">
                  {pretty(detail.before_data)}
                </pre>
              </div>
              <div>
                <p className="text-ink-600 mb-1.5 text-xs font-semibold tracking-wide uppercase">
                  After
                </p>
                <pre className="bg-ink-50 text-ink-700 max-h-56 overflow-auto rounded-lg p-3 text-xs">
                  {pretty(detail.after_data)}
                </pre>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
