import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-ink-200 flex flex-col items-center justify-center rounded-xl border border-dashed bg-white px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="bg-brand-50 text-brand-600 mb-4 flex size-11 items-center justify-center rounded-full">
          <Icon className="size-5" aria-hidden />
        </div>
      ) : null}
      <h3 className="text-ink-900 text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="text-ink-500 mt-1 max-w-sm text-sm leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
}: {
  title?: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="border-danger-200 bg-danger-50/50 flex flex-col items-center rounded-xl border px-6 py-10 text-center">
      <h3 className="text-danger-700 text-sm font-semibold">{title}</h3>
      <p className="text-danger-700/80 mt-1 max-w-md text-sm">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
