import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { CalendarClock, LogOut, Menu, UserRound, X } from 'lucide-react'
import { useAuth } from '@/features/auth/auth-context'
import { useScheduleScope } from '@/features/schedule/schedule-scope-context'
import { env } from '@/lib/env'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SidebarNav, type NavGroup, type NavItem } from './sidebar-nav'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/** The nav item whose path best matches the current location. */
function currentItem(navigation: NavGroup[], pathname: string): NavItem | null {
  const items = navigation.flatMap((group) => group.items)
  const matches = items.filter((item) =>
    item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`),
  )
  return matches.sort((a, b) => b.to.length - a.to.length)[0] ?? null
}

function UserMenu() {
  const { profile, role, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleSignOut = useCallback(async () => {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }, [signOut])

  const [firstName = '', lastName = ''] = (profile?.full_name ?? '').split(' ')
  const roleLabel =
    role === 'admin' ? 'Administrator' : role === 'supervisor' ? 'Supervisor' : 'Employee'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="hover:bg-ink-100 flex items-center gap-2.5 rounded-lg py-1 pr-1.5 pl-1 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar
          firstName={firstName}
          lastName={lastName || firstName}
          src={profile?.avatar_url}
          size="sm"
        />
        <span className="hidden text-left sm:block">
          <span className="text-ink-800 block max-w-40 truncate text-xs font-semibold">
            {profile?.full_name ?? 'Account'}
          </span>
          <span className="text-ink-500 block text-[11px]">{roleLabel}</span>
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="shadow-popover border-ink-200 absolute right-0 z-30 mt-2 w-60 rounded-xl border bg-white p-1.5"
        >
          <div className="border-ink-100 border-b px-2.5 py-2">
            <p className="text-ink-900 truncate text-sm font-semibold">{profile?.full_name}</p>
            <p className="text-ink-500 truncate text-xs">{profile?.email}</p>
          </div>
          <Link
            to="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="text-ink-700 hover:bg-ink-50 mt-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm"
          >
            <UserRound className="size-4" aria-hidden />
            My account
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="text-danger-700 hover:bg-danger-50 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Global schedule scope. Pick a schedule once and every administrative view
 * follows it, so a single group can be tracked from the first tab to the last.
 */
function ScheduleScopePicker({ compact = false }: { compact?: boolean }) {
  const { role } = useAuth()
  const { scheduleId, setScheduleId, schedules, loading } = useScheduleScope()

  if (role !== 'admin' && role !== 'supervisor') return null

  return (
    <div className={cn('flex items-center gap-2', compact ? 'w-full' : 'hidden md:flex')}>
      <CalendarClock className="text-ink-400 size-4 shrink-0" aria-hidden />
      <Select
        value={scheduleId}
        onChange={(event) => setScheduleId(event.target.value)}
        aria-label="Schedule filter for every administrative view"
        className={cn('h-9', compact ? 'w-full' : 'w-52')}
      >
        <option value="">All schedules</option>
        {schedules.map((schedule) => (
          <option key={schedule.id} value={schedule.id}>
            {schedule.name}
            {schedule.is_active ? '' : ' (inactive)'}
          </option>
        ))}
      </Select>
      {!compact && !loading && schedules.length === 0 ? (
        <span className="text-ink-400 hidden text-[11px] xl:inline">No schedules yet</span>
      ) : null}
    </div>
  )
}

/** Thumb-reachable navigation for phones; "More" opens the full drawer. */
function MobileTabBar({
  items,
  onMore,
  activePath,
}: {
  items: NavItem[]
  onMore: () => void
  activePath: string
}) {
  return (
    <nav
      className="border-ink-200 fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      aria-label="Quick navigation"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = item.end
            ? activePath === item.to
            : activePath === item.to || activePath.startsWith(`${item.to}/`)
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={cn(
                  'flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors',
                  active ? 'text-brand-700' : 'text-ink-500',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <span
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg',
                    active && 'bg-brand-50',
                  )}
                >
                  <item.icon className="size-[18px]" aria-hidden />
                </span>
                <span className="max-w-full truncate px-0.5">{item.label}</span>
              </NavLink>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={onMore}
            className="text-ink-500 flex w-full flex-col items-center gap-1 py-2 text-[10px] font-medium"
            aria-label="Open all navigation"
          >
            <span className="flex size-8 items-center justify-center rounded-lg">
              <Menu className="size-[18px]" aria-hidden />
            </span>
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}

export function AppShell({ navigation }: { navigation: NavGroup[] }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const now = useClock()
  const { profile, role } = useAuth()

  const active = currentItem(navigation, location.pathname)
  const isReviewer = role === 'admin' || role === 'supervisor'

  const quickPaths = isReviewer
    ? ['/admin/dashboard', '/admin/attendance', '/admin/corrections', '/admin/dtr']
    : ['/', '/dtr', '/my-schedule', '/corrections']
  const quickItems = quickPaths
    .map((path) => navigation.flatMap((group) => group.items).find((item) => item.to === path))
    .filter((item): item is NavItem => Boolean(item))

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  const brand = (
    <Link to="/" className="flex items-center gap-2.5 px-3 py-1" aria-label={env.appName}>
      <span className="bg-brand-600 flex size-9 items-center justify-center rounded-lg text-white shadow-xs">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 8v4l2.8 2"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="text-ink-900 block truncate text-sm leading-tight font-semibold">
          {env.appName}
        </span>
        <span className="text-ink-500 block truncate text-[11px]">{env.orgName}</span>
      </span>
    </Link>
  )

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="border-ink-200 fixed inset-y-0 left-0 z-30 hidden w-68 flex-col border-r bg-white lg:flex">
        <div className="border-ink-100 flex h-16 items-center border-b px-2">{brand}</div>
        <SidebarNav groups={navigation} />
        <div className="border-ink-100 border-t px-4 py-3">
          <p className="text-ink-400 text-[10px] font-medium tracking-wider uppercase">
            {env.timezone.replace('_', ' ')}
          </p>
          <p className="numeric text-ink-600 mt-0.5 text-xs">
            {now.toLocaleDateString('en-PH', {
              timeZone: env.timezone,
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="bg-ink-950/40 absolute inset-0 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div
            className="relative flex h-full w-80 max-w-[88vw] flex-col bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="border-ink-100 flex h-16 items-center justify-between border-b pr-3">
              {brand}
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              >
                <X />
              </Button>
            </div>
            {isReviewer ? (
              <div className="border-ink-100 border-b px-4 py-3">
                <p className="text-ink-400 mb-1.5 text-[10px] font-semibold tracking-widest uppercase">
                  Tracking schedule
                </p>
                <ScheduleScopePicker compact />
              </div>
            ) : null}
            <SidebarNav groups={navigation} onNavigate={() => setMobileOpen(false)} />
            <div className="border-ink-100 border-t px-4 py-3">
              <p className="text-ink-700 truncate text-xs font-medium">{profile?.full_name}</p>
              <p className="text-ink-500 truncate text-xs">{profile?.email}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="lg:pl-68">
        <header className="border-ink-200/80 sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
            <p className="min-w-0 truncate text-sm">
              <span className="text-ink-400 hidden sm:inline">{env.orgName}</span>
              <span className="text-ink-300 mx-2 hidden sm:inline">/</span>
              <span className="text-ink-800 font-medium">{active?.label ?? 'Workspace'}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ScheduleScopePicker />
            <span className="bg-ink-100 hidden h-6 w-px sm:block" aria-hidden />
            <UserMenu />
          </div>
        </header>

        <main
          className={cn(
            'mx-auto w-full max-w-7xl px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 lg:pt-8 lg:pb-10',
          )}
        >
          <Outlet />
        </main>
      </div>

      <MobileTabBar
        items={quickItems}
        activePath={location.pathname}
        onMore={() => setMobileOpen(true)}
      />
    </div>
  )
}
