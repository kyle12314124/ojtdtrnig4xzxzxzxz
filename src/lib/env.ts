/**
 * Public client environment.
 *
 * Only VITE_-prefixed values reach the browser bundle. The anon key is designed
 * to be public — Row Level Security is what protects data. The service-role key
 * must never appear in this app; privileged operations live in Edge Functions.
 */

const rawUrlInput = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const rawAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

/**
 * Accept the common copy/paste variants of the project URL:
 * trailing slashes, `/rest/v1`, `/auth/v1`, etc. Only the origin is used.
 */
function normalizeSupabaseUrl(value: string): string {
  return value
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth|storage|realtime|functions)\/v1$/i, '')
    .replace(/\/+$/, '')
}
const rawUrl = normalizeSupabaseUrl(rawUrlInput)

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export const env = {
  supabaseUrl: rawUrl,
  supabaseAnonKey: rawAnonKey,
  appName: (import.meta.env.VITE_APP_NAME ?? 'Daily Time Record System').trim(),
  orgName: (import.meta.env.VITE_ORG_NAME ?? 'Your Organization').trim(),
  orgAddress: (import.meta.env.VITE_ORG_ADDRESS ?? '').trim(),
  orgLogoUrl: (import.meta.env.VITE_ORG_LOGO_URL ?? '').trim(),
  timezone: (import.meta.env.VITE_TIMEZONE ?? 'Asia/Manila').trim(),
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const

export const configIssues: string[] = []
if (!rawUrl) {
  configIssues.push('VITE_SUPABASE_URL is missing.')
} else if (!isValidHttpUrl(rawUrl)) {
  configIssues.push('VITE_SUPABASE_URL is not a valid http(s) URL.')
} else if (rawUrl.includes('/rest/v1') || rawUrl.includes('/auth/v1')) {
  configIssues.push('VITE_SUPABASE_URL must be the project root URL, not an API path.')
}
if (!rawAnonKey) {
  configIssues.push('VITE_SUPABASE_ANON_KEY is missing.')
}
if (rawAnonKey.toLowerCase().includes('service_role')) {
  configIssues.push(
    'A service-role key was supplied to the browser build. Remove it immediately and rotate the key.',
  )
}

export const isSupabaseConfigured = configIssues.length === 0
