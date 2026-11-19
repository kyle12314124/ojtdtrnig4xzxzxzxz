import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card } from './card'

type StatTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const iconTones: Record<StatTone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-700',
  neutral: 'bg-ink-100 text-ink-600',
}

interface StatCardProps {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone?: StatTone
  hint?: ReactNode
  loading?: boolean
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  hint,
  loading,
}: StatCardProps) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="text-ink-500 truncate text-[11px] font-medium tracking-wide uppercase sm:text-xs">
            {label}
          </p>
          {loading ? (
            <div className="bg-ink-100 mt-2 h-7 w-14 animate-pulse rounded-md" aria-hidden />
          ) : (
            <p className="text-ink-900 numeric mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl">
              {value}
            </p>
          )}
          {hint ? (
            <div className="text-ink-500 mt-1 hidden truncate text-[11px] sm:block sm:text-xs">
              {hint}
            </div>
          ) : null}
        </div>
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-10',
            iconTones[tone],
          )}
        >
          <Icon className="size-4 sm:size-5" aria-hidden />
        </span>
      </div>
    </Card>
  )
}
