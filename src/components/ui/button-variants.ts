import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-solid-brand text-white shadow-xs hover:bg-solid-brand-hover active:bg-solid-brand-hover disabled:bg-brand-300',
  secondary:
    'bg-brand-100 text-brand-900 hover:bg-brand-200 active:bg-brand-200/80 disabled:bg-brand-50 disabled:text-brand-400',
  outline:
    'border border-ink-300 bg-surface-muted text-ink-800 shadow-xs hover:bg-ink-100 active:bg-ink-200 disabled:text-ink-400',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200/70',
  danger:
    'bg-solid-danger text-white shadow-xs hover:bg-solid-danger-hover active:bg-solid-danger-hover disabled:bg-danger-300',
  link: 'text-brand-700 underline-offset-4 hover:underline hover:text-brand-800',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 rounded-lg px-3 text-xs',
  md: 'h-10 gap-2 rounded-lg px-4 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-sm',
  icon: 'size-10 justify-center rounded-lg',
}

const baseClasses = cn(
  'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition duration-150 active:scale-[0.985]',
  'focus-visible:ring-brand-500/40 focus-visible:ring-2',
  'disabled:pointer-events-none disabled:opacity-70',
  '[&_svg]:size-4 [&_svg]:shrink-0',
)

/**
 * Shared button styling for elements that can't be a <button> — usually a
 * router <Link> that should look like one. Keeps links in the same visual
 * language as real buttons (press feedback, focus ring, sizing).
 */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(baseClasses, variantClasses[variant], sizeClasses[size], className)
}
