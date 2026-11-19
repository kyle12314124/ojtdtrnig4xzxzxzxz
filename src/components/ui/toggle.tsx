import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  id?: string
}

/** Accessible on/off switch rendered as a labelled row. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
}: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cn('text-ink-900 block text-sm font-medium', disabled && 'opacity-60')}
        >
          {label}
        </label>
        {description ? (
          <p className="text-ink-500 mt-0.5 text-xs leading-relaxed">{description}</p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'focus-visible:ring-brand-500/40 relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none',
          checked ? 'bg-brand-600' : 'bg-ink-300',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 transform rounded-full bg-white shadow-xs transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
          aria-hidden
        />
      </button>
    </div>
  )
}
