import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, CircleAlert, ExternalLink } from 'lucide-react'
import { configIssues, env } from '@/lib/env'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'

const steps = [
  {
    title: 'Create a Supabase project',
    body: 'Create a project at supabase.com. Copy the Project URL and the anon public key from Project Settings → API.',
  },
  {
    title: 'Add environment variables',
    body: 'Copy .env.example to .env in the project root, then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Restart the dev server afterwards.',
  },
  {
    title: 'Apply database migrations',
    body: 'Run the SQL files in supabase/migrations in order using the Supabase SQL editor or the Supabase CLI. Migrations create the schema, RPC functions, and RLS policies.',
  },
  {
    title: 'Create the first administrator',
    body: 'Create an auth user, then follow the bootstrap instructions in supabase/README.md to link an admin profile. Never put the service-role key in the frontend.',
  },
  {
    title: 'Sign in and verify',
    body: 'Sign in with the administrator account. The workspace runs a live connection check against your database.',
  },
]

export function SetupPage() {
  return (
    <div className="bg-canvas min-h-dvh px-5 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Link
          to="/login"
          className="text-ink-500 hover:text-ink-800 mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to sign in
        </Link>

        <div className="mb-8">
          <p className="text-brand-700 text-xs font-semibold tracking-wider uppercase">
            Installation
          </p>
          <h1 className="text-ink-900 mt-1 text-2xl font-semibold tracking-tight">
            Connect your Supabase project
          </h1>
          <p className="text-ink-500 mt-2 text-sm leading-relaxed">
            {env.appName} uses Supabase for authentication and PostgreSQL storage. The browser only
            ever receives public configuration; authorization is enforced by Row Level Security.
          </p>
        </div>

        {configIssues.length > 0 ? (
          <Alert tone="danger" title="Configuration incomplete" className="mb-6">
            <ul className="list-disc space-y-1 pl-4">
              {configIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <Alert tone="success" title="Configuration detected" className="mb-6">
            Public credentials are present. If you still cannot sign in, verify that database
            migrations have been applied.
          </Alert>
        )}

        <Card className="divide-ink-100 divide-y">
          {steps.map((step, index) => (
            <div key={step.title} className="flex gap-4 p-5">
              <span className="bg-brand-50 text-brand-700 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                {index + 1}
              </span>
              <div className="min-w-0">
                <h2 className="text-ink-900 text-sm font-semibold">{step.title}</h2>
                <p className="text-ink-500 mt-1 text-sm leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </Card>

        <div className="mt-6 grid items-start gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-ink-900 flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="text-success-600 size-4" aria-hidden />
              Expected .env keys
            </h2>
            <pre className="bg-ink-950 text-ink-100 mt-3 overflow-x-auto rounded-lg p-3 text-[11px] leading-relaxed">
              {`VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>`}
            </pre>
          </Card>
          <Card className="p-5">
            <h2 className="text-ink-900 flex items-center gap-2 text-sm font-semibold">
              <CircleAlert className="text-warning-600 size-4" aria-hidden />
              Never expose
            </h2>
            <p className="text-ink-500 mt-2 text-sm leading-relaxed">
              The <code className="font-mono text-xs">service_role</code> key bypasses RLS. It must
              only exist inside server-side Edge Functions or CI secrets — never in a{' '}
              <code className="font-mono text-xs">VITE_</code> variable.
            </p>
            <a
              href="https://supabase.com/docs/guides/database/row-level-security"
              target="_blank"
              rel="noreferrer"
              className="text-brand-700 mt-3 inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              RLS documentation
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </Card>
        </div>
      </div>
    </div>
  )
}
