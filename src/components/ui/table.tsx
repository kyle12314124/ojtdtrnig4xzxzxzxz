import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function TableWrapper({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('border-ink-200 w-full overflow-x-auto rounded-xl border bg-white', className)}
      {...props}
    />
  )
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />
}

export function TableHead({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('bg-ink-50/80', className)} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('divide-ink-100 divide-y', className)} {...props} />
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('hover:bg-brand-50/40 transition-colors', className)} {...props} />
}

export function TableHeaderCell({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'text-ink-500 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider whitespace-nowrap uppercase',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn('text-ink-700 px-4 py-3 align-middle whitespace-nowrap', className)}
      {...props}
    />
  )
}
