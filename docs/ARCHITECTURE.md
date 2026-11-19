# Architecture

**Document status:** Phase 10 baseline - schema, constraints, RLS, onboarding/approval, work
schedules, server-timestamped punches, dashboards, employee management, DTR history/exports, and the
correction workflow are implemented and tested.
**Scope:** Production architecture for the DTR Management System.

---

## 1. Goals and constraints

| Goal                     | Consequence                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| Trustworthy time records | Server timestamps, immutable audit trail, corrections never overwrite data   |
| Real-world schedules     | Per-employee schedules, split shifts, unpaid breaks, overnight shifts        |
| Role separation          | Admin / supervisor / employee with RLS + validated RPCs                     |
| Accurate reporting       | One canonical calculation in PostgreSQL; client never computes official DTR |
| Printable artifacts      | A4/long-bond DTR PDFs with signature blocks                                 |
| Operable by HR           | No SQL required for daily work; clear empty/error/loading states            |
| Deployable               | Netlify + Supabase, migrations and secrets managed outside the repo          |

Non-goals for v1: payroll processing, leave management, biometric device integration, mobile apps.
The schema leaves room for these (leave status is already modelled) without committing to them.

---

## 2. Runtime topology

```
┌────────────────────────────┐        HTTPS / JWT        ┌─────────────────────────────┐
│ Netlify                    │ ────────────────────────► │ Supabase                     │
│ React SPA (static)         │                           │  ├─ Auth (GoTrue)            │
│ - anon key only            │ ◄──────────────────────── │  ├─ PostgREST (RPC only)     │
│ - no secrets               │        JSON results       │  ├─ PostgreSQL + RLS         │
└────────────────────────────┘                           │  └─ Edge Functions           │
                                                         │      (service role, admin)   │
                                                         └─────────────────────────────┘
```

- The browser holds a short-lived JWT; Supabase Auth refreshes it automatically.
- **All reads and writes go through SQL functions (`/rest/v1/rpc/*`).** Tables are not used as a
  generic CRUD API. This centralizes authorization and validation, keeps the client typed, and
  makes the local-vs-production surface small. The single exception in Phase 1 is the auth
  bootstrap read of the caller's own `profiles` row (SELECT, RLS-scoped), which Phase 3 replaces
  with `get_my_context()`.
- A single Edge Function (`admin-employees`) holds the service-role key to create/disable auth
  users. It verifies the caller's JWT and role before acting. The key never reaches the browser.

---

## 3. Frontend architecture

```
src/
  app/          router, providers, error boundary, protected layout
  components/   layout + ui primitives (no business logic)
  features/     one folder per domain, colocated hooks/components
  lib/          env, supabase client, dates, formatting, constants
  types/        domain types mirroring SQL result shapes
```

Conventions:

- **Feature-first.** Pages import feature hooks; features import `lib` and `components/ui`.
  Cross-feature imports are avoided.
- **Server state via TanStack Query.** Query keys are namespaced (`['dtr', employeeId, range]`).
  Mutations invalidate the affected keys. No global store for server data.
- **Auth state via context.** One `AuthProvider` owns the session and the caller's profile; route
  guards read it. Authorization is still re-checked server-side — the UI only hides affordances.
- **Validation.** Zod schemas at every form boundary; shared with `react-hook-form`. SQL repeats
  the checks because client input is untrusted.
- **Dates.** UTC ISO strings cross the network. `src/lib/dates.ts` is the only place allowed to
  convert to/from `Asia/Manila` (configurable via `VITE_TIMEZONE`). Date-only columns are rendered
  without timezone conversion.
- **Errors.** Domain errors from RPCs are mapped to human messages; raw SQL text is never shown to
  employees. React Query `error` states render `ErrorState`; loading uses skeletons, not spinners
  that shift layout.
- **Accessibility.** Focus trapping in dialogs, labelled controls, `aria-invalid` on errors,
  visible focus rings, keyboard-operable menus/navigation, reduced motion respected by avoiding
  unnecessary animation.

Route layout (target):

| Path                       | Roles                 | Phase |
| -------------------------- | --------------------- | ----- |
| `/login`                   | public                | 1 ✅  |
| `/setup`                   | public diagnostics    | 1 ✅  |
| `/`                        | all authenticated     | 1✅ / 4 dashboard |
| `/attendance`              | employee              | 6     |
| `/dtr`                     | employee              | 7     |
| `/corrections`             | employee / reviewer   | 9     |
| `/account`                 | all authenticated     | 1 ✅  |
| `/admin/employees`         | admin                 | 5     |
| `/admin/attendance`        | admin, supervisor     | 7     |
| `/admin/corrections`       | admin, supervisor     | 9     |
| `/admin/schedules`         | admin                 | 5     |
| `/admin/holidays`          | admin                 | 5     |
| `/admin/reports`           | admin, supervisor     | 8     |
| `/admin/audit`             | admin                 | 10    |

---

## 4. Data model

PostgreSQL 15+ (Supabase). UUID primary keys (`gen_random_uuid()`), `timestamptz` for instants,
`date` for work days, `numeric` never used for money (not in scope). All tables carry
`created_at`/`updated_at` where mutable and a trigger to maintain `updated_at`.

### 4.1 Enumerated types

```
user_role            admin | supervisor | employee
account_status       active | inactive | archived
employment_type      regular | probationary | contractual | part_time | intern
attendance_status    present | late | absent | on_leave | holiday | rest_day
session_type         morning | afternoon | evening | custom
attendance_source    web | manual | correction
correction_type      missing_time_in | missing_time_out | incorrect_time | other
correction_status    pending | approved | rejected | cancelled
holiday_type         regular | special_non_working | special_working
```

### 4.2 Table summary

```
departments ──< employees >── profiles (1:1 auth.users)
                   │  │
                   │  └──< schedule_assignments >── work_schedules ──< schedule_periods
                   ├──< attendance_records ──< attendance_sessions
                   ├──< attendance_corrections
                   └──< employees (supervisor_id, self-reference)

holidays        (referenced by calculation, not FK-joined)
audit_logs      (append-only, polymorphic entity reference)
```

#### `profiles`

| Column       | Type          | Notes                                              |
| ------------ | ------------- | -------------------------------------------------- |
| `id`         | uuid PK       | FK `auth.users(id)` `ON DELETE CASCADE`             |
| `role`       | user_role     | default `employee`; changeable only by admin RPC    |
| `full_name`  | text          | 2–120 chars                                         |
| `email`      | text          | unique, lowercase, format check                     |
| `phone`      | text          | optional, E.164-ish check                           |
| `avatar_url` | text          | public object URL                                   |
| `is_active`  | boolean       | blocks sign-in UI and RPCs                          |
| timestamps   | timestamptz   |                                                     |

Created automatically by an `auth.users` trigger using `raw_user_meta_data` (never trusts role from
client metadata beyond `employee`). The first admin is bootstrapped manually (see
`supabase/README.md`).

#### `departments`

`id`, `name` (unique, 2–80), `code` (unique, uppercase 2–12), `description`, `is_active`,
timestamps. Index: `lower(name)`.

#### `work_schedules`

`id`, `name` (unique), `description`, `timezone` (default `Asia/Manila`), `grace_minutes`
(0–120, default 0), `work_days` `smallint[]` (1=Mon … 7=Sun, non-empty), `is_active`, timestamps.
Each schedule owns ordered **paid periods** in `schedule_periods` (`label`, `start_time`,
`end_time`, `sort_order`). Gaps between periods are unpaid breaks. Periods may cross midnight
(`end_time < start_time`). Constraint: at most one period per label per schedule.

Example: `Morning 08:00–12:00`, `Afternoon 13:00–17:00` → 480 paid minutes, 60 unpaid break.

#### `schedule_assignments`

`id`, `employee_id`, `schedule_id`, `effective_from date`, `effective_to date NULL`,
`assigned_by`, `created_at`. A validation trigger prevents overlapping ranges per employee. This
table is the **historical source of truth** for schedule resolution on a work date.
`employees.schedule_id` is a denormalized pointer to the current assignment, maintained by the same
RPC, used for filtering and display.

#### `employees`

| Column            | Notes                                                    |
| ----------------- | -------------------------------------------------------- |
| `id`              | uuid PK                                                   |
| `profile_id`      | unique, FK profiles, `ON DELETE RESTRICT`                 |
| `employee_no`     | unique, format `^[A-Z0-9-]{3,20}$`                        |
| `first_name`, `middle_name`, `last_name` | required except middle                       |
| `email`           | unique, lowercase (kept in sync with auth + profile)      |
| `department_id`   | FK departments (nullable until assigned)                  |
| `position`        | text                                                      |
| `employment_type` | enum                                                      |
| `date_hired`      | date, not in the future                                   |
| `schedule_id`     | FK work_schedules (current pointer)                       |
| `supervisor_id`   | FK employees, not self                                    |
| `status`          | `active` / `inactive` / `archived`                        |
| `archived_at`     | set together with status                                  |

Indexes: `department_id`, `status`, `schedule_id`, `supervisor_id`, `lower(last_name)`,
`lower(email)`, optional `pg_trgm` index for directory search.

Rules: archived employees are read-only; deactivation keeps history; hard delete is never exposed
(RESTRICT + archive).

#### `attendance_records` — one row per employee per work day

| Column             | Notes                                                     |
| ------------------ | --------------------------------------------------------- |
| `id`               | uuid PK                                                   |
| `employee_id`      | FK employees                                              |
| `work_date`        | `date` in organization timezone                            |
| `schedule_id`      | snapshot of the schedule used                              |
| `first_time_in`    | timestamptz, derived from earliest session                 |
| `last_time_out`    | timestamptz, null while a session is open                  |
| `worked_minutes`   | int ≥ 0, paid time excluding unpaid breaks                 |
| `late_minutes`     | int ≥ 0, first time-in vs scheduled start + grace          |
| `undertime_minutes`| int ≥ 0, scheduled paid time not worked                    |
| `overtime_minutes` | int ≥ 0, paid time outside scheduled windows               |
| `status`           | attendance_status                                           |
| `remarks`          | text (e.g. "Missing time-out", "Holiday")                  |
| `is_locked`        | blocks further web punches once payroll finalizes           |
| timestamps         |                                                            |

**Constraint:** `unique (employee_id, work_date)` — the database itself prevents duplicate daily
records. Checks ensure totals are non-negative and timeouts follow time-ins. Indexes:
`(employee_id, work_date DESC)`, `(work_date, status)`.

Absences are **derived**, not inserted: a past scheduled work day with no record is rendered as
`absent` by queries. This avoids cron-generated fake rows.

#### `attendance_sessions` — the actual punch pairs (split shifts)

| Column                 | Notes                                             |
| ---------------------- | ------------------------------------------------- |
| `id`                   | uuid PK                                           |
| `attendance_record_id` | FK records, `ON DELETE CASCADE`                    |
| `employee_id`          | denormalized for indexes/RLS                      |
| `work_date`            | copied from the record                            |
| `session_type`         | morning / afternoon / evening / custom            |
| `time_in`              | timestamptz NOT NULL, server clock                 |
| `time_out`             | timestamptz NULL while open                        |
| `worked_minutes`       | int, computed on close                             |
| `is_open`              | generated/maintained boolean                       |
| `source`               | web / manual / correction                          |
| `created_by`           | profile id                                         |

Constraints:

- `check (time_out is null or time_out > time_in)`
- **Partial unique index** `(employee_id) WHERE time_out IS NULL` → one active session per employee;
  the authoritative guard against duplicate time-ins.
- **Overlap trigger** using `tstzrange(time_in, coalesce(time_out, 'infinity'))` per employee →
  prevents overlapping sessions, even across split shifts. Implemented as a trigger instead of an
  exclusion constraint so the schema needs no `btree_gist` extension and runs on every Postgres.
- Indexes: `(employee_id, work_date)`, partial index on open sessions.

#### `attendance_corrections`

`id`, `employee_id`, `attendance_record_id NULL`, `work_date`, `correction_type`,
`requested_time_in`, `requested_time_out`, `reason` (10–1000 chars), `status`,
`reviewed_by`, `reviewed_at`, `review_notes`, `applied_at`, `original_snapshot jsonb`,
`created_at`.

Rules:

- One `pending` request per employee/work_date/type (partial unique index).
- Employees may cancel only their own pending requests.
- Approval is transactional: apply the change to sessions/record with `source='correction'`, store
  the pre-change snapshot on the correction and in `audit_logs`, then mark approved.
- Rejection requires notes.
- Original values are never destroyed; the audit trail plus snapshots allow reconstruction.

#### `holidays`

`id`, `name`, `holiday_date date`, `holiday_type`, `is_paid`, timestamps.
Unique `(holiday_date, name)`. Index `holiday_date`. Used by the calculation engine to zero
late/undertime and classify work as overtime on non-working days.

#### `audit_logs`

`id bigint identity`, `actor_id`, `actor_role`, `action` (e.g. `attendance.time_in`),
`entity_type`, `entity_id`, `summary`, `before_data jsonb`, `after_data jsonb`, `ip_address`,
`user_agent`, `created_at`.

Only `SELECT` is granted to admins; inserts happen inside RPCs (definer). No update/delete policy or
grant exists. Indexes: `(created_at DESC)`, `(entity_type, entity_id)`, `(actor_id)`.

---

## 5. Attendance engine (implemented)

All official calculations execute in PostgreSQL. The browser sends no timestamps and no totals.

### 5.1 Time in

1. Authenticate `auth.uid()` → active employee (else `EMPLOYEE_NOT_ACTIVE`).
2. Reject if an open session exists (`ALREADY_TIMED_IN`). The partial unique index is the final
   guard under concurrency.
3. `v_now := now()`; the work date comes from the schedule timezone, rolling back one day when an
   overnight period is still running.
4. Resolve the schedule effective on that date (`schedule_assignments`); if none,
   `SCHEDULE_NOT_ASSIGNED` blocks the punch.
5. Upsert the daily record (unique constraint) and insert a session with `time_in = v_now`.
6. Recompute the day's totals and status. Return the open session and the day payload.

### 5.2 Time out

1. Find the caller's open session - **not** restricted to today, so overnight shifts close
   correctly. If none: `NOT_TIMED_IN`.
2. `time_out = now()`; recompute the whole day from every session (idempotent).
3. Update record totals/status, close the session. Return the day payload.

### 5.3 Daily aggregation

```
paid windows        = each schedule period on the work date (overnight end rolls to next day)
worked_minutes      = Σ overlap(closed sessions, paid windows)
scheduled_minutes   = Σ paid window minutes
late_minutes        = max(0, first_time_in - (first window start + grace)), capped at scheduled
undertime_minutes   = max(0, scheduled - worked)   // only when every session is closed
overtime_minutes    = Σ session minutes before the first window or after the last window
status              = holiday / rest_day / late / present
```

- Worked time is paid time actually present; lunch is excluded even if the employee never clocked
  out, because the gap is unpaid.
- Early arrival and post-shift work count as overtime; late arrival does not reduce overtime if the
  employee makes up the time, but is still reported as late.
- Non-working days (rest day / holiday): no late or undertime; all worked time is overtime, status
  `rest_day`/`holiday` unless a correction says otherwise.
- Sessions are merged defensively even though the exclusion constraint prevents overlaps.
- Overnight: intervals are compared as instants, so a 22:00→06:00 shift is 480 minutes. The record's
  `work_date` is the local date of the first time-in.
- Grace applies only to lateness; undertime is measured against actual scheduled minutes.
- `is_locked` blocks punches and corrections once payroll closes a period.

### 5.4 Missing time-outs

An open session whose `work_date` is before today stays open and is not counted as worked (undertime
is also withheld until the day is closed). Nothing is auto-filled. The employee files a correction; a
reviewer applies it with an audit trail. The dashboard count and the DTR page make the open punch
visible so it is fixed before the record is printed.

### 5.5 Worked example

Schedule 08:00–12:00 and 13:00–17:00, grace 10 minutes.
Punches: 08:07 in, 12:00 out, 13:00 in, 17:00 out.

```
sessions         = 08:07–12:00 (233m), 13:00–17:00 (240m) = 473m
break overlap    = none (already out during lunch)
worked_minutes   = 473
scheduled        = 480
late             = max(0, 08:07 − 08:10) = 0
undertime        = 480 − 473 = 7
overtime         = 0
status           = present
```

With a 0-minute grace, late = 7 and undertime = 7.

---

## 6. Security model

### 6.1 Roles

| Capability                 | Employee | Supervisor        | Admin |
| -------------------------- | -------- | ----------------- | ----- |
| Time in/out (self)         | ✅       | ✅                | ✅    |
| View own attendance/DTR    | ✅       | ✅                | ✅    |
| Request corrections (self) | ✅       | ✅                | ✅    |
| View team attendance       | —        | assigned team     | all   |
| Review corrections         | —        | assigned team     | all   |
| Manage employees           | —        | —                 | ✅    |
| Schedules, holidays        | —        | —                 | ✅    |
| Audit log                  | —        | —                 | ✅    |

Roles live in `profiles.role`; `auth.users.raw_user_meta_data` is **not** trusted for authorization.

Helper functions (in a `private` schema, not exposed via RPC):
`private.current_profile()`, `private.is_admin()`, `private.is_supervisor()`,
`private.current_employee_id()`, `private.supervises(employee_id)`,
`private.assert_role(...)`.

### 6.2 RLS matrix (SELECT unless stated)

| Table                  | Employee            | Supervisor                   | Admin |
| ---------------------- | ------------------- | ---------------------------- | ----- |
| `profiles`             | own row             | own + team profiles          | all   |
| `employees`            | own row             | own + directly supervised     | all   |
| `departments`          | active              | active                       | all   |
| `work_schedules`       | active              | active                       | all   |
| `schedule_periods`     | of active schedules | of active schedules          | all   |
| `schedule_assignments` | own                 | team                         | all   |
| `attendance_records`   | own                 | team                         | all   |
| `attendance_sessions`  | own                 | team                         | all   |
| `attendance_corrections`| own                | team                         | all   |
| `holidays`             | all                 | all                          | all   |
| `audit_logs`           | none                | none                         | all   |

There are **no INSERT/UPDATE/DELETE policies** for employees or supervisors on any attendance or
HR table. Admin writes go through RPCs as well, keeping one validated path. `audit_logs` has no
write policy at all and no `UPDATE`/`DELETE` grants.

RLS protects against accidental direct table access; `SECURITY DEFINER` RPCs perform explicit
authorization because they run with the definer's privileges. Every RPC starts with an assertion
helper, and every RPC is listed in the catalog below.

### 6.3 Function hygiene

- `SECURITY DEFINER` + `SET search_path = public, pg_temp`.
- Explicit `REVOKE ALL ... FROM PUBLIC` then `GRANT EXECUTE` to `authenticated` only (never `anon`)
  for business functions.
- Inputs validated for type, range, length, and ownership; errors raised with stable codes.
- No dynamic SQL built from user input.
- Rate/abuse: partial unique indexes prevent duplicate sessions; time-in/out RPCs take no
  client timestamps.

### 6.4 Secrets and Edge Functions

- Browser bundle receives only the URL and anon key. `src/lib/env.ts` rejects anything containing
  `service_role`.
- `admin-employees` Edge Function: verifies `Authorization` JWT, loads caller profile, requires
  `admin`, then uses the service-role client to create/disable auth users. Secrets come from
  Supabase function env (`SUPABASE_SERVICE_ROLE_KEY`), never the repo.
- Service-role keys are never logged and never returned in responses.

### 6.5 Audit

Every state-changing RPC appends an `audit_logs` row inside the same transaction: actor, action,
entity, before/after snapshots, and a human summary. Corrections additionally store
`original_snapshot`. Authentication events (sign-in) are recorded by Supabase Auth's own logs.

---

## 7. RPC catalog

Implemented RPCs are marked ✅; the rest are planned.

All return JSON-ready rows/objects; paginated reads return `{ items, total, page, page_size }`.

**Account & onboarding**

| Function                                             | Purpose                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| ✅ `health_check()`                                  | liveness probe used by the setup page                               |
| ✅ `get_my_context()`                                | profile + employee + approval state + open session + server time    |
| ✅ `complete_onboarding(no, first, last, middle, pos)` | self-registration of OJT details; creates an inactive employee     |
| ✅ `list_onboarding_requests()`                      | admin approval queue (oldest first)                                 |
| ✅ `review_onboarding(id, approve, notes)`           | approve (activate) or reject (archive, reason required) + audit     |
| ✅ `get_onboarding_settings()`                       | admin-only: auto-approve flag + pending count                       |
| ✅ `set_auto_approve(enabled, apply_pending)`        | admin-only: toggle automatic approval, optionally clear the queue   |

**Employee**

| Function                                     | Purpose                                            |
| -------------------------------------------- | -------------------------------------------------- |
| ✅ `get_my_context()`                           | profile + employee + current schedule              |
| ✅ `get_my_day(p_date)`                         | today's record, sessions, schedule, open session   |
| ✅ `time_in()`                                  | server-timestamped open session                    |
| ✅ `time_out()`                                 | close session, recompute totals, return duration   |
| ✅ `get_dtr(p_employee, p_start, p_end)`        | daily rows, sessions, holidays, and period totals  |
| ✅ `request_correction(p_work_date, p_type, p_time_in, p_time_out, p_reason)` | validated pending request |
| ✅ `list_my_corrections(p_limit)`               | the caller's request history                        |
| ✅ `cancel_correction(p_id)`                    | pending requests only                               |
| `update_my_contact(p_phone)`                 | limited profile update (planned)                    |

**Admin / Supervisor**

| Function                                    | Notes                                        |
| ------------------------------------------- | -------------------------------------------- |
| ✅ `admin_dashboard(p_date, p_schedule_id)`   | live counters, 14-day trend, recent punches, departments; optional schedule scope |
| ✅ `list_employees(p_search, p_status, p_schedule, p_page, p_size)` | search + filters + pagination |
| ✅ `update_employee(...)`                     | employment details; syncs the profile name   |
| ✅ `set_employee_status(p_id, p_status, p_reason)` | activate/deactivate/archive with audit; blocks open punches |
| ✅ `list_departments()` / `create_department(name, code)` | reference data                    |
| ✅ `list_work_schedules()`                    | schedules with periods, assigned counts, and attendance days |
| ✅ `create_work_schedule(name, description, grace, work_days, periods, assign_unassigned)` | schedule + periods |
| ✅ `delete_work_schedule(p_schedule_id, p_unassign, p_force)` | admin-only hard delete; force removes an attendance-backed schedule without erasing attendance; audited |
| ✅ `list_joinable_schedules()` / `join_work_schedule(p_schedule_id)` / `leave_work_schedule()` | employees see active schedules, join, and leave; starts today; open punches block changes; audited |
| ✅ `delete_attendance_record(p_record_id, p_reason)` | admin-only test-punch removal; reason required; open punches and pending corrections block it; snapshot audited |
| ✅ `assign_schedule(p_employee, p_schedule, p_from)` | writes assignment + pointer            |
| ✅ `assign_schedule_to_unassigned(p_schedule)` | bulk assignment for new employees           |
| ✅ `ensure_default_schedule()`                | creates the standard Mon-Fri split shift     |
| ✅ `list_attendance(p_start, p_end, p_employee, p_page, p_size, p_schedule_id)` | admin/supervisor scope, filtered by the schedule in force |
| ✅ `list_corrections(p_status, p_page, p_size, p_schedule_id)` | reviewer queue, filtered by the schedule in force |
| ✅ `review_correction(p_id, p_approve, p_notes)` | transactional apply + recompute + audit  |
| ✅ `list_audit_logs(p_search, p_page, p_size)` | admin-only audit search with actor names and before/after data |
| `upsert_holiday(p_payload)`                 | create/update (planned)                      |
| `report_daily` / `report_late_undertime` / `report_overtime` / `report_department` | aggregate reports (planned; the DTR export covers per-employee output today) |

Edge Function: `admin-employees` (`create`, `reset_password`, `disable`) - server-side service role
(planned; the current flow is self-registration plus administrator approval).

Pages call these functions through the shared Supabase client and map the JSON into the types in
`src/types/index.ts`. Mutations are always RPCs, never direct table writes.

---

## 8. Reports and exports

- The server returns a canonical `DtrPayload` (`employee`, `period`, `rows`, `totals`). The table,
  PDF, CSV, and Excel exports all render **the same payload**, so formats cannot disagree.
- PDF: jsPDF + autotable, A4 portrait, letterhead from env, columns Date / Day / Time in / Time
  out / Worked / Late / Under / Over / Status, period totals, employee/reviewer/approver signature
  lines, page numbers, and a generated-on date.
- CSV: RFC 4180 quoting and a UTF-8 BOM so Excel opens non-ASCII names correctly.
- Excel: ExcelJS with a styled header, employee block, one row per day, totals, and a signature
  area; generated client-side from the same payload.
- Exports are scoped by the `get_dtr` authorization check; an employee cannot request another
  employee's DTR, and the two-month limit keeps payloads bounded.

---

## 9. Timezone strategy

- Database stores `timestamptz` in UTC; Postgres renders in the session timezone.
- Work days are computed as `(ts AT TIME ZONE schedule.timezone)::date`.
- The client displays with `date-fns-tz` using `VITE_TIMEZONE` (default `Asia/Manila`).
- Date-only values (`date_hired`, `holiday_date`, `work_date`) never pass through a timezone
  conversion.
- Server generates all punch timestamps; a wrong device clock cannot falsify attendance.

---

## 10. Testing strategy

| Layer            | Tooling                                        | Coverage                                            |
| ---------------- | ---------------------------------------------- | --------------------------------------------------- |
| Database         | PGlite (real Postgres, no Docker)              | Migrations apply, constraints, RLS, every RPC path   |
| Static           | TypeScript, ESLint, Prettier                   | Strict types and zero-warning lint                   |
| Build            | Vite production build                          | Chunking, dynamic PDF/Excel imports                  |
| Browser          | Manual smoke pass                              | Auth guard, role routing, time clock, DTR, exports   |

The database suite is the gate: `npm run test:db` currently runs **114 checks**. UI flows that need a
real hosted project are exercised in the browser against the configured Supabase project.

---

## 11. Deployment

**Supabase**

1. Create project (region closest to the organization).
2. Apply migrations in order, or run `APPLY-PHASES-4-TO-9.sql` after Phases 1-6. Seed only reference
   data (departments, schedules) via a documented script - **never fake attendance**.
3. Enable the email provider, set the password policy, and choose whether open sign-up stays on.
4. Bootstrap the first admin (documented SQL). Later role changes are audited administrator actions.
5. The optional `admin-employees` Edge Function is not required for the self-registration flow; add
   it later if accounts must be provisioned centrally with the service-role key.

**Netlify**

- Build command `npm run build`, publish directory `dist`, Node 22 — all set in `netlify.toml`.
- SPA fallback for client-side routing (redirect in `netlify.toml`, mirrored in `public/_redirects`).
- Environment variables: only `VITE_*` public values; production anon key.
- Security headers are configured in `netlify.toml` (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`) plus immutable caching for hashed assets.
- Add the deployed URL to Supabase Auth **Site URL** and **Redirect URLs**.

**Environments:** local, staging (separate Supabase project), production. Migrations are versioned
and applied via CLI/CI; dashboards are not edited by hand.

---

## 12. Phase gates

Each phase: implement → test → fix → document → report. A phase is complete only when:

- `npm run lint`, `npm run typecheck`, and `npm run build` pass.
- Database migrations apply cleanly to a fresh database and are reversible where practical.
- The feature is exercised in a real browser against a real database; no claim without evidence.
- No dead buttons, no hardcoded statistics, no secrets in the bundle.

---

## 13. Confirmed decisions

1. **Backend.** Supabase PostgreSQL + Auth, accessed through RPCs. RLS is defense in depth; the
   publishable key is safe for the browser and no service-role key ships to the client.
2. **Attendance.** One record per employee/day, multiple punch pairs, unpaid gaps between paid
   periods, 10-minute grace by default, and overtime measured outside the first-start..last-end
   envelope.
3. **Missed time-outs.** No auto-close. The open punch stays visible; the employee files a
   correction and a reviewer applies it with an audit trail.
4. **Holiday work.** Counted as overtime; late/undertime are suppressed when no paid work occurred.
5. **Class enrolment.** Self-registration, OJT profile, administrator approval (or the audited
   automatic-approval switch), then timekeeping.
6. **Schedules.** Monday-Friday 08:00-12:00 / 13:00-17:00 by default; administrators can define
   split shifts, rest days, and overnight periods.
