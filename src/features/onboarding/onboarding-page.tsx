import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '@/features/auth/auth-context'
import { AuthFrame } from '@/components/layout/auth-frame'
import { getSupabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/utils'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

const onboardingSchema = z.object({
  employeeNo: z
    .string()
    .trim()
    .min(3, 'Use at least 3 characters.')
    .max(20, 'Use at most 20 characters.')
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits, and dashes only.'),
  firstName: z.string().trim().min(1, 'First name is required.').max(60, 'That name is too long.'),
  middleName: z.string().trim().max(60, 'That name is too long.').optional(),
  lastName: z.string().trim().min(1, 'Last name is required.').max(60, 'That name is too long.'),
  position: z.string().trim().max(80, 'That position is too long.').optional(),
})

type OnboardingValues = z.infer<typeof onboardingSchema>

function friendlyOnboardingError(message: string): string {
  if (
    message.includes('Could not find the function') ||
    message.includes('complete_onboarding') ||
    message.includes('does not exist')
  ) {
    return 'The database is missing the Phase 3 onboarding migration. Ask your administrator to apply 20261119000500_onboarding.sql, then try again.'
  }
  if (message.includes('EMPLOYEE_NO_TAKEN')) {
    return 'That student or employee number is already registered. Check the number, or contact your administrator if you believe it is yours.'
  }
  if (message.includes('EMPLOYEE_NO_INVALID')) {
    return 'Use 3–20 letters, digits, or dashes for your student number.'
  }
  if (message.includes('ALREADY_ONBOARDED')) {
    return 'This account already submitted its OJT details. Refresh the page to see its status.'
  }
  if (message.includes('FORBIDDEN')) {
    return 'This account cannot complete OJT onboarding. Contact your administrator.'
  }
  return message
}

export function OnboardingPage() {
  const { profile, employee, onboarding, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const nameParts = (profile?.full_name ?? '').trim().split(/\s+/)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      employeeNo: '',
      firstName: nameParts.length > 1 ? (nameParts[0] ?? '') : '',
      middleName: '',
      lastName: nameParts.length > 1 ? (nameParts.at(-1) ?? '') : (nameParts[0] ?? ''),
      position: 'OJT Intern',
    },
  })

  if (employee || onboarding === 'active') {
    return <Navigate to="/" replace />
  }
  if (onboarding === 'pending') {
    return <Navigate to="/pending-approval" replace />
  }
  if (onboarding === 'inactive') {
    return <Navigate to="/pending-approval" replace />
  }

  async function onSubmit(values: OnboardingValues) {
    setSubmitError(null)
    try {
      const { data, error } = await getSupabase().rpc('complete_onboarding', {
        p_employee_no: values.employeeNo,
        p_first_name: values.firstName,
        p_middle_name: values.middleName?.trim() ? values.middleName.trim() : null,
        p_last_name: values.lastName,
        p_position: values.position?.trim() ? values.position.trim() : null,
      })
      if (error) throw error
      const payload = data as { status?: string } | null
      await refreshProfile()
      navigate(payload?.status === 'active' ? '/' : '/pending-approval', { replace: true })
    } catch (error) {
      setSubmitError(friendlyOnboardingError(errorMessage(error)))
    }
  }

  function handleForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void handleSubmit(onSubmit)(event)
  }

  return (
    <AuthFrame
      eyebrow="Step 1 of 2"
      title="Complete your OJT profile"
      description="Tell us who you are. Your administrator will match this against the class list before approving your account."
      width="lg"
      footer={
        <span className="text-ink-500 text-xs">
          Signed in as <span className="text-ink-700 font-medium">{profile?.email}</span>
        </span>
      }
    >
      {submitError ? (
        <Alert tone="danger" title="Could not submit your profile" className="mb-5">
          {submitError}
        </Alert>
      ) : null}

      <form onSubmit={handleForm} className="space-y-4" noValidate>
        <Field
          label="Student / employee number"
          htmlFor="employee-no"
          error={errors.employeeNo?.message}
          hint="Exactly as it appears on your class list, for example OJT-2026-001."
          required
        >
          <Input
            id="employee-no"
            autoComplete="off"
            placeholder="OJT-2026-001"
            className="numeric uppercase"
            aria-invalid={Boolean(errors.employeeNo)}
            {...register('employeeNo')}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="first-name" error={errors.firstName?.message} required>
            <Input
              id="first-name"
              autoComplete="given-name"
              aria-invalid={Boolean(errors.firstName)}
              {...register('firstName')}
            />
          </Field>

          <Field label="Middle name" htmlFor="middle-name" error={errors.middleName?.message}>
            <Input id="middle-name" autoComplete="additional-name" {...register('middleName')} />
          </Field>
        </div>

        <Field label="Last name" htmlFor="last-name" error={errors.lastName?.message} required>
          <Input
            id="last-name"
            autoComplete="family-name"
            aria-invalid={Boolean(errors.lastName)}
            {...register('lastName')}
          />
        </Field>

        <Field
          label="Position / role"
          htmlFor="position"
          error={errors.position?.message}
          hint="For example OJT Intern, or your assigned team."
        >
          <Input id="position" autoComplete="organization-title" {...register('position')} />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Submit for approval'}
        </Button>
      </form>

      <p className="text-ink-400 mt-4 text-center text-[11px] leading-relaxed">
        Your administrator reviews submissions in the order they arrive. You cannot change these
        details after submitting — ask your administrator for corrections.
      </p>
    </AuthFrame>
  )
}
