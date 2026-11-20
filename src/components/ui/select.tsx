import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'border-ink-300 bg-surface-muted h-10 w-full appearance-none rounded-lg border pr-9 pl-3 text-base shadow-xs transition sm:text-sm',
          'focus:border-brand-500 focus:ring-brand-500/20 focus:ring-2 focus:outline-none',
          'disabled:bg-ink-50 disabled:text-ink-500 disabled:cursor-not-allowed',
          'aria-invalid:border-danger-500',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="text-ink-400 pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
        aria-hidden
      />
    </div>
  )
}
