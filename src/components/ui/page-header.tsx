import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  eyebrow?: string
  className?: string
}

export function PageHeader({ title, description, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <header
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-brand-700 mb-1 text-xs font-semibold tracking-wider uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-ink-900 text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? (
          <p className="text-ink-500 mt-1 max-w-2xl text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
