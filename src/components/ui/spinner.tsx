import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('text-brand-600 size-5 animate-spin', className)} aria-hidden />
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="text-ink-500 flex min-h-40 flex-col items-center justify-center gap-3 text-sm"
      role="status"
      aria-live="polite"
    >
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-ink-100 animate-pulse rounded-md', className)} aria-hidden />
}

/** Placeholder rows used while a table's first page is fetched. */
export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-1" aria-hidden>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-3 py-2.5">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <Skeleton
              key={colIndex}
              className={cn('h-4', colIndex === 0 ? 'w-32' : 'w-full max-w-24')}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
