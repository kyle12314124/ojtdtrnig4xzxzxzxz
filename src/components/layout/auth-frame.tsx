import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { env } from '@/lib/env'

interface AuthFrameProps {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg'
}

/**
 * Shared frame for signed-in-but-not-yet-approved screens
 * (registration, onboarding, approval status).
 */
export function AuthFrame({
  eyebrow,
  title,
  description,
  children,
  footer,
  width = 'md',
}: AuthFrameProps) {
  return (
    <div className="bg-canvas relative min-h-dvh">
      <div className="bg-brand-800 pointer-events-none absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-8 sm:px-6">
        <header className="flex items-center gap-3 pb-8">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/12 text-white ring-1 ring-white/20">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="M12 8v4l2.8 2"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-white">{env.appName}</p>
            <p className="text-xs text-white/70">{env.orgName}</p>
          </div>
        </header>

        <main className="flex flex-1 items-start justify-center">
          <div className={width === 'lg' ? 'w-full max-w-xl' : 'w-full max-w-md'}>
            <div className="shadow-card rounded-2xl border border-white/60 bg-white p-6 sm:p-8">
              <p className="text-brand-700 text-xs font-semibold tracking-wider uppercase">
                {eyebrow}
              </p>
              <h1 className="text-ink-900 mt-1.5 text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="text-ink-500 mt-2 text-sm leading-relaxed">{description}</p>
              <div className="mt-6">{children}</div>
            </div>
            {footer ? <div className="mt-5 text-center text-sm">{footer}</div> : null}
          </div>
        </main>

        <footer className="text-ink-400 flex items-center justify-between pt-8 text-[11px]">
          <span>{env.timezone.replace('_', ' ')}</span>
          <Link to="/setup" className="hover:text-ink-600 underline-offset-4 hover:underline">
            Connection help
          </Link>
        </footer>
      </div>
    </div>
  )
}
