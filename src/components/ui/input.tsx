import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'border-ink-300 placeholder:text-ink-400 bg-surface-muted h-10 w-full rounded-lg border px-3 text-base shadow-xs transition sm:text-sm',
        'focus:border-brand-500 focus:ring-brand-500/20 focus:ring-2 focus:outline-none',
        'disabled:bg-ink-50 disabled:text-ink-500 disabled:cursor-not-allowed',
        'aria-invalid:border-danger-500 aria-invalid:focus:border-danger-600 aria-invalid:focus:ring-danger-500/20',
        'file:text-ink-700 file:mr-2 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  )
}
