import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { isSupabaseConfigured } from '@/lib/env'
import { errorMessage } from '@/lib/utils'
import { AuthContext, type AuthContextValue } from './auth-context'
import { deriveOnboardingState } from './onboarding-state'
import type { MyContext, OnboardingState } from '@/types'

function friendlyContextError(error: {
  message?: string
  code?: string
  details?: string
}): string {
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  if (text.includes('profile_not_found')) {
    return 'No profile is linked to this account yet. Ask an administrator to provision it, then retry.'
  }
  if (text.includes('not_authenticated') || error.code === '28000') {
    return 'Your session has expired. Sign in again to continue.'
  }
  if (text.includes('could not find the function') || text.includes('does not exist')) {
    return 'The database is missing the Phase 3 migration. Apply 20261119000500_onboarding.sql.'
  }
  return error.message || 'Could not load your account context.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [context, setContext] = useState<MyContext | null>(null)
  const [initializing, setInitializing] = useState(isSupabaseConfigured)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const loadContext = useCallback(async () => {
    const requestId = ++requestRef.current
    setProfileLoading(true)
    setProfileError(null)
    try {
      const { data, error } = await getSupabase().rpc('get_my_context')

      if (requestId !== requestRef.current) return
      if (error) {
        setProfileError(friendlyContextError(error))
        setContext(null)
        return
      }
      if (!data) {
        setProfileError('The database returned an empty account context.')
        setContext(null)
        return
      }
      setContext(data as MyContext)
    } catch (error) {
      if (requestId !== requestRef.current) return
      setContext(null)
      setProfileError(errorMessage(error))
    } finally {
      if (requestId === requestRef.current) setProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setInitializing(false)
      return
    }

    const client = getSupabase()
    let active = true

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) setProfileError(error.message)
        setSession(data.session)
        setInitializing(false)
        if (data.session) void loadContext()
      })
      .catch((error: unknown) => {
        if (!active) return
        setProfileError(errorMessage(error))
        setInitializing(false)
      })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (event === 'SIGNED_OUT' || !nextSession) {
        setContext(null)
        setProfileError(null)
        setProfileLoading(false)
        requestRef.current += 1
        return
      }
      void loadContext()
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [loadContext])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await getSupabase().auth.signOut()
    if (error) throw error
    setContext(null)
    setSession(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session) await loadContext()
  }, [loadContext, session])

  const profile = context?.profile ?? null
  const employee = context?.employee ?? null
  const role = profile?.role ?? null

  const onboarding = useMemo<OnboardingState>(
    () => (profile ? deriveOnboardingState(profile, employee) : 'needs_onboarding'),
    [profile, employee],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      employee,
      context,
      onboarding,
      initializing,
      profileLoading,
      profileError,
      role,
      isAdmin: role === 'admin',
      isSupervisor: role === 'supervisor',
      canReview: role === 'admin' || role === 'supervisor',
      signIn,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      employee,
      context,
      onboarding,
      initializing,
      profileLoading,
      profileError,
      role,
      signIn,
      signOut,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
