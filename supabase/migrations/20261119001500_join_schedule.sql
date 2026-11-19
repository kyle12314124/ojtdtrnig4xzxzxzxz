-- ===========================================================================
-- DTR Management System - Phase 10
-- Self-service schedule joining.
--
-- Students can see the active schedules their administrator published and
-- join one. Joining starts today: past DTR rows keep the schedule that was
-- in force on those days. An open time-in must be closed first.
-- ===========================================================================

begin;

create or replace function public.list_joinable_schedules()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_employee public.employees;
  v_result jsonb;
begin
  select * into v_employee
  from public.employees e
  where e.profile_id = v_uid
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'description', s.description,
        'timezone', s.timezone,
        'grace_minutes', s.grace_minutes,
        'work_days', s.work_days,
        'is_active', s.is_active,
        'is_mine', (v_employee.schedule_id is not null and v_employee.schedule_id = s.id),
        'assigned_count', (
          select count(*)
          from public.employees e
          where e.schedule_id = s.id
            and e.status <> 'archived'
        ),
        'periods', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', sp.id,
                'schedule_id', sp.schedule_id,
                'label', sp.label,
                'start_time', sp.start_time,
                'end_time', sp.end_time,
                'sort_order', sp.sort_order
              )
              order by sp.sort_order
            )
            from public.schedule_periods sp
            where sp.schedule_id = s.id
          ),
          '[]'::jsonb
        )
      )
      order by s.name
    ),
    '[]'::jsonb
  )
  into v_result
  from public.work_schedules s
  where s.is_active;

  return v_result;
end;
$$;

create or replace function public.join_work_schedule(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_employee public.employees;
  v_schedule public.work_schedules;
  v_existing public.schedule_assignments;
  v_today date;
begin
  select * into v_employee
  from public.employees e
  where e.profile_id = v_uid
  for update;

  if not found or v_employee.status <> 'active' then
    raise exception 'EMPLOYEE_NOT_ACTIVE' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.attendance_sessions
    where employee_id = v_employee.id and time_out is null
  ) then
    raise exception 'OPEN_SESSION_EXISTS'
      using errcode = '55000',
            detail = 'Time out before changing your work schedule.';
  end if;

  select * into v_schedule
  from public.work_schedules s
  where s.id = p_schedule_id;

  if not found then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_schedule.is_active then
    raise exception 'SCHEDULE_INACTIVE'
      using errcode = '55000',
            detail = 'That schedule is no longer available.';
  end if;

  v_today := (now() at time zone v_schedule.timezone)::date;

  if v_employee.schedule_id = p_schedule_id then
    return jsonb_build_object(
      'changed', false,
      'schedule_id', v_schedule.id,
      'name', v_schedule.name,
      'effective_from', v_today
    );
  end if;

  select * into v_existing
  from public.schedule_assignments a
  where a.employee_id = v_employee.id
    and a.effective_to is null
  order by a.effective_from desc
  limit 1;

  if v_existing.id is not null then
    if v_existing.effective_from >= v_today then
      delete from public.schedule_assignments where id = v_existing.id;
    else
      update public.schedule_assignments
         set effective_to = v_today - 1
       where id = v_existing.id;
    end if;
  end if;

  insert into public.schedule_assignments (
    employee_id, schedule_id, effective_from, assigned_by
  )
  values (v_employee.id, v_schedule.id, v_today, v_uid);

  update public.employees
     set schedule_id = v_schedule.id
   where id = v_employee.id;

  perform private.log_audit(
    'schedule.joined',
    'employee',
    v_employee.id::text,
    format('Joined schedule "%s"', v_schedule.name),
    jsonb_build_object('schedule_id', v_employee.schedule_id),
    jsonb_build_object('schedule_id', v_schedule.id, 'effective_from', v_today)
  );

  return jsonb_build_object(
    'changed', true,
    'schedule_id', v_schedule.id,
    'name', v_schedule.name,
    'effective_from', v_today
  );
end;
$$;

revoke all on function public.list_joinable_schedules() from public;
revoke all on function public.join_work_schedule(uuid) from public;
grant execute on function public.list_joinable_schedules() to authenticated;
grant execute on function public.join_work_schedule(uuid) to authenticated;

commit;
