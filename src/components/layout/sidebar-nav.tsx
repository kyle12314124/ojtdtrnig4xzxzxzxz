import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  end?: boolean
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

interface SidebarNavProps {
  groups: NavGroup[]
  onNavigate?: () => void
}

export function SidebarNav({ groups, onNavigate }: SidebarNavProps) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      {groups.map((group, index) => (
        <div key={group.label ?? index}>
          {group.label ? (
            <p className="text-ink-400 px-3 pb-1.5 text-[10px] font-semibold tracking-widest uppercase">
              {group.label}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-brand-600 text-white shadow-xs'
                        : 'text-ink-600 hover:bg-brand-50 hover:text-brand-900',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-white' : 'text-ink-400 group-hover:text-brand-700',
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
