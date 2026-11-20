import type { ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'
import { buttonClassName, type ButtonSize, type ButtonVariant } from './button-variants'

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      className={buttonClassName({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}
