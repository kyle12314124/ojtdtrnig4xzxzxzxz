-- ===========================================================================
-- DTR Management System — Phase 3b
-- Optional automatic approval for OJT registrations.
--
-- When enabled, a student who submits their OJT profile is activated
-- immediately instead of waiting in the administrator queue. The setting is
-- stored in the database (not the browser) so it applies to every device and
-- is audited whenever it changes.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  auto_approve_onboarding boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.app_settings (id) values (1) on conflict do nothing;

alter table public.app_settings enable row level security;

-- No API role reads or writes this table directly: both RPCs below are
-- SECURITY DEFINER and perform their own authorization checks.

-- ---------------------------------------------------------------------------
-- Read the setting (administrators only)
-- ---------------------------------------------------------------------------
create or replace function public.get_onboarding_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN'
      using errcode = '42501',
            detail = 'Only administrators can read approval settings.';
  end if;

  return (
    select jsonb_build_object(
      'auto_approve_onboarding', s.auto_approve_onboarding,
      'updated_at', s.updated_at,
      'updated_by', s.updated_by,
      'pending_count', (
        select count(*)
        from public.employees e
        where e.approved_at is null
          and e.status = 'inactive'
      )
    )
    from public.app_settings s
    where s.id = 1
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Change the setting (administrators only)
-- ---------------------------------------------------------------------------
create or replace function public.set_auto_approve(
  p_enabled boolean,
  p_apply_pending boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_before boolean;
  v_approved integer := 0;
  v_employee public.employees;
begin
  if p_enabled is null then
    raise exception 'INVALID_SETTING' using errcode = '22023';
  end if;

  select s.auto_approve_onboarding
    into v_before
  from public.app_settings s
  where s.id = 1
  for update;

  update public.app_settings
     set auto_approve_onboarding = p_enabled,
         updated_at = now(),
         updated_by = v_uid
   where id = 1;

  if p_enabled and coalesce(p_apply_pending, false) then
    for v_employee in
      select *
      from public.employees e
      where e.approved_at is null
        and e.status = 'inactive'
      for update
    loop
      update public.employees
         set status = 'active',
             approved_at = now(),
             approved_by = v_uid,
             archived_at = null
       where id = v_employee.id;

      update public.profiles
         set is_active = true
       where id = v_employee.profile_id;

      perform private.log_audit(
        'employee.onboarding_approved',
        'employee',
        v_employee.id::text,
        'Approved when automatic approval was enabled',
        to_jsonb(v_employee),
        jsonb_build_object('status', 'active', 'approved_by', v_uid, 'automatic', true)
      );

      v_approved := v_approved + 1;
    end loop;
  end if;

  perform private.log_audit(
    'settings.auto_approve',
    'app_settings',
    '1',
    case
      when p_enabled then 'Automatic OJT approval enabled'
      else 'Automatic OJT approval disabled'
    end,
    jsonb_build_object('auto_approve_onboarding', v_before),
    jsonb_build_object(
      'auto_approve_onboarding', p_enabled,
      'approved_pending', v_approved
    )
  );

  return jsonb_build_object(
    'auto_approve_onboarding', p_enabled,
    'approved_pending', v_approved
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_onboarding now honours the setting
-- ---------------------------------------------------------------------------
create or replace function public.complete_onboarding(
  p_employee_no text,
  p_first_name text,
  p_last_name text,
  p_middle_name text default null,
  p_position text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_profile public.profiles;
  v_employee public.employees;
  v_schedule uuid;
  v_schedule_name text;
  v_auto boolean := false;
  v_no text := upper(btrim(coalesce(p_employee_no, '')));
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
  v_middle text := nullif(btrim(coalesce(p_middle_name, '')), '');
  v_position text := nullif(btrim(coalesce(p_position, '')), '');
begin
  select * into v_profile from public.profiles p where p.id = v_uid;

  if v_profile.role <> 'employee' then
    raise exception 'FORBIDDEN'
      using errcode = '42501',
            detail = 'Only employee accounts complete onboarding.';
  end if;

  if exists (select 1 from public.employees e where e.profile_id = v_uid) then
    raise exception 'ALREADY_ONBOARDED'
      using errcode = '23505',
            detail = 'This account already has an employee record.';
  end if;

  if v_no !~ '^[A-Z0-9-]{3,20}$' then
    raise exception 'EMPLOYEE_NO_INVALID'
      using errcode = '22023',
            detail = 'Use 3–20 letters, digits, or dashes.';
  end if;

  if char_length(v_first) not between 1 and 60 then
    raise exception 'FIRST_NAME_INVALID' using errcode = '22023';
  end if;

  if char_length(v_last) not between 1 and 60 then
    raise exception 'LAST_NAME_INVALID' using errcode = '22023';
  end if;

  if v_middle is not null and char_length(v_middle) > 60 then
    raise exception 'MIDDLE_NAME_INVALID' using errcode = '22023';
  end if;

  if v_position is not null and char_length(v_position) > 80 then
    raise exception 'POSITION_INVALID' using errcode = '22023';
  end if;

  if exists (select 1 from public.employees e where e.employee_no = v_no) then
    raise exception 'EMPLOYEE_NO_TAKEN'
      using errcode = '23505',
            detail = 'That employee/student number is already registered.';
  end if;

  -- OJT convenience: auto-assign the first active schedule. Administrators
  -- can change it later from Employee Management.
  select s.id, s.name
    into v_schedule, v_schedule_name
  from public.work_schedules s
  where s.is_active
  order by s.created_at asc
  limit 1;

  select coalesce(s.auto_approve_onboarding, false)
    into v_auto
  from public.app_settings s
  where s.id = 1;

  v_auto := coalesce(v_auto, false);

  insert into public.employees (
    profile_id, employee_no, first_name, middle_name, last_name, email,
    position, employment_type, date_hired, schedule_id, status, approved_at
  )
  values (
    v_uid, v_no, v_first, v_middle, v_last, v_profile.email,
    v_position, 'intern', current_date, v_schedule,
    case
      when v_auto then 'active'::public.account_status
      else 'inactive'::public.account_status
    end,
    case when v_auto then now() else null end
  )
  returning * into v_employee;

  update public.profiles p
     set full_name = concat_ws(' ', v_first, v_middle, v_last)
   where p.id = v_uid;

  perform private.log_audit(
    case
      when v_auto then 'employee.onboarding_auto_approved'
      else 'employee.onboarding_submitted'
    end,
    'employee',
    v_employee.id::text,
    case
      when v_auto then 'OJT profile submitted and automatically approved'
      else 'OJT profile submitted for administrator approval'
    end,
    null,
    to_jsonb(v_employee)
  );

  return jsonb_build_object(
    'employee_id', v_employee.id,
    'employee_no', v_employee.employee_no,
    'status', v_employee.status,
    'approved_at', v_employee.approved_at,
    'auto_approved', v_auto,
    'schedule_id', v_schedule,
    'schedule_name', v_schedule_name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.get_onboarding_settings() from public;
revoke all on function public.set_auto_approve(boolean, boolean) from public;

grant execute on function public.get_onboarding_settings() to authenticated;
grant execute on function public.set_auto_approve(boolean, boolean) to authenticated;

commit;
