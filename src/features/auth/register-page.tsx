import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { useAuth } from './auth-context'
import { AuthFrame } from '@/components/layout/auth-frame'
import { getSupabase } from '@/lib/supabase'
import { PASSWORD_MIN_LENGTH } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name.').max(120, 'That name is too long.'),
    email: z.string().trim().min(1, 'Email is required.').email('Enter a valid email address.'),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`),
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })

type RegisterValues = z.infer<typeof registerSchema>

function friendlySignUpError(message: string): string {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('signups are disabled') ||
    normalized.includes('signup is disabled') ||
    normalized.includes('email_provider_disabled') ||
    normalized.includes('email signups are disabled')
  ) {
    return 'Registration is currently closed. Ask your administrator to create your account. Once they do, sign in with the email and temporary password they give you.'
  }
  if (normalized.includes('already registered') || normalized.includes('already been registered')) {
    return 'An account already exists for this email. Sign in instead, or ask your administrator to reset the password.'
  }
  if (normalized.includes('password')) {
    return message
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Too many sign-ups from this network right now. Wait a few minutes, or switch to mobile data. If email confirmation is on, check whether the confirmation email already arrived.'
  }
  return message
}

export function RegisterPage() {
  const { session, onboarding, initializing } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  })

  if (!initializing && session && onboarding === 'active') {
    return <Navigate to="/" replace />
  }
  if (!initializing && session && onboarding === 'needs_onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  async function onSubmit(values: RegisterValues) {
    setSubmitError(null)
    try {
      const { data, error } = await getSupabase().auth.signUp({
        email: values.email.trim().toLowerCase(),
        password: values.password,
        options: { data: { full_name: values.fullName.trim() } },
      })
      if (error) throw error

      if (data.session) {
        navigate('/onboarding', { replace: true })
        return
      }
      setConfirmationSent(true)
    } catch (error) {
      setSubmitError(friendlySignUpError(errorMessage(error)))
    }
  }

  function handleForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void handleSubmit(onSubmit)(event)
  }

  if (confirmationSent) {
    return (
      <AuthFrame
        eyebrow="Check your inbox"
        title="Confirm your email address"
        description="Your account was created. Open the confirmation link we emailed you, then sign in to finish your OJT profile."
      >
        <Alert tone="info" title="Why is this needed?">
          Confirming your email proves the address belongs to you. If your administrator turned
          confirmations off, you can sign in immediately instead.
        </Alert>
        <Button variant="outline" className="mt-5 w-full" onClick={() => navigate('/login')}>
          Back to sign in
        </Button>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      eyebrow="OJT registration"
      title="Create your account"
      description="Register with your personal email. Your administrator will review and approve your OJT profile before timekeeping unlocks."
      footer={
        <span className="text-ink-500">
          Already registered?{' '}
          <Link to="/login" className="text-brand-700 font-medium hover:underline">
            Sign in
          </Link>
        </span>
      }
    >
      {submitError ? (
        <Alert tone="danger" title="Registration failed" className="mb-5">
          {submitError}
        </Alert>
      ) : null}

      <form onSubmit={handleForm} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="full-name" error={errors.fullName?.message} required>
          <div className="relative">
            <UserRound
              className="text-ink-400 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="full-name"
              autoComplete="name"
              placeholder="Juan Dela Cruz"
              className="pl-9"
              aria-invalid={Boolean(errors.fullName)}
              {...register('fullName')}
            />
          </div>
        </Field>

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
              placeholder="you@school.edu.ph"
              className="pl-9"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
          </div>
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          required
        >
          <div className="relative">
            <LockKeyhole
              className="text-ink-400 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Create a strong password"
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

        <Field
          label="Confirm password"
          htmlFor="confirm-password"
          error={errors.confirmPassword?.message}
          required
        >
          <Input
            id="confirm-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Re-type your password"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="text-ink-400 mt-4 text-center text-[11px] leading-relaxed">
        By registering you agree to have your attendance recorded and reviewed by your OJT
        supervisor.
      </p>
    </AuthFrame>
  )
}
