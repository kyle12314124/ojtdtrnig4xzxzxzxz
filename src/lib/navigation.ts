import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  FileText,
  ScrollText,
  UserCheck,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react'
import type { NavGroup } from '@/components/layout/sidebar-nav'
import type { UserRole } from '@/types'

/**
 * Navigation is derived from the authenticated role. Routes are only listed
 * once their feature is implemented, so every visible link resolves to a
 * working page.
 */
export function getNavigation(role: UserRole | null): NavGroup[] {
  const isAdmin = role === 'admin'
  const isSupervisor = role === 'supervisor'
  const canReview = isAdmin || isSupervisor

  const groups: NavGroup[] = [
    {
      label: 'My time',
      items: [
        { label: 'Workspace', to: '/', icon: CalendarDays, end: true },
        { label: 'My DTR', to: '/dtr', icon: FileText },
        { label: 'My schedule', to: '/my-schedule', icon: CalendarClock },
        { label: 'My corrections', to: '/corrections', icon: Wrench },
        { label: 'My account', to: '/account', icon: UserRound },
      ],
    },
  ]

  if (canReview) {
    const items: NavGroup['items'] = [
      { label: 'Dashboard', to: '/admin/dashboard', icon: BarChart3 },
      { label: 'Attendance', to: '/admin/attendance', icon: CalendarDays },
      { label: 'Corrections', to: '/admin/corrections', icon: ClipboardCheck },
      { label: 'Employee DTR', to: '/admin/dtr', icon: FileText },
    ]

    if (isAdmin) {
      items.push(
        { label: 'Employees', to: '/admin/employees', icon: Users },
        { label: 'OJT approvals', to: '/admin/approvals', icon: UserCheck },
        { label: 'Work schedules', to: '/admin/schedules', icon: CalendarClock },
        { label: 'Audit trail', to: '/admin/audit', icon: ScrollText },
      )
    }

    groups.push({ label: 'Administration', items })
  }

  return groups
}
