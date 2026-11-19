import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('border-ink-200/80 shadow-card rounded-xl border bg-white', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-ink-900 text-base font-semibold', className)} {...props} />
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-ink-500 mt-0.5 text-sm', className)} {...props} />
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('border-ink-100 flex items-center gap-2 border-t px-5 py-3', className)}
      {...props}
    />
  )
}

interface SectionCardProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  )
}
