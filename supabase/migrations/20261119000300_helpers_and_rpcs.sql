-- ===========================================================================
-- DTR Management System — Phase 2, migration 3 of 4
-- Authorization helpers and the foundational RPCs used by the client:
--   * get_my_context()  — profile, employee, schedule, open session
--   * health_check()    — authenticated connectivity check
-- Attendance/report RPCs arrive in Phases 6–9 and build on these helpers.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Caller context helpers. SECURITY DEFINER so policies never recurse through
-- profiles' own RLS. Each function is stable within a statement.
-- ---------------------------------------------------------------------------
create or replace function private.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.* from public.profiles p where p.id = auth.uid();
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active
  );
$$;

create or replace function private.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id
  from public.employees e
  where e.profile_id = auth.uid()
    and e.status = 'active'
  limit 1;
$$;

create or replace function private.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'supervisor'
      and p.is_active
  );
$$;

/**
 * Row-level authorization predicate used by RLS policies:
 * admins see everyone, employees see themselves, supervisors see their
 * directly assigned team members plus themselves.
 */
create or replace function private.can_view_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    private.is_admin()
    or exists (
      select 1
      from public.employees e
      where e.id = p_employee_id
        and (
          e.profile_id = auth.uid()
          or (
            private.is_supervisor()
            and e.supervisor_id = private.current_employee_id()
          )
        )
    );
$$;

/** Require a signed-in, active account. Returns the caller's profile id. */
create or replace function private.require_authenticated()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED'
      using errcode = '28000',
            detail = 'Sign in to continue.';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = v_uid and p.is_active
  ) then
    raise exception 'ACCOUNT_INACTIVE'
      using errcode = '28000',
            detail = 'This account is not active.';
  end if;

  return v_uid;
end;
$$;

/** Require one of the given roles on an active account. */
create or replace function private.require_role(p_roles public.user_role[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_role public.user_role;
begin
  select p.role into v_role from public.profiles p where p.id = v_uid;

  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'FORBIDDEN'
      using errcode = '42501',
            detail = 'Your role is not allowed to perform this action.';
  end if;

  return v_uid;
end;
$$;

/**
 * Resolve the schedule effective for an employee on a given work date.
 * Historical assignments win; employees.schedule_id is the fallback/pointer.
 */
create or replace function private.resolve_schedule(
  p_employee_id uuid,
  p_work_date date
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select a.schedule_id
      from public.schedule_assignments a
      where a.employee_id = p_employee_id
        and a.effective_from <= p_work_date
        and (a.effective_to is null or a.effective_to >= p_work_date)
      order by a.effective_from desc
      limit 1
    ),
    (select e.schedule_id from public.employees e where e.id = p_employee_id)
  );
$$;

/**
 * Append an audit entry. Always called inside the same transaction as the
 * change it describes. Never accepts client-supplied actor identity.
 */
create or replace function private.log_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_summary text default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_uid uuid := auth.uid();
  v_role public.user_role;
begin
  select p.role into v_role from public.profiles p where p.id = v_uid;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id,
    summary, before_data, after_data
  )
  values (
    v_uid, v_role, p_action, p_entity_type, p_entity_id,
    p_summary, p_before, p_after
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

/** Authenticated connectivity/diagnostic probe (no sensitive data). */
create or replace function public.health_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  v_uid := private.require_authenticated();

  return jsonb_build_object(
    'ok', true,
    'server_time', now(),
    'database', current_database(),
    'version', current_setting('server_version'),
    'caller', v_uid
  );
end;
$$;

/**
 * One round-trip bootstrap for the signed-in user. Replaces the Phase 1
 * direct profiles select and returns the employee/current schedule context.
 */
create or replace function public.get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile jsonb;
  v_employee jsonb;
  v_open_session jsonb;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select to_jsonb(p) into v_profile
  from public.profiles p
  where p.id = v_uid;

  if v_profile is null then
    raise exception 'PROFILE_NOT_FOUND'
      using errcode = 'P0002',
            detail = 'No profile is linked to this account.';
  end if;

  select jsonb_build_object(
    'id', e.id,
    'employee_no', e.employee_no,
    'first_name', e.first_name,
    'middle_name', e.middle_name,
    'last_name', e.last_name,
    'email', e.email,
    'position', e.position,
    'employment_type', e.employment_type,
    'date_hired', e.date_hired,
    'status', e.status,
    'department', case
      when d.id is null then null
      else jsonb_build_object('id', d.id, 'name', d.name, 'code', d.code)
    end,
    'schedule', case
      when s.id is null then null
      else jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'timezone', s.timezone,
        'grace_minutes', s.grace_minutes,
        'work_days', s.work_days,
        'periods', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', sp.id,
                'label', sp.label,
                'start_time', sp.start_time,
                'end_time', sp.end_time,
                'sort_order', sp.sort_order
              )
              order by sp.sort_order
            ),
            '[]'::jsonb
          )
          from public.schedule_periods sp
          where sp.schedule_id = s.id
        )
      )
    end
  )
  into v_employee
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.work_schedules s on s.id = e.schedule_id
  where e.profile_id = v_uid
    and e.status <> 'archived';

  if v_employee is not null then
    select to_jsonb(sess) into v_open_session
    from public.attendance_sessions sess
    where sess.employee_id = (v_employee ->> 'id')::uuid
      and sess.time_out is null
    limit 1;
  end if;

  return jsonb_build_object(
    'profile', v_profile,
    'employee', v_employee,
    'open_session', v_open_session,
    'server_time', now()
  );
end;
$$;

commit;
