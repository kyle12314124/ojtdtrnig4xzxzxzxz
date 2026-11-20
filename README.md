# Daily Time Record (DTR) Management System

A secure, web-based timekeeping platform for recording attendance, computing working hours, and
issuing printable Daily Time Record reports. Built with React, TypeScript, and Supabase
(PostgreSQL + Auth), designed for real HR operations rather than demonstration data.

> **Build status — Phase 10 of 10 complete.** Foundation, authentication, onboarding and approvals,
> work schedules, server-timestamped time in/out, the live administrator dashboard, employee
> management, DTR history and exports, and the attendance-correction workflow are implemented and
> verified. See the [roadmap](#roadmap).

---

## Stack

| Layer      | Technology                                                              |
| ---------- | ----------------------------------------------------------------------- |
| Frontend   | React 19, TypeScript (strict), Vite 7                                    |
| Styling    | Tailwind CSS v4, Inter Variable, custom sage/neutral design tokens      |
| Icons      | Lucide React                                                            |
| Routing    | React Router 7                                                          |
| Data       | TanStack Query 5, Supabase JS 2                                          |
| Forms      | React Hook Form + Zod                                                   |
| Charts     | Recharts (loaded with the admin dashboard)                              |
| Dates      | date-fns + date-fns-tz (`Asia/Manila` display, UTC storage)             |
| Reports    | jsPDF + jspdf-autotable, CSV, ExcelJS                                   |
| Backend    | Supabase Auth, PostgreSQL, Row Level Security, SQL RPCs, Edge Functions |
| Deployment | Netlify (frontend) + Supabase (backend)                                  |

## What works today

- Responsive, accessible application shell with role-aware navigation. Phones get a bottom tab bar
  for the four most-used pages plus a "More" drawer, and wide data tables become stacked cards
  below 640px instead of horizontal scrolling.
- Light canvas with dark content cards by default, plus a fully dark soft-dim theme. One-click sun/moon
  toggle in the header and on auth screens; the choice is remembered per device and applied before first
  paint.
- Branded sign-in flow wired to Supabase Auth, with validation, password visibility, friendly
  error mapping, and a live "configuration required" state.
- Session restoration, profile loading, role guards, inactive-account blocking, and sign-out.
- Design system: buttons, inputs, selects, fields, cards, badges, tables, modals, confirmation
  dialogs, pagination, statistic cards, empty/error/loading states, toasts.
- Setup diagnostics page plus an authenticated database health check (`health_check` RPC).
- **PostgreSQL schema**: profiles, employees, departments, schedules & paid periods, schedule
  assignments, attendance records/sessions, corrections, holidays, audit logs.
- **Integrity by construction**: one record per employee/day, one open session per employee,
  overlap prevention for sessions and schedules, immutable audit rows, case-insensitive unique
  identities, and scoped RLS for employee/supervisor/admin.
- **Self-registration and onboarding**: a student creates an account, submits their OJT details
  (student number, name, position), and lands on a live status screen that updates after approval.
- **Administrator approval queue**: searchable list of pending students with approve/reject actions,
  a required rejection reason, and an audit entry for every decision.
- **Automatic approval switch**: administrators can activate new students immediately instead of
  reviewing each one; the setting is database-backed, audited, and can clear the existing queue.
- **Role-aware route guards**: unapproved accounts cannot reach the workspace, and admin-only pages
  verify the role again on the client and in the database.
- **Time clock**: server-timestamped time in/out, live open-session state, per-session history, and
  daily totals for worked, late, undertime, and overtime. Breaks between paid periods are excluded.
- **Work schedules**: create paid periods and working days, grace periods, assign schedules in
  bulk to classmates who do not have one, and let students join or leave a published schedule
  themselves from **My schedule**. Joining starts today and is audited. Unused test schedules can
  be deleted; a schedule with attendance can be force-deleted, which keeps every DTR row and only
  detaches the schedule link.
- **Administrator dashboard**: live counts for active students, present, late, absent, clocked-in,
  hours today, pending approvals, and pending corrections; a 14-day presence/late chart; department
  distribution; and the latest punches. All values come from the database.
- **Employee management**: searchable, filtered, paginated directory; edit personal and employment
  details; assign schedules; create departments; activate/deactivate accounts with a reason. Open
  time-ins block deactivation.
- **DTR history**: month-by-month daily time record for the signed-in student, or any student for
  administrators and supervisors. Split-shift sessions, unpaid breaks, late, undertime, overtime,
  rest days, and holidays are shown per day with period totals.
- **Reports**: printable A4 PDF with signatures, Excel workbook, and CSV export from the same DTR
  payload the screen renders.
- **Corrections**: students request a missing/incorrect punch with a required reason; reviewers
  approve (the punch is applied and the day recomputed) or reject with required notes. Original
  values are snapshotted first, and students can cancel pending requests.
- **Attendance records**: searchable by date and student with an admin-only delete action for test
  punches. A reason is required, open punches and pending corrections block deletion, and the full
  deleted day is snapshotted into the audit trail.
- **Schedule scoping**: pick a schedule once in the top bar and it applies to the dashboard, attendance
  list, correction queue, employee directory, and employee DTR selector. Each page also has its own
  schedule dropdown bound to the same selection, so a single group can be tracked from tab to tab.
  Filtering uses the schedule that was in force on each day.
- **Audit trail viewer**: administrators can search every recorded action, see the actor and entity,
  and inspect before/after snapshots. Audit rows remain immutable at the database level.
- **Database test harness**: 114 checks covering migrations, constraints, triggers, RPCs, onboarding,
  dashboards, employee management, DTR math, corrections, isolation, running real PostgreSQL offline
  through PGlite.
- Strict TypeScript, ESLint, production build, and a dev-only design system showcase.
- Documentation for the full target architecture and security model.

## Quick start

Requirements: Node.js 20+ and npm. (On this machine a portable Node runtime lives in `.tools/`;
it is git-ignored.)

```bash
npm install
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
npm run dev
```

Open http://localhost:5173. The app shows **Setup required** until Supabase credentials are present.
For a step-by-step project setup aimed at an OJT class, see
[docs/OJT-QUICKSTART.md](docs/OJT-QUICKSTART.md).

### Database migrations

```bash
# with the Supabase CLI linked to your project
supabase db push

# or paste, in filename order, into the Supabase SQL editor:
#   supabase/migrations/20261119000100_core_schema.sql
#   supabase/migrations/20261119000200_attendance_schema.sql
#   supabase/migrations/20261119000300_helpers_and_rpcs.sql
#   supabase/migrations/20261119000400_grants_and_rls.sql
#   supabase/migrations/20261119000500_onboarding.sql
#   supabase/migrations/20261119000600_auto_approve.sql
#   supabase/migrations/20261119000700_time_clock.sql
#   supabase/migrations/20261119000800_dashboard_and_employees.sql
#   supabase/migrations/20261119000900_dtr.sql
#   supabase/migrations/20261119001000_corrections.sql
#   supabase/migrations/20261119001100_text_cleanup.sql
#   supabase/migrations/20261119001200_audit_logs.sql
#   supabase/migrations/20261119001300_delete_schedule.sql
#   supabase/migrations/20261119001400_delete_schedule_unassign.sql
#   supabase/migrations/20261119001500_join_schedule.sql
#   supabase/migrations/20261119001600_leave_and_force_delete.sql
#   supabase/migrations/20261119001700_delete_attendance.sql
#   supabase/migrations/20261119001800_schedule_filters.sql

# Already applied 1-7? Paste one file instead:
#   supabase/APPLY-PHASES-4-TO-9.sql
```

Then create the first administrator with `supabase/scripts/bootstrap_admin.sql`.

### Environment variables

Only public values belong in the frontend. `VITE_SUPABASE_ANON_KEY` is safe to ship **because RLS
enforces authorization**. Never add a service-role key to any `VITE_*` variable.

| Variable                 | Required | Purpose                          |
| ------------------------ | -------- | -------------------------------- |
| `VITE_SUPABASE_URL`      | yes      | Supabase project root URL        |
| `VITE_SUPABASE_ANON_KEY` | yes      | Public anon key                  |
| `VITE_APP_NAME`          | no       | Product name in the shell        |
| `VITE_ORG_NAME`          | no       | Organization name on reports/UI  |
| `VITE_ORG_ADDRESS`       | no       | Report letterhead                |
| `VITE_ORG_LOGO_URL`      | no       | Public logo URL                  |
| `VITE_TIMEZONE`          | no       | IANA timezone (default Manila)   |

### Scripts

| Command             | Description                             |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Vite dev server with HMR                |
| `npm run build`     | Type-check with `tsc -b`, then build    |
| `npm run preview`   | Serve the production build locally      |
| `npm run lint`      | ESLint (zero warnings policy)           |
| `npm run typecheck` | Type-check only                         |
| `npm run test:db`   | Apply migrations to PGlite and run the database suite |
| `npm run test`      | Alias for the database suite            |
| `npm run format`    | Prettier with Tailwind class sorting    |

## Project structure

```
src/
  app/              Router, providers, error boundary, protected layout
  components/
    layout/         App shell, sidebar navigation
    ui/             Reusable design-system primitives
  features/
    account/        Personal profile details
    admin/          Dashboard, employees, attendance, DTR, corrections, schedules, approvals
    attendance/     Time clock and the printable DTR page
    auth/           Auth provider, guards, sign-in page
    corrections/    Student correction requests
    dashboard/      Personal workspace overview
    design/         Dev-only component showcase
    errors/         404 and error surfaces
    onboarding/     Registration, OJT profile, pending approval
    setup/          Installation instructions
  lib/              Env validation, Supabase client, dates, constants, export, utils
  styles/           Tailwind entry + design tokens
  types/            Domain types mirroring the database schema
docs/
  ARCHITECTURE.md   Target architecture, schema, RPCs, security model
  OJT-QUICKSTART.md Supabase + deployment setup for a class
supabase/
  migrations/       Versioned schema, triggers, RPCs, grants and RLS
  scripts/          One-off operational SQL such as the admin bootstrap
  seed.example.sql  Optional reference data, no attendance
tests/
  db/               PGlite integration suite (real PostgreSQL, no Docker)
```

## Security principles

1. **RLS on every table.** No table is readable or writable without a policy; the anon key alone
   grants nothing.
2. **RPC-first writes.** The client never issues `INSERT`/`UPDATE`/`DELETE` against attendance,
   profiles, schedules, or audit tables. Validated `SECURITY DEFINER` functions own those changes.
3. **Server timestamps.** Time in/out use the database clock, never a browser-supplied time.
4. **Immutable history.** Corrections are separate records; approved changes are additive and
   captured in `audit_logs` with before/after snapshots.
5. **No privileged keys in the browser.** Account provisioning uses a Supabase Edge Function with
   the service-role key held as a server-side secret.
6. **Defense in depth.** Client validation (Zod) for UX; SQL constraints, checks, and authorization
   helpers as the source of truth.

## Roadmap

| Phase | Scope                                              | Status      |
| ----- | -------------------------------------------------- | ----------- |
| 1     | Project foundation, design system, auth shell       | **Done**    |
| 2     | PostgreSQL schema, RLS, RPCs, migrations, DB tests   | **Done**    |
| 3     | Authentication hardening, onboarding, approvals     | **Done**    |
| 4     | Administrator dashboard (live statistics, charts)   | **Done**    |
| 5     | Employee management                                 | **Done**    |
| 6     | Time in / time out                                  | **Done**    |
| 7     | DTR computation, attendance history, filters        | **Done**    |
| 8     | Reports, PDF/CSV/Excel exports                      | **Done**    |
| 9     | Attendance correction workflow                      | **Done**    |
| 10    | Testing, security review, deployment                | **Done**    |

## Deployment

### Backend (Supabase)

1. Create the project and copy the project URL and **publishable/anon** key.
2. Run the migrations in `supabase/migrations` in filename order, or run
   `supabase/APPLY-PHASES-4-TO-9.sql` if Phases 1–6 are already applied.
3. Create the first administrator with `supabase/scripts/bootstrap_admin.sql`.
4. In **Authentication → Providers**, enable Email. For a classroom, turn **Confirm email** off so
   students can sign in immediately; turn it on for stricter verification.
5. Keep the **service-role key** out of the hosting provider and out of every `VITE_*` variable. RLS
   enforces authorization for the public key.
6. Before sharing the URL, turn **automatic approval off** unless you have verified the class list.

### Frontend (Netlify)

`netlify.toml` is committed, so Netlify needs almost no manual configuration:

| Setting          | Value           |
| ---------------- | --------------- |
| Build command    | `npm run build` |
| Output directory | `dist`          |
| Node version     | 22              |

**Option A — connect the Git repository (recommended, auto-deploys on every push)**

1. Netlify → **Add new site → Import an existing project → GitHub** → pick the repo.
2. Build settings are read from `netlify.toml`; press **Deploy**.
3. Add the environment variables below in **Site configuration → Environment variables**.

**Option B — deploy from this machine**

```
npx netlify-cli deploy --build --prod
```

Environment variables (public values only — they are compiled into the browser bundle):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
VITE_ORG_NAME="Your Organization"
VITE_ORG_ADDRESS="City, Philippines"
VITE_TIMEZONE=Asia/Manila
```

Deep links work on refresh because `netlify.toml` rewrites unknown paths to `index.html`
(`public/_redirects` carries the same rule for other static hosts).

After the first deploy, add the site URL under Supabase **Authentication → URL Configuration** as
the Site URL and a redirect URL, otherwise confirmation and recovery links point to localhost.


## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, data model, attendance
  engine rules, RPC catalog, RLS matrix, and deployment plan.
- [docs/OJT-QUICKSTART.md](docs/OJT-QUICKSTART.md) — getting a class online with Supabase and
  Netlify.
- [supabase/README.md](supabase/README.md) — migrations, database tests, and first-admin bootstrap.

## License

Proprietary. All rights reserved unless agreed otherwise with the client.
