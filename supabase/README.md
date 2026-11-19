# Supabase setup

This directory is the backend source of truth.

```
supabase/
  migrations/          versioned SQL (applied in filename order)
  scripts/             one-off operational SQL (admin bootstrap)
  seed.example.sql     optional reference data — never attendance
```

## 1. What the migrations create

| File | Contents |
| --- | --- |
| `20261119000100_core_schema.sql` | enums, `profiles`, `departments`, `work_schedules`, `schedule_periods`, `employees`, `schedule_assignments`, `holidays`, updated-at and auth-user triggers |
| `20261119000200_attendance_schema.sql` | `attendance_records`, `attendance_sessions`, `attendance_corrections`, `audit_logs`, duplicate/open/overlap guards, immutable audit trigger |
| `20261119000300_helpers_and_rpcs.sql` | authorization helpers, schedule resolution, audit writer, `health_check()`, `get_my_context()` |
| `20261119000400_grants_and_rls.sql` | minimal grants and Row Level Security for self / supervisor / admin scopes |
| `20261119000500_onboarding.sql` | `approved_at`/`approved_by`, `complete_onboarding`, `list_onboarding_requests`, `review_onboarding`, context approval state |
| `20261119000600_auto_approve.sql` | `app_settings`, `get_onboarding_settings`, `set_auto_approve`, automatic activation inside `complete_onboarding` |
| `20261119000700_time_clock.sql` | schedule helpers, `time_in`, `time_out`, `get_my_day`, `list_work_schedules`, `create_work_schedule`, `assign_schedule`, `ensure_default_schedule` |
| `20261119000800_dashboard_and_employees.sql` | `list_departments`, `create_department`, `admin_dashboard`, `list_employees`, `update_employee`, `set_employee_status` |
| `20261119000900_dtr.sql` | `get_dtr` (daily rows, sessions, totals, holidays), `list_attendance` with pagination |
| `20261119001000_corrections.sql` | `request_correction`, `list_my_corrections`, `cancel_correction`, `list_corrections`, `review_correction` |
| `20261119001100_text_cleanup.sql` | normalizes the default schedule description to ASCII |
| `20261119001200_audit_logs.sql` | `list_audit_logs` (admin-only, searchable, paginated, actor names, before/after data) |
| `20261119001300_delete_schedule.sql` | `delete_work_schedule` (admin-only, blocks assigned or attendance-backed schedules, audited) |
| `20261119001400_delete_schedule_unassign.sql` | adds `p_unassign` so a test schedule can be deleted by explicitly unassigning its employees; attendance-backed schedules still cannot be deleted |
| `20261119001500_join_schedule.sql` | `list_joinable_schedules`, `join_work_schedule` - students can pick a published schedule; joining starts today and is audited |
| `20261119001600_leave_and_force_delete.sql` | `leave_work_schedule`, `attendance_days` in the schedule list, and a force-delete that detaches (never erases) attendance |
| `20261119001700_delete_attendance.sql` | `delete_attendance_record` - admin-only removal of one test day with a required reason and a full audit snapshot |
| `20261119001800_schedule_filters.sql` | schedule scoping for the dashboard, attendance list, and correction queue |

Key invariants enforced by the database itself:

- `unique (employee_id, work_date)` — one attendance record per employee per day.
- Partial unique index — at most one **open** session per employee.
- Exclusion-style triggers — no overlapping sessions, schedule assignments, or paid periods.
- Immutable `audit_logs` (updates and deletes raise).
- An active employee row always has `approved_at` (self-onboarding starts inactive).
- No API role can write HR/attendance tables directly; only reads are granted, plus a two-column
  self-update on `profiles`.
- Every table has RLS enabled and policies limited to `authenticated`.

## 2. Apply migrations

### Hosted project (recommended)

1. Create the project in the Supabase dashboard.
2. Install the CLI and link:
   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref <project-ref>
   ```
3. Push:
   ```bash
   supabase db push
   ```

### SQL editor fallback

Paste every migration file into **SQL Editor → New query**, in filename order, and run each one. If
files 1–7 are already applied, run `APPLY-PHASES-4-TO-9.sql` once instead. Do not edit a migration
that has already been applied; add a new timestamped file.

### Verify

In the SQL editor:

```sql
select public.health_check(); -- requires a signed-in JWT, run from the app instead
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

Every application table should have `rowsecurity = true`.

## 3. First administrator

1. **Authentication → Users → Add user.** Create an email/password account and confirm the email.
2. Open `scripts/bootstrap_admin.sql`, replace `admin@example.com`, and run it.
3. Sign in at the app. The profile now has `role = 'admin'` and a matching employee row.

This bootstrap is deliberately not an RPC; it is a one-time operational step. All later role
changes are audited administrator actions.

## 4. Authentication settings for an OJT class

- Email provider: enabled.
- During enrolment: allow sign-ups so classmates can register.
- After enrolment: disable sign-ups; new accounts are then provisioned by the administrator.
- Email confirmation: ON for real deployments. For a short classroom demo you may turn it off to
  avoid email rate limits, but understand the trade-off.
- Minimum password length ≥ 12.
- JWT expiry 1 hour, refresh-token rotation on.
- Site URL / redirect URLs: your deployed app URL.

**Classmate flow (implemented):** a student signs up → completes their OJT profile
(student number, name, position) → the account is inactive and appears in the administrator's
approval queue → an administrator approves it → time in/out unlocks. Rejections require a written
reason and are archived with an audit entry.

Administrators can also enable **automatic approval** from the approvals page. The switch is stored
in `app_settings`, applies to every device, and optionally approves the existing queue at the moment
it is turned on.

## 5. Database tests (no Docker required)

```bash
npm run test:db
```

The harness starts embedded PostgreSQL (PGlite), applies the real migrations, seeds fixtures, and
checks constraints, triggers, RPC output, and RLS as the `authenticated`/`anon` roles. It covers:

- profile creation on auth-user insert,
- normalized employee numbers and case-insensitive emails,
- duplicate daily records and duplicate open sessions,
- overlapping sessions, assignments, and paid periods,
- correction uniqueness and audit immutability,
- `get_my_context()` shape and `health_check()` permissions,
- onboarding submission, duplicate student numbers, approval, rejection, and role gating,
- automatic approval: default off, admin-only changes, queue clearing, immediate activation,
- schedule creation, assignment, grace, duplicate-name rejection, deletion guards, and the audit entry,
- self-service joining: active schedules only, switch from today, open punches blocked, audited,
- leaving a schedule and force-deleting an attendance-backed schedule while keeping attendance rows,
- deleting a test attendance day: admin-only, reason required, open punch blocked, snapshot audited,
- schedule scoping: dashboard totals, attendance rows, and the correction queue filter by the
  schedule in force without leaking rows from other schedules,
- time in/out: one open session, duplicate punch rejection, record creation,
- attendance math: unpaid breaks excluded, late/undertime/overtime, rest days,
- dashboard totals and 14-day trend, employee search/pagination, profile-name sync, audited status changes,
- DTR payloads and totals, two-month limit, self-vs-classmate access, attendance listing,
- correction validation, approval that creates and recomputes a punch, rejection notes, cancellation,
- audit trail search, actor names, and admin-only access,
- employee/supervisor/admin row visibility,
- denial of direct writes and anon reads.

Latest run: **99/114 checks passed**. The harness is a development aid; always perform a final
end-to-end pass against a staging Supabase project before production.

## 6. Edge Functions

`functions/admin-employees/` (planned) will verify the caller's JWT, require an active admin, and
use a service-role client to provision accounts. The service-role key is supplied by the Supabase
runtime as a function secret and is never present in the frontend or repository.

## 7. Security notes

- The anon key is public; RLS is the boundary. Never put `service_role` in `VITE_*`.
- `private` schema helpers are executable only where policies need them.
- `get_my_context` exposes only the caller's own profile, employee row, and open session. Reporting
  RPCs assert `private.can_view_employee()` before returning rows.
- Enable Point-in-Time Recovery and MFA on the Supabase account for any real deployment.
