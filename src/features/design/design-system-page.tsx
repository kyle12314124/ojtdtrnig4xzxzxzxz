import { useState } from 'react'
import { Building2, CalendarClock, Inbox, UserPlus } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge, AttendanceBadge, CorrectionBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, Textarea } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/ui/page-header'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'
import { StatCard } from '@/components/ui/stat-card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/components/ui/table'

const swatches = [
  ['brand-600', 'bg-brand-600'],
  ['brand-100', 'bg-brand-100'],
  ['canvas', 'bg-canvas'],
  ['ink-900', 'bg-ink-900'],
  ['ink-100', 'bg-ink-100'],
  ['success-600', 'bg-success-600'],
  ['warning-600', 'bg-warning-600'],
  ['danger-600', 'bg-danger-600'],
  ['info-600', 'bg-info-600'],
] as const

export function DesignSystemPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [page, setPage] = useState(2)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:py-10">
      <PageHeader
        eyebrow="Developer"
        title="Design system"
        description="Living reference for the interface primitives. Sample content only — operational figures always come from the database. This route is compiled only in development builds."
      />

      <section className="space-y-3">
        <h2 className="text-ink-900 text-sm font-semibold">Palette</h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
          {swatches.map(([name, className]) => (
            <div key={name} className="border-ink-200 overflow-hidden rounded-lg border bg-white">
              <div className={`h-12 ${className}`} />
              <p className="text-ink-600 truncate px-2 py-1.5 font-mono text-[10px]">{name}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-ink-900 text-sm font-semibold">Typography</h2>
        <Card className="space-y-2 p-5">
          <p className="text-ink-900 text-2xl font-semibold tracking-tight">Page title / 24</p>
          <p className="text-ink-900 text-lg font-semibold">Section title / 18</p>
          <p className="text-ink-700 text-sm">
            Body copy / 14 — tabular figures: 08:00 AM · 1,234.56
          </p>
          <p className="text-ink-500 text-xs">Secondary caption / 12</p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-ink-900 text-sm font-semibold">Buttons</h2>
        <Card className="flex flex-wrap items-center gap-3 p-5">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-ink-900 text-sm font-semibold">Badges</h2>
        <Card className="flex flex-wrap items-center gap-2 p-5">
          <Badge>Neutral</Badge>
          <Badge tone="brand">Brand</Badge>
          <Badge tone="success" dot>
            Ready
          </Badge>
          <Badge tone="warning" dot>
            Pending
          </Badge>
          <Badge tone="danger" dot>
            Rejected
          </Badge>
          <AttendanceBadge status="present" />
          <AttendanceBadge status="late" />
          <AttendanceBadge status="absent" />
          <CorrectionBadge status="approved" />
          <CorrectionBadge status="pending" />
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-ink-900 text-sm font-semibold">Stat cards</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total employees" value="128" icon={Building2} />
          <StatCard
            label="Present today"
            value="112"
            icon={UserPlus}
            tone="success"
            hint="87.5% attendance"
          />
          <StatCard label="Late today" value="6" icon={CalendarClock} tone="warning" />
          <StatCard label="Pending corrections" value="3" icon={Inbox} tone="info" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-ink-900 text-sm font-semibold">Form controls</h2>
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Employee ID" htmlFor="demo-id" required hint="Format: EMP-0001">
            <Input id="demo-id" placeholder="EMP-0001" />
          </Field>
          <Field label="Department" htmlFor="demo-dept">
            <Select id="demo-dept" defaultValue="">
              <option value="" disabled>
                Select department
              </option>
              <option>Operations</option>
              <option>Finance</option>
            </Select>
          </Field>
          <Field label="Email" htmlFor="demo-email" error="Enter a valid email address.">
            <Input id="demo-email" type="email" aria-invalid defaultValue="not-an-email" />
          </Field>
          <Field label="Reason" htmlFor="demo-reason" className="sm:col-span-2">
            <Textarea id="demo-reason" placeholder="Describe the correction you are requesting…" />
          </Field>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-ink-900 text-sm font-semibold">Table + pagination</h2>
        <TableWrapper>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Employee</TableHeaderCell>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Time in</TableHeaderCell>
                <TableHeaderCell>Time out</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {[
                ['Juan Dela Cruz', 'Nov 18, 2026', '08:01 AM', '05:02 PM', 'present'],
                ['Maria Santos', 'Nov 18, 2026', '08:17 AM', '05:00 PM', 'late'],
                ['Alex Reyes', 'Nov 18, 2026', '—', '—', 'absent'],
              ].map(([name, date, timeIn, timeOut, status]) => (
                <TableRow key={name}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        size="sm"
                        firstName={name?.split(' ')[0]}
                        lastName={name?.split(' ')[1]}
                      />
                      <span className="text-ink-800 font-medium">{name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="numeric">{date}</TableCell>
                  <TableCell className="numeric">{timeIn}</TableCell>
                  <TableCell className="numeric">{timeOut}</TableCell>
                  <TableCell>
                    <AttendanceBadge status={status as 'present' | 'late' | 'absent'} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
        <Pagination
          page={page}
          pageSize={10}
          total={96}
          onPageChange={setPage}
          onPageSizeChange={() => undefined}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-ink-900 text-sm font-semibold">Empty state + dialog</h2>
        <EmptyState
          icon={Inbox}
          title="No attendance records yet"
          description="Once employees start recording time, their daily DTR entries will appear here."
          action={<Button onClick={() => setModalOpen(true)}>Open dialog</Button>}
        />
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Approve correction"
          description="This will update the attendance record and preserve the original values in the audit trail."
          footer={
            <>
              <Button variant="outline" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setModalOpen(false)}>Approve</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Reviewer notes" htmlFor="demo-notes">
              <Textarea id="demo-notes" placeholder="Optional context for the audit log…" />
            </Field>
            <Badge tone="warning">Demo only — no data is written</Badge>
          </div>
        </Modal>
      </section>
    </div>
  )
}
