-- ===========================================================================
-- DTR Management System — Phase 2, migration 2 of 4
-- Attendance records and sessions, correction requests, audit log, and the
-- integrity triggers that make duplicate/overlapping punches impossible.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Schedule period integrity: paid periods within one schedule may not overlap
-- (an overnight period wraps past midnight). This keeps scheduled-minute math
-- unambiguous.
-- ---------------------------------------------------------------------------
create or replace function private.validate_schedule_period()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_start numeric;
  v_end numeric;
begin
  v_start := extract(epoch from new.start_time) / 60;
  v_end := extract(epoch from new.end_time) / 60;
  if v_end <= v_start then
    v_end := v_end + 1440;
  end if;

  if exists (
    select 1
    from public.schedule_periods p
    cross join lateral (
      select
        extract(epoch from p.start_time) / 60 as p_start,
        case
          when extract(epoch from p.end_time) <= extract(epoch from p.start_time)
            then extract(epoch from p.end_time) / 60 + 1440
          else extract(epoch from p.end_time) / 60
        end as p_end
    ) q
    cross join generate_series(-1, 1) as k
    where p.schedule_id = new.schedule_id
      and (tg_op = 'INSERT' or p.id <> new.id)
      and v_start < q.p_end + k * 1440
      and q.p_start + k * 1440 < v_end
  ) then
    raise exception 'SCHEDULE_PERIOD_OVERLAP'
      using errcode = '23P01',
            detail = 'Paid periods in the same schedule must not overlap.';
  end if;

  return new;
end;
$$;

create trigger schedule_periods_no_overlap
  before insert or update on public.schedule_periods
  for each row execute function private.validate_schedule_period();

-- ---------------------------------------------------------------------------
-- Schedule assignments may not overlap in time for the same employee.
-- ---------------------------------------------------------------------------
create or replace function private.validate_schedule_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.schedule_assignments a
    where a.employee_id = new.employee_id
      and (tg_op = 'INSERT' or a.id <> new.id)
      and daterange(a.effective_from, coalesce(a.effective_to + 1, 'infinity'::date), '[)')
          && daterange(new.effective_from, coalesce(new.effective_to + 1, 'infinity'::date), '[)')
  ) then
    raise exception 'SCHEDULE_ASSIGNMENT_OVERLAP'
      using errcode = '23P01',
            detail = 'This schedule assignment overlaps an existing assignment.';
  end if;

  return new;
end;
$$;

create trigger schedule_assignments_no_overlap
  before insert or update on public.schedule_assignments
  for each row execute function private.validate_schedule_assignment();

-- ---------------------------------------------------------------------------
-- attendance_records — exactly one row per employee per work date.
-- Official totals are written by server-side RPCs only.
-- ---------------------------------------------------------------------------
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  work_date date not null,
  schedule_id uuid references public.work_schedules (id) on delete set null,
  first_time_in timestamptz,
  last_time_out timestamptz,
  worked_minutes integer not null default 0,
  late_minutes integer not null default 0,
  undertime_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  status public.attendance_status not null default 'present',
  remarks text,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_records_employee_day_unique unique (employee_id, work_date),
  constraint attendance_records_id_work_date_unique unique (id, work_date),
  constraint attendance_records_totals_nonnegative check (
    worked_minutes >= 0
    and late_minutes >= 0
    and undertime_minutes >= 0
    and overtime_minutes >= 0
  ),
  constraint attendance_records_time_order check (
    last_time_out is null
    or (first_time_in is not null and last_time_out >= first_time_in)
  ),
  constraint attendance_records_remarks_length check (
    remarks is null or char_length(remarks) <= 500
  )
);

create index attendance_records_employee_date_idx
  on public.attendance_records (employee_id, work_date desc);
create index attendance_records_date_status_idx
  on public.attendance_records (work_date, status);

create trigger attendance_records_set_updated_at
  before update on public.attendance_records
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- attendance_sessions — individual punch pairs. Multiple rows per day make
-- split shifts and overnight shifts first-class.
-- ---------------------------------------------------------------------------
create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  attendance_record_id uuid not null,
  employee_id uuid not null references public.employees (id) on delete restrict,
  work_date date not null,
  session_type public.session_type not null default 'custom',
  time_in timestamptz not null,
  time_out timestamptz,
  worked_minutes integer,
  is_open boolean generated always as (time_out is null) stored,
  source public.attendance_source not null default 'web',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_sessions_record_fk
    foreign key (attendance_record_id, work_date)
    references public.attendance_records (id, work_date)
    on delete cascade,
  constraint attendance_sessions_time_order check (time_out is null or time_out > time_in),
  constraint attendance_sessions_worked_nonnegative check (
    worked_minutes is null or worked_minutes >= 0
  )
);

-- The authoritative duplicate time-in guard: one open session per employee.
create unique index attendance_sessions_one_open_per_employee
  on public.attendance_sessions (employee_id)
  where time_out is null;

create index attendance_sessions_employee_date_idx
  on public.attendance_sessions (employee_id, work_date);
create index attendance_sessions_record_idx
  on public.attendance_sessions (attendance_record_id);

create or replace function private.validate_session_consistency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
  v_work_date date;
begin
  select r.employee_id, r.work_date
    into v_employee_id, v_work_date
  from public.attendance_records r
  where r.id = new.attendance_record_id;

  if not found then
    raise exception 'ATTENDANCE_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if new.employee_id <> v_employee_id or new.work_date <> v_work_date then
    raise exception 'ATTENDANCE_SESSION_MISMATCH'
      using errcode = '23514',
            detail = 'Session employee and work date must match its attendance record.';
  end if;

  if new.time_out is not null and new.time_out <= new.time_in then
    raise exception 'ATTENDANCE_TIME_ORDER' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger attendance_sessions_validate_consistency
  before insert or update on public.attendance_sessions
  for each row execute function private.validate_session_consistency();

-- Overlap prevention is belt-and-braces on top of the one-open-session index.
create or replace function private.prevent_session_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.attendance_sessions s
    where s.employee_id = new.employee_id
      and (tg_op = 'INSERT' or s.id <> new.id)
      and tstzrange(s.time_in, coalesce(s.time_out, 'infinity'::timestamptz), '[)')
          && tstzrange(new.time_in, coalesce(new.time_out, 'infinity'::timestamptz), '[)')
  ) then
    raise exception 'ATTENDANCE_SESSION_OVERLAP'
      using errcode = '23P01',
            detail = 'This punch overlaps another attendance session for the employee.';
  end if;

  return new;
end;
$$;

create trigger attendance_sessions_no_overlap
  before insert or update on public.attendance_sessions
  for each row execute function private.prevent_session_overlap();

create trigger attendance_sessions_set_updated_at
  before update on public.attendance_sessions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- attendance_corrections — requests, never silent overwrites.
-- ---------------------------------------------------------------------------
create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  attendance_record_id uuid references public.attendance_records (id) on delete set null,
  work_date date not null,
  correction_type public.correction_type not null,
  requested_time_in timestamptz,
  requested_time_out timestamptz,
  reason text not null,
  status public.correction_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  applied_at timestamptz,
  original_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_corrections_reason_length check (
    char_length(btrim(reason)) between 10 and 1000
  ),
  constraint attendance_corrections_has_requested_value check (
    requested_time_in is not null
    or requested_time_out is not null
    or correction_type = 'other'
  ),
  constraint attendance_corrections_time_order check (
    requested_time_out is null
    or requested_time_in is null
    or requested_time_out > requested_time_in
  ),
  constraint attendance_corrections_review_complete check (
    status not in ('approved', 'rejected')
    or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint attendance_corrections_rejection_reason check (
    status <> 'rejected'
    or (review_notes is not null and char_length(btrim(review_notes)) > 0)
  ),
  constraint attendance_corrections_notes_length check (
    review_notes is null or char_length(review_notes) <= 1000
  )
);

create unique index attendance_corrections_one_pending
  on public.attendance_corrections (employee_id, work_date, correction_type)
  where status = 'pending';

create index attendance_corrections_employee_idx
  on public.attendance_corrections (employee_id, created_at desc);
create index attendance_corrections_pending_idx
  on public.attendance_corrections (status, created_at desc);

create or replace function private.validate_correction_consistency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
  v_work_date date;
begin
  if new.attendance_record_id is not null then
    select r.employee_id, r.work_date
      into v_employee_id, v_work_date
    from public.attendance_records r
    where r.id = new.attendance_record_id;

    if not found then
      raise exception 'ATTENDANCE_RECORD_NOT_FOUND' using errcode = 'P0002';
    end if;

    if new.employee_id <> v_employee_id or new.work_date <> v_work_date then
      raise exception 'ATTENDANCE_CORRECTION_MISMATCH'
        using errcode = '23514',
              detail = 'Correction employee and work date must match the attendance record.';
    end if;
  end if;

  return new;
end;
$$;

create trigger attendance_corrections_validate_consistency
  before insert or update on public.attendance_corrections
  for each row execute function private.validate_correction_consistency();

create trigger attendance_corrections_set_updated_at
  before update on public.attendance_corrections
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs — append-only. No FK on actor_id so deleting an auth user can
-- never rewrite or erase history.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_role public.user_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_length check (char_length(btrim(action)) between 3 and 80),
  constraint audit_logs_entity_type_length check (
    char_length(btrim(entity_type)) between 2 and 60
  ),
  constraint audit_logs_summary_length check (
    summary is null or char_length(summary) <= 500
  )
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

create or replace function private.deny_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'AUDIT_LOG_IMMUTABLE'
    using errcode = '55000',
          detail = 'Audit entries are append-only.';
end;
$$;

create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function private.deny_audit_mutation();

commit;
