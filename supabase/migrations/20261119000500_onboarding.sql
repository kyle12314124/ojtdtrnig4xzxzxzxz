-- ===========================================================================
-- DTR Management System — Phase 3
-- Self-registration onboarding and administrator approval.
--
-- Flow: auth sign-up creates a profile → the student submits their OJT
-- details → an employee row is created in `inactive` state with
-- `approved_at = null` → an administrator approves it → timekeeping unlocks.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Approval metadata
-- Existing and administrator-created employees are considered approved by
-- default. Self-onboarding explicitly inserts NULL so it appears in the queue.
-- ---------------------------------------------------------------------------
alter table public.employees
  add column approved_at timestamptz default now();

alter table public.employees
  add column approved_by uuid references public.profiles (id) on delete set null;

update public.employees
   set approved_at = now()
 where approved_at is null;

alter table public.employees
  add constraint employees_active_approved
  check (status <> 'active' or approved_at is not null);

create index employees_pending_onboarding_idx
  on public.employees (created_at)
  where approved_at is null and status = 'inactive';

-- ---------------------------------------------------------------------------
-- get_my_context now exposes approval state so the client can route a user to
-- onboarding, the waiting screen, or the workspace.
-- ---------------------------------------------------------------------------
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
    'approved_at', e.approved_at,
    'approved_by', e.approved_by,
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

-- ---------------------------------------------------------------------------
-- Self-onboarding
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
  v_no text := upper(btrim(coalesce(p_employee_no, '')));
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
  v_middle text := nullif(btrim(coalesce(p_middle_name, '')), '');
  v_position text := nullif(btrim(coalesce(p_position, '')), '');
  v_schedule_name text;
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

  insert into public.employees (
    profile_id, employee_no, first_name, middle_name, last_name, email,
    position, employment_type, date_hired, schedule_id, status, approved_at
  )
  values (
    v_uid, v_no, v_first, v_middle, v_last, v_profile.email,
    v_position, 'intern', current_date, v_schedule, 'inactive', null
  )
  returning * into v_employee;

  update public.profiles p
     set full_name = concat_ws(' ', v_first, v_middle, v_last)
   where p.id = v_uid;

  perform private.log_audit(
    'employee.onboarding_submitted',
    'employee',
    v_employee.id::text,
    'OJT profile submitted for administrator approval',
    null,
    to_jsonb(v_employee)
  );

  return jsonb_build_object(
    'employee_id', v_employee.id,
    'employee_no', v_employee.employee_no,
    'status', v_employee.status,
    'approved_at', v_employee.approved_at,
    'schedule_id', v_schedule,
    'schedule_name', v_schedule_name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrator approval queue
-- ---------------------------------------------------------------------------
create or replace function public.list_onboarding_requests()
returns table (
  employee_id uuid,
  employee_no text,
  full_name text,
  email text,
  "position" text,
  submitted_at timestamptz,
  schedule_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN'
      using errcode = '42501',
            detail = 'Only administrators can review onboarding requests.';
  end if;

  return query
    select
      e.id,
      e.employee_no,
      p.full_name,
      e.email,
      e.position,
      e.created_at,
      s.name
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    left join public.work_schedules s on s.id = e.schedule_id
    where e.approved_at is null
      and e.status = 'inactive'
    order by e.created_at asc;
end;
$$;

create or replace function public.review_onboarding(
  p_employee_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_employee public.employees;
  v_schedule uuid;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select * into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_employee.approved_at is not null then
    raise exception 'ALREADY_REVIEWED'
      using errcode = '55000',
            detail = 'This onboarding request has already been reviewed.';
  end if;

  if v_employee.status <> 'inactive' then
    raise exception 'INVALID_STATE'
      using errcode = '55000',
            detail = 'Only pending accounts can be reviewed.';
  end if;

  if p_approve then
    if v_employee.schedule_id is null then
      select s.id into v_schedule
      from public.work_schedules s
      where s.is_active
      order by s.created_at asc
      limit 1;
    end if;

    update public.employees
       set status = 'active',
           approved_at = now(),
           approved_by = v_uid,
           schedule_id = coalesce(schedule_id, v_schedule),
           archived_at = null
     where id = p_employee_id;

    update public.profiles
       set is_active = true
     where id = v_employee.profile_id;

    perform private.log_audit(
      'employee.onboarding_approved',
      'employee',
      p_employee_id::text,
      'OJT account approved by administrator',
      to_jsonb(v_employee),
      jsonb_build_object('status', 'active', 'approved_by', v_uid, 'notes', v_notes)
    );

    return jsonb_build_object(
      'employee_id', p_employee_id,
      'status', 'active',
      'approved', true
    );
  end if;

  if v_notes is null or char_length(v_notes) < 5 then
    raise exception 'REJECTION_REASON_REQUIRED'
      using errcode = '22023',
            detail = 'Provide a short reason when rejecting an account.';
  end if;

  update public.employees
     set status = 'archived',
         archived_at = now(),
         approved_by = v_uid
   where id = p_employee_id;

  update public.profiles
     set is_active = false
   where id = v_employee.profile_id;

  perform private.log_audit(
    'employee.onboarding_rejected',
    'employee',
    p_employee_id::text,
    format('OJT account rejected: %s', v_notes),
    to_jsonb(v_employee),
    jsonb_build_object('status', 'archived', 'approved_by', v_uid, 'notes', v_notes)
  );

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'status', 'archived',
    'approved', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.get_my_context() from public;
revoke all on function public.complete_onboarding(text, text, text, text, text) from public;
revoke all on function public.list_onboarding_requests() from public;
revoke all on function public.review_onboarding(uuid, boolean, text) from public;

grant execute on function public.get_my_context() to authenticated;
grant execute on function public.complete_onboarding(text, text, text, text, text) to authenticated;
grant execute on function public.list_onboarding_requests() to authenticated;
grant execute on function public.review_onboarding(uuid, boolean, text) to authenticated;

commit;
