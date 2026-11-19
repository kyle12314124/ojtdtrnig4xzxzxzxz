-- ===========================================================================
-- DTR Management System — Phase 2, migration 1 of 4
-- Core HR schema: enums, profiles, departments, schedules, employees,
-- schedule assignments, holidays. No attendance data lives here yet.
-- ===========================================================================

begin;

create schema if not exists private;

-- Private helpers are not callable by API roles until explicitly granted.
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'supervisor', 'employee');
create type public.account_status as enum ('active', 'inactive', 'archived');
create type public.employment_type as enum (
  'regular', 'probationary', 'contractual', 'part_time', 'intern'
);
create type public.attendance_status as enum (
  'present', 'late', 'absent', 'on_leave', 'holiday', 'rest_day'
);
create type public.session_type as enum ('morning', 'afternoon', 'evening', 'custom');
create type public.attendance_source as enum ('web', 'manual', 'correction');
create type public.correction_type as enum (
  'missing_time_in', 'missing_time_out', 'incorrect_time', 'other'
);
create type public.correction_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.holiday_type as enum ('regular', 'special_non_working', 'special_working');

-- ---------------------------------------------------------------------------
-- Generic trigger helpers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Profiles and employees both carry an email that must be compared
-- case-insensitively. Departments use an uppercase code.
create or replace function private.normalize_identity_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Branch only on tg_table_name: referencing a column that a different
  -- table does not have would fail during expression planning.
  if tg_table_name in ('profiles', 'employees') then
    if new.email is not null then
      new.email := lower(btrim(new.email));
    end if;
  end if;

  if tg_table_name = 'departments' then
    new.code := upper(btrim(new.code));
  end if;

  if tg_table_name = 'employees' then
    new.employee_no := upper(btrim(new.employee_no));
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'employee',
  full_name text not null,
  email text not null,
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(btrim(full_name)) between 2 and 120),
  constraint profiles_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  constraint profiles_phone_length check (phone is null or char_length(btrim(phone)) between 7 and 24)
);

create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_active_idx on public.profiles (role, is_active);

create trigger profiles_normalize_fields
  before insert or update on public.profiles
  for each row execute function private.normalize_identity_fields();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- A new auth user always becomes an active employee-role profile. Role is
-- never taken from client-controlled metadata; promotion happens through a
-- privileged, audited operation.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_full_name text;
begin
  if new.email is null then
    return new;
  end if;

  v_full_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');

  insert into public.profiles (id, role, full_name, email)
  values (
    new.id,
    'employee',
    coalesce(v_full_name, split_part(lower(new.email), '@', 1)),
    lower(new.email)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_name_length check (char_length(btrim(name)) between 2 and 80),
  constraint departments_code_format check (code ~ '^[A-Z0-9-]{2,12}$'),
  constraint departments_description_length check (
    description is null or char_length(description) <= 500
  )
);

create unique index departments_name_key on public.departments (lower(btrim(name)));
create unique index departments_code_key on public.departments (code);

create trigger departments_normalize_fields
  before insert or update on public.departments
  for each row execute function private.normalize_identity_fields();

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- work schedules and their paid periods
-- Gaps between periods are unpaid breaks. A period may cross midnight.
-- ---------------------------------------------------------------------------
create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  timezone text not null default 'Asia/Manila',
  grace_minutes smallint not null default 0,
  work_days smallint[] not null default '{1,2,3,4,5}'::smallint[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_schedules_name_length check (char_length(btrim(name)) between 2 and 80),
  constraint work_schedules_timezone_present check (char_length(btrim(timezone)) between 1 and 64),
  constraint work_schedules_grace_range check (grace_minutes between 0 and 120),
  constraint work_schedules_work_days_valid check (
    cardinality(work_days) > 0
    and work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  constraint work_schedules_description_length check (
    description is null or char_length(description) <= 500
  )
);

create unique index work_schedules_name_key on public.work_schedules (lower(btrim(name)));

create trigger work_schedules_set_updated_at
  before update on public.work_schedules
  for each row execute function private.set_updated_at();

create table public.schedule_periods (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.work_schedules (id) on delete cascade,
  label text not null,
  start_time time not null,
  end_time time not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint schedule_periods_label_length check (char_length(btrim(label)) between 1 and 30),
  constraint schedule_periods_distinct_times check (start_time <> end_time),
  constraint schedule_periods_unique_label unique (schedule_id, label)
);

create index schedule_periods_schedule_idx
  on public.schedule_periods (schedule_id, sort_order);

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete restrict,
  employee_no text not null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  email text not null,
  department_id uuid references public.departments (id) on delete set null,
  position text,
  employment_type public.employment_type not null default 'regular',
  date_hired date not null default current_date,
  schedule_id uuid references public.work_schedules (id) on delete set null,
  supervisor_id uuid references public.employees (id) on delete set null,
  status public.account_status not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_no_format check (employee_no ~ '^[A-Z0-9-]{3,20}$'),
  constraint employees_first_name_length check (char_length(btrim(first_name)) between 1 and 60),
  constraint employees_last_name_length check (char_length(btrim(last_name)) between 1 and 60),
  constraint employees_middle_name_length check (
    middle_name is null or char_length(btrim(middle_name)) <= 60
  ),
  constraint employees_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  constraint employees_position_length check (
    position is null or char_length(btrim(position)) between 1 and 80
  ),
  constraint employees_not_own_supervisor check (supervisor_id is distinct from id),
  constraint employees_archive_consistency check (
    (status = 'archived') = (archived_at is not null)
  )
);

create unique index employees_no_key on public.employees (employee_no);
create unique index employees_email_key on public.employees (lower(email));
create index employees_department_idx on public.employees (department_id);
create index employees_status_idx on public.employees (status);
create index employees_schedule_idx on public.employees (schedule_id);
create index employees_supervisor_idx on public.employees (supervisor_id);
create index employees_last_name_idx on public.employees (lower(last_name), lower(first_name));

create trigger employees_normalize_fields
  before insert or update on public.employees
  for each row execute function private.normalize_identity_fields();

create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- schedule_assignments: historical source of truth for "which schedule was
-- effective on this work date". employees.schedule_id is a display cache.
-- ---------------------------------------------------------------------------
create table public.schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  schedule_id uuid not null references public.work_schedules (id) on delete restrict,
  effective_from date not null default current_date,
  effective_to date,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint schedule_assignments_range_order check (
    effective_to is null or effective_to >= effective_from
  )
);

create index schedule_assignments_employee_idx
  on public.schedule_assignments (employee_id, effective_from desc);

-- ---------------------------------------------------------------------------
-- holidays
-- ---------------------------------------------------------------------------
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  holiday_date date not null,
  holiday_type public.holiday_type not null default 'regular',
  is_paid boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holidays_name_length check (char_length(btrim(name)) between 2 and 100),
  constraint holidays_unique_day_name unique (holiday_date, name)
);

create index holidays_date_idx on public.holidays (holiday_date);

create trigger holidays_set_updated_at
  before update on public.holidays
  for each row execute function private.set_updated_at();

commit;
