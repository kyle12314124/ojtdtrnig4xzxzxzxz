import { cn, initials } from '@/lib/utils'

const sizeClasses = {
  sm: 'size-8 text-[11px]',
  md: 'size-10 text-xs',
  lg: 'size-14 text-base',
  xl: 'size-20 text-xl',
} as const

interface AvatarProps {
  firstName?: string
  lastName?: string
  src?: string | null
  size?: keyof typeof sizeClasses
  className?: string
}

export function Avatar({
  firstName = '',
  lastName = '',
  src,
  size = 'md',
  className,
}: AvatarProps) {
  const label = initials(firstName, lastName)
  return (
    <span
      className={cn(
        'bg-brand-100 text-brand-800 ring-brand-200/60 inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ring-1',
        sizeClasses[size],
        className,
      )}
      aria-hidden={!firstName && !lastName}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span>{label || '—'}</span>
      )}
    </span>
  )
}
