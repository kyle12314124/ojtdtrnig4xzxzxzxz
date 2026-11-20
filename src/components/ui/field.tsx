import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Label({ className, children, ...props }: ComponentProps<'label'>) {
  return (
    <label className={cn('text-ink-700 block text-sm font-medium', className)} {...props}>
      {children}
    </label>
  )
}

interface FieldProps {
  label: string
  htmlFor: string
  error?: string | undefined
  hint?: string | undefined
  required?: boolean
  className?: string
  children: ReactNode
}

/** Label + control + hint/error with consistent vertical rhythm. */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="text-danger-600 ml-0.5" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p className="text-danger-600 text-xs" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-ink-500 text-xs">{hint}</p>
      ) : null}
    </div>
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'border-ink-300 placeholder:text-ink-400 bg-surface-muted min-h-24 w-full rounded-lg border px-3 py-2 text-base shadow-xs transition sm:text-sm',
        'focus:border-brand-500 focus:ring-brand-500/20 focus:ring-2 focus:outline-none',
        'disabled:bg-ink-50 disabled:text-ink-500 disabled:cursor-not-allowed',
        'aria-invalid:border-danger-500',
        className,
      )}
      {...props}
    />
  )
}
