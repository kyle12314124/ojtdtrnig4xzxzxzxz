import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { ContextEmployee, MyContext, OnboardingState, Profile, UserRole } from '@/types'

export interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  /** Employee record linked to the signed-in profile, when one exists. */
  employee: ContextEmployee | null
  /** Raw `get_my_context()` payload, including the currently open time-in. */
  context: MyContext | null
  /** Where this account sits in the onboarding lifecycle. */
  onboarding: OnboardingState
  /** True until the initial session lookup has completed. */
  initializing: boolean
  /** True while the profile/context is being fetched after a session is known. */
  profileLoading: boolean
  profileError: string | null
  role: UserRole | null
  isAdmin: boolean
  isSupervisor: boolean
  canReview: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  /** Re-fetches the profile, employee record, and open session. */
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within <AuthProvider>.')
  return context
}
