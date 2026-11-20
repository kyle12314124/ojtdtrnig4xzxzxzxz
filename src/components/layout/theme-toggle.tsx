import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

type ThemeMode = 'light' | 'dim'

const STORAGE_KEY = 'dtr.theme'

function readMode(): ThemeMode {
  return document.documentElement.dataset.theme === 'dim' ? 'dim' : 'light'
}

/**
 * Switches between the light canvas theme (dark cards) and the all-dark soft
 * dim theme. The initial value is applied by an inline script in index.html so
 * there is no flash of the wrong palette.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>(readMode)

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', mode === 'dim' ? '#141814' : '#e8ebe2')
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // Storage can be blocked; the theme still applies for this session.
    }
  }, [mode])

  const next = mode === 'dim' ? 'light' : 'dim'

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        'text-ink-500 hover:bg-ink-100 hover:text-ink-800 inline-flex size-9 items-center justify-center rounded-lg transition-colors',
        className,
      )}
    >
      {mode === 'dim' ? (
        <Sun className="size-4" aria-hidden />
      ) : (
        <Moon className="size-4" aria-hidden />
      )}
    </button>
  )
}
