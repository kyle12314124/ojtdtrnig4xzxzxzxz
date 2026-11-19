import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isSupabaseConfigured } from './env'

/**
 * Singleton Supabase client. The anon key is public; every table is protected
 * by RLS and every sensitive mutation runs through a validating RPC.
 */
let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storageKey: 'dtr.auth.session',
      },
      global: {
        headers: { 'x-application-name': 'dtr-system' },
      },
      db: { schema: 'public' },
    })
  }
  return client
}
