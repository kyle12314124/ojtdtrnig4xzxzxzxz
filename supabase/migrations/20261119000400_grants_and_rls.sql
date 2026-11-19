-- ===========================================================================
-- DTR Management System — Phase 2, migration 4 of 4
-- Grants and Row Level Security. Read access is scoped to self / supervised
-- team / admin. No API role may write HR or attendance tables directly:
-- every mutation goes through validated, audited RPCs (Phases 5–9).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Profile visibility helper (kept definer so it never recurses through the
-- profiles policy it supports).
-- ---------------------------------------------------------------------------
create or replace function private.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    private.is_admin()
    or p_profile_id = auth.uid()
    or exists (
      select 1
      from public.employees e
      where e.profile_id = p_profile_id
        and private.can_view_employee(e.id)
    );
$$;

-- ---------------------------------------------------------------------------
-- Remove inherited/default access, then grant the minimum surface.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select on
  public.profiles,
  public.employees,
  public.departments,
  public.work_schedules,
  public.schedule_periods,
  public.schedule_assignments,
  public.attendance_records,
  public.attendance_sessions,
  public.attendance_corrections,
  public.holidays,
  public.audit_logs
to authenticated;

-- Employees may correct only their own contact details. Role, status, and
-- employment fields are intentionally not updatable by the API role.
grant update (phone, avatar_url) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.departments enable row level security;
alter table public.work_schedules enable row level security;
alter table public.schedule_periods enable row level security;
alter table public.schedule_assignments enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.holidays enable row level security;
alter table public.audit_logs enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select_scoped
  on public.profiles for select
  to authenticated
  using (private.can_view_profile(id));

create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using (id = auth.uid() and is_active)
  with check (id = auth.uid() and is_active);

-- employees -----------------------------------------------------------------
create policy employees_select_scoped
  on public.employees for select
  to authenticated
  using (private.can_view_employee(id));

-- departments ---------------------------------------------------------------
create policy departments_select_active_or_admin
  on public.departments for select
  to authenticated
  using (is_active or private.is_admin());

-- work schedules ------------------------------------------------------------
create policy work_schedules_select_active_or_admin
  on public.work_schedules for select
  to authenticated
  using (is_active or private.is_admin());

create policy schedule_periods_select_scoped
  on public.schedule_periods for select
  to authenticated
  using (
    private.is_admin()
    or exists (
      select 1
      from public.work_schedules s
      where s.id = schedule_periods.schedule_id
        and s.is_active
    )
  );

create policy schedule_assignments_select_scoped
  on public.schedule_assignments for select
  to authenticated
  using (private.can_view_employee(employee_id));

-- attendance ----------------------------------------------------------------
create policy attendance_records_select_scoped
  on public.attendance_records for select
  to authenticated
  using (private.can_view_employee(employee_id));

create policy attendance_sessions_select_scoped
  on public.attendance_sessions for select
  to authenticated
  using (private.can_view_employee(employee_id));

create policy attendance_corrections_select_scoped
  on public.attendance_corrections for select
  to authenticated
  using (private.can_view_employee(employee_id));

-- holidays are organization-wide reference data -----------------------------
create policy holidays_select_authenticated
  on public.holidays for select
  to authenticated
  using (true);

-- audit log: administrators only --------------------------------------------
create policy audit_logs_select_admin
  on public.audit_logs for select
  to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- Function execution grants
-- ---------------------------------------------------------------------------
revoke all on all functions in schema private from public;

grant usage on schema private to authenticated;

grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_supervisor() to authenticated;
grant execute on function private.current_employee_id() to authenticated;
grant execute on function private.can_view_employee(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;

revoke all on function public.health_check() from public;
revoke all on function public.get_my_context() from public;

grant execute on function public.health_check() to authenticated;
grant execute on function public.get_my_context() to authenticated;

commit;
