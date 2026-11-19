/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_APP_NAME?: string
  readonly VITE_ORG_NAME?: string
  readonly VITE_ORG_ADDRESS?: string
  readonly VITE_ORG_LOGO_URL?: string
  readonly VITE_TIMEZONE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
