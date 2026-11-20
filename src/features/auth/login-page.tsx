import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import { useAuth } from './auth-context'
import { configIssues, isSupabaseConfigured, env } from '@/lib/env'
import { errorMessage } from '@/lib/utils'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
})

type LoginValues = z.infer<typeof loginSchema>

function isRateLimited(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('too many requests') ||
    normalized.includes('rate limit') ||
    normalized.includes('over_request_rate_limit')
  )
}

function friendlyAuthError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login credentials')) {
    return 'Incorrect email or password. Please try again.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Your email address has not been confirmed yet. Contact your administrator.'
  }
  if (isRateLimited(message)) {
    return 'Too many sign-ins from this network right now — this happens on shared school Wi-Fi. Wait a while, or try mobile data. Retrying keeps the limit active.'
  }
  if (normalized.includes('network')) {
    return 'Cannot reach the authentication server. Check your connection and try again.'
  }
  return message
}

export function LoginPage() {
  const { session, profile, initializing, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  // After a rate-limit response, stop the user from burning more attempts.
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const from =
    (location.state as { from?: string } | null)?.from &&
    (location.state as { from?: string }).from !== '/login'
      ? (location.state as { from: string }).from
      : '/'

  if (!initializing && session && profile) {
    return <Navigate to={from} replace />
  }

  async function onSubmit(values: LoginValues) {
    setSubmitError(null)
    try {
      await signIn(values.email, values.password)
      navigate(from, { replace: true })
    } catch (error) {
      const message = errorMessage(error)
      setSubmitError(friendlyAuthError(message))
      if (isRateLimited(message)) setCooldown(60)
    }
  }

  function handleForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void handleSubmit(onSubmit)(event)
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="bg-hero relative hidden overflow-hidden px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 22%, rgba(255,255,255,0.55) 0, transparent 38%), radial-gradient(circle at 82% 78%, rgba(255,255,255,0.35) 0, transparent 42%)',
          }}
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/20">
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
              <p className="text-sm font-semibold tracking-wide">{env.appName}</p>
              <p className="text-xs text-white/70">{env.orgName}</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-white">
            Accurate timekeeping,
            <br />
            without the paperwork.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/75">
            A single record of truth for attendance, work hours, and corrections — built for HR
            teams and the people they support.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {[
              'Server-verified time in and time out',
              'Split shifts, grace periods, and overtime',
              'Printable DTR reports and audit trails',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <span className="flex size-5 items-center justify-center rounded-full bg-white/12 ring-1 ring-white/20">
                  <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden>
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-xs text-white/55">
          {env.orgName} · {env.timezone.replace('_', ' ')}
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-10">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="bg-brand-600 flex size-10 items-center justify-center rounded-xl text-white">
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
              <p className="text-ink-900 text-sm font-semibold">{env.appName}</p>
              <p className="text-ink-500 text-xs">{env.orgName}</p>
            </div>
          </div>

          <div className="mb-8">
            <p className="text-brand-700 text-xs font-semibold tracking-wider uppercase">
              Welcome back
            </p>
            <h2 className="text-ink-900 mt-1.5 text-2xl font-semibold tracking-tight">
              Sign in to your workspace
            </h2>
            <p className="text-ink-500 mt-2 text-sm">
              Use the account issued by your HR administrator.
            </p>
          </div>

          {!isSupabaseConfigured ? (
            <Alert tone="danger" title="Setup required" className="mb-6">
              <ul className="list-disc space-y-1 pl-4">
                {configIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <p className="mt-2">
                Create a <code className="font-mono">.env</code> file from{' '}
                <code className="font-mono">.env.example</code>, then restart the dev server.
              </p>
              <Link
                to="/setup"
                className="text-danger-700 mt-2 inline-block font-medium underline underline-offset-4"
              >
                View setup instructions
              </Link>
            </Alert>
          ) : null}

          {submitError ? (
            <Alert tone="danger" title="Sign-in failed" className="mb-5">
              {submitError}
            </Alert>
          ) : null}

          <form onSubmit={handleForm} className="space-y-5" noValidate>
            <Field label="Email address" htmlFor="email" error={errors.email?.message} required>
              <div className="relative">
                <Mail
                  className="text-ink-400 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  className="pl-9"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="password" error={errors.password?.message} required>
              <div className="relative">
                <LockKeyhole
                  className="text-ink-400 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="pr-10 pl-9"
                  aria-invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="text-ink-400 hover:text-ink-700 absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={isSubmitting}
              disabled={!isSupabaseConfigured || cooldown > 0}
            >
              {cooldown > 0 ? `Please wait ${cooldown}s` : isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="text-ink-500 mt-6 text-center text-xs leading-relaxed">
            Sign in with the account you registered. If you cannot sign in, ask your administrator
            to check your account status.
          </p>

          <p className="text-ink-600 mt-4 text-center text-sm">
            New OJT student?{' '}
            <Link to="/register" className="text-brand-700 font-medium hover:underline">
              Create an account
            </Link>
          </p>

          <div className="border-ink-200 text-ink-400 mt-8 flex items-center justify-between border-t pt-4 text-[11px]">
            <span>{env.timezone.replace('_', ' ')}</span>
            <span>Protected by Supabase Auth</span>
          </div>
        </div>
      </main>
    </div>
  )
}
