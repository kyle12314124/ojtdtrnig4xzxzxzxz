# OJT Quickstart — get your classmates online

This guide is for running the DTR system for a class or OJT group. You need two free accounts:

- **Supabase** — database + login accounts (free tier is enough for a class).
- **Netlify** — hosts the website (free tier).

The app cannot run for classmates from `localhost` alone: their browsers need a hosted backend.
Supabase provides that backend; Netlify serves the page.

> Current build status is **Phase 10 of 10**. Login, registration, OJT profile submission,
> administrator approval, work schedules, time in/out, the live dashboard, employee management, DTR
> history and exports, and attendance corrections all work against a real Supabase project.

---

## Step 1 — Create the Supabase project (5 minutes)

1. Go to https://supabase.com and sign in.
2. **New project** → name it (e.g. `ojt-dtr`) → choose the region closest to you → set a strong
   database password (save it in a password manager).
3. Wait for provisioning to finish.
4. Open **Project Settings → API** and copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`

The anon key is designed to be public. **Never copy the `service_role` key into the frontend.**

## Step 2 — Create the database

1. Open **SQL Editor → New query**.
2. Run the following files from `supabase/migrations/`, in this order, one at a time:
   1. `20261119000100_core_schema.sql`
   2. `20261119000200_attendance_schema.sql`
   3. `20261119000300_helpers_and_rpcs.sql`
   4. `20261119000400_grants_and_rls.sql`
   5. `20261119000500_onboarding.sql`
   6. `20261119000600_auto_approve.sql`
   7. `20261119000700_time_clock.sql`
   8. `20261119000800_dashboard_and_employees.sql`
   9. `20261119000900_dtr.sql`
   10. `20261119001000_corrections.sql`
   11. `20261119001100_text_cleanup.sql`
   12. `20261119001200_audit_logs.sql`
   13. `20261119001300_delete_schedule.sql`
   14. `20261119001400_delete_schedule_unassign.sql`
   15. `20261119001500_join_schedule.sql`
   16. `20261119001600_leave_and_force_delete.sql`
   17. `20261119001700_delete_attendance.sql`
   18. `20261119001800_schedule_filters.sql`
3. Confirm there are no errors. If one appears, stop and fix it before running the next file.

Already applied files 1–7? Run the single combined file
`supabase/APPLY-PHASES-4-TO-9.sql` instead of steps 8–11.

Optional reference data (departments, a standard 8–5 schedule) is in
`supabase/seed.example.sql`. Uncomment what you need and run it.

## Step 3 — Authentication settings

In **Authentication → Sign In / Providers → Email**:

- **Enable email provider:** ON. (Turning this off blocks email/password sign-in entirely,
  including administrators.)
- **Allow new users to sign up:** ON while classmates enrol, OFF afterwards.
- **Confirm email:** ON for real use. For a quick classroom demo you may turn it off, but then
  anyone who knows the URL can create an account.
- **Minimum password length:** 12.
- **URL Configuration:** set the Site URL to your deployed address once you have it.

## Step 4 — Create your administrator account

1. **Authentication → Users → Add user.** Use your own email and a strong password. Confirm the
   email if confirmations are on.
2. Open `supabase/scripts/bootstrap_admin.sql`, replace `admin@example.com` with your email, and
   run it in the SQL editor.
3. You now have the `admin` role.

## Step 5 — Run the app locally

In the project folder:

```powershell
# Use the portable Node runtime installed for this project (or install Node 20+ yourself)
$env:Path = "C:\Users\123\Downloads\dtr\.tools\node-v26.13.1-win-x64;$env:Path"

Copy-Item .env.example .env
notepad .env
```

Fill in:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_ORG_NAME=Your School / Organization
```

Then:

```powershell
npm.cmd run dev
```

Open http://localhost:5173, sign in with the administrator account, and use **Run connection
check** on the workspace page. It should report the PostgreSQL version.

## Step 6 — Classmate accounts

1. Send classmates the deployed URL.
2. They choose **Create an account**, register with their email, and submit their student number,
   name, and position.
3. The account is inactive and appears under **OJT approvals** for you as administrator.
4. Approve it — timekeeping unlocks immediately, and the student's status screen updates on its own.

**In a hurry?** On the approvals page, turn on **Automatically approve new students**. Every
submission is then activated immediately, and you can optionally approve everything already in the
queue at the same moment. The switch is stored in the database and audited, so it applies to every
device. Turn it off once enrolment is done.

Rejections require a written reason and are archived with an audit entry. If registrations are
closed (`Enable email provider` off, or sign-ups disabled), create accounts manually under
**Authentication → Users → Add user** with **Auto Confirm User** checked; the student then signs in
and completes the same onboarding form.

Do not share one account between classmates: attendance records must identify one person.

## Step 7 — Create a work schedule

Time in stays locked until a schedule exists.

1. Sign in as administrator → **Administration → Work schedules**.
2. Click **Create the standard OJT schedule** (Monday–Friday, 8:00–12:00 and 13:00–17:00, 10-minute
   grace). It is assigned automatically to every active classmate without a schedule.
3. Need different hours? Use **New schedule** and set the paid periods and working days. The gaps
   between periods are unpaid breaks.

Each classmate can now open the workspace and use **Time in / Time out**. Timestamps come from the
database clock, not the device, and daily totals update immediately.

## Step 8 — Day-to-day use

- **Students** open **My DTR** to see each day, request a correction, and download PDF/Excel/CSV.
  If they have no schedule yet, they open **My schedule**, pick the one you published, and join it.
  They can also leave it later; time in locks until they join again.
- **Administrators** use **Dashboard** for live counts, **Attendance** for all saved days,
  **Corrections** for pending fixes, and **Employee DTR** to open anyone's printable record.
  The **Schedule** selector in the top bar narrows every administrative page at once, and each page
  keeps its own dropdown for the same selection. Test punches can be removed from **Attendance**
  with a required reason; the removed day is snapshotted into the audit trail.
- **Employees** can edit names, positions, departments, and schedules, and deactivate accounts.
  Deactivation is blocked while a student has an open time-in.
- **Audit trail** lists every recorded action with the actor and before/after values.
- **On phones** the four most-used pages sit in a bottom tab bar and the "More" button opens the
  full menu. Wide tables switch to stacked cards, so nothing needs sideways scrolling.
- Every change writes an audit row with before/after values.

## Step 9 — Publish the site

Netlify:

1. Push the project to GitHub (never commit `.env`).
2. Netlify → **Add new site → Import an existing project → GitHub** → choose the repo.
3. `netlify.toml` already sets the build command (`npm run build`), publish directory (`dist`), and
   Node 22, so you can accept the detected settings and press **Deploy**.
4. Add environment variables in **Site configuration → Environment variables**:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the optional `VITE_ORG_*` values. Redeploy
   after adding them.
5. Deep links such as `/admin/dashboard` work on refresh because `netlify.toml` rewrites unknown
   paths to `index.html`.
6. Copy the site URL (`https://your-site.netlify.app`) into Supabase
   **Authentication → URL Configuration → Site URL** and **Redirect URLs**.

You can also deploy from this machine with `npx netlify-cli deploy --build --prod`.

Share the Netlify URL with your classmates. They can sign in from any device on any network.

> Before sharing, turn **automatic approval off** on the OJT approvals page unless you have verified
> the class list. Remove or deactivate any test accounts you created.

## Free-tier notes

- Supabase pauses inactive free projects; open the dashboard before a demo.
- Auth emails have rate limits. For a large class, keep email confirmation on but enrol early, or
  ask your instructor about a shared SMTP provider.
- Netlify is free for static sites with 100 GB bandwidth per month; Supabase free tier includes
  500 MB database and generous auth usage — plenty for attendance records.

## Security checklist

- `service_role` key never appears in the repo, `.env`, or host environment variables.
- RLS stays enabled on every table (migrations enforce it).
- Sign-ups disabled after enrolment.
- Administrator accounts use unique passwords and email confirmation.
- Test accounts are deactivated or archived after the demo.
