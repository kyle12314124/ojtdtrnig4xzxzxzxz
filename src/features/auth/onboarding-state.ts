import type { ContextEmployee, OnboardingState, Profile } from '@/types'

/** Maps an employee record onto the lifecycle used by the route guards. */
export function deriveOnboardingState(
  profile: Profile,
  employee: ContextEmployee | null,
): OnboardingState {
  if (!employee) {
    // Administrators and supervisors are provisioned directly; employees
    // complete their own OJT details after signing up.
    return profile.role === 'employee' ? 'needs_onboarding' : 'active'
  }
  if (employee.status === 'archived') return 'inactive'
  if (employee.status === 'inactive' && !employee.approved_at) return 'pending'
  if (employee.status === 'active' && employee.approved_at) return 'active'
  return 'inactive'
}
