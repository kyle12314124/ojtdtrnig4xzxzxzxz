import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const styles: Record<AlertTone, { wrap: string; icon: ReactNode }> = {
  info: {
    wrap: 'border-info-100 bg-info-50/70 text-info-700',
    icon: <Info className="size-4 shrink-0" aria-hidden />,
  },
  success: {
    wrap: 'border-success-100 bg-success-50/70 text-success-700',
    icon: <CheckCircle2 className="size-4 shrink-0" aria-hidden />,
  },
  warning: {
    wrap: 'border-warning-100 bg-warning-50/70 text-warning-700',
    icon: <AlertTriangle className="size-4 shrink-0" aria-hidden />,
  },
  danger: {
    wrap: 'border-danger-100 bg-danger-50/70 text-danger-700',
    icon: <XCircle className="size-4 shrink-0" aria-hidden />,
  },
}

interface AlertProps {
  tone?: AlertTone
  title?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}

export function Alert({ tone = 'info', title, children, className, action }: AlertProps) {
  return (
    <div
      className={cn('rounded-lg border px-4 py-3 text-sm', styles[tone].wrap, className)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <div className="flex gap-3">
        <span className="mt-0.5">{styles[tone].icon}</span>
        <div className="min-w-0 flex-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          <div className={cn('leading-relaxed', title && 'mt-0.5')}>{children}</div>
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>
  )
}
