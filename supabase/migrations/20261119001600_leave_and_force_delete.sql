-- ===========================================================================
-- DTR Management System - Phase 10
-- Leave a schedule, and give administrators a deliberate force-delete.
--
-- Students can leave their schedule at any time (except with an open punch).
-- Administrators can force-delete a schedule that already has attendance.
-- Attendance rows are never erased: their schedule link is detached and the
-- action is audited with the number of affected days.
-- ===========================================================================

begin;

create or replace function public.leave_work_schedule()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_employee public.employees;
  v_schedule public.work_schedules;
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
            detail = 'Time out before leaving your work schedule.';
  end if;

  if v_employee.schedule_id is null then
    return jsonb_build_object('changed', false);
  end if;

  select * into v_schedule
  from public.work_schedules s
  where s.id = v_employee.schedule_id;

  v_today := (now() at time zone coalesce(v_schedule.timezone, 'Asia/Manila'))::date;

  update public.schedule_assignments a
     set effective_to = v_today - 1
   where a.employee_id = v_employee.id
     and a.effective_to is null
     and a.effective_from < v_today;

  delete from public.schedule_assignments a
   where a.employee_id = v_employee.id
     and a.effective_to is null
     and a.effective_from >= v_today;

  update public.employees
     set schedule_id = null
   where id = v_employee.id;

  perform private.log_audit(
    'schedule.left',
    'employee',
    v_employee.id::text,
    format('Left schedule "%s"', coalesce(v_schedule.name, 'Unknown')),
    jsonb_build_object('schedule_id', v_employee.schedule_id),
    jsonb_build_object('schedule_id', null)
  );

  return jsonb_build_object(
    'changed', true,
    'schedule_id', v_employee.schedule_id,
    'name', v_schedule.name
  );
end;
$$;

create or replace function public.list_work_schedules()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform private.require_authenticated();

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
        'periods', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', sp.id,
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
        ),
        'assigned_count', (
          select count(*)
          from public.employees e
          where e.schedule_id = s.id
            and e.status <> 'archived'
        ),
        'attendance_days', (
          select count(*)
          from public.attendance_records a
          where a.schedule_id = s.id
        )
      )
      order by s.created_at
    ),
    '[]'::jsonb
  )
  into v_result
  from public.work_schedules s;

  return v_result;
end;
$$;

drop function if exists public.delete_work_schedule(uuid);
drop function if exists public.delete_work_schedule(uuid, boolean);
drop function if exists public.delete_work_schedule(uuid, boolean, boolean);

create or replace function public.delete_work_schedule(
  p_schedule_id uuid,
  p_unassign boolean default false,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule public.work_schedules;
  v_assigned integer;
  v_unassigned integer := 0;
  v_attendance integer;
begin
  perform private.require_role(array['admin']::public.user_role[]);

  select * into v_schedule
  from public.work_schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*) into v_assigned
  from public.employees e
  where e.schedule_id = p_schedule_id
    and e.status <> 'archived';

  if v_assigned > 0 and not coalesce(p_unassign, false) then
    raise exception 'SCHEDULE_ASSIGNED'
      using errcode = '23503',
            detail = format('%s employee(s) still use this schedule.', v_assigned);
  end if;

  select count(*) into v_attendance
  from public.attendance_records a
  where a.schedule_id = p_schedule_id;

  if v_attendance > 0 and not coalesce(p_force, false) then
    raise exception 'SCHEDULE_HAS_ATTENDANCE'
      using errcode = '23503',
            detail = format('%s attendance day(s) reference this schedule.', v_attendance);
  end if;

  if v_assigned > 0 then
    with cleared as (
      update public.employees e
         set schedule_id = null
       where e.schedule_id = p_schedule_id
      returning e.id
    )
    select count(*) into v_unassigned from cleared;
  end if;

  delete from public.schedule_assignments a
  where a.schedule_id = p_schedule_id;

  delete from public.work_schedules s
  where s.id = p_schedule_id;

  perform private.log_audit(
    'schedule.deleted',
    'work_schedule',
    p_schedule_id::text,
    format(
      'Schedule "%s" deleted (%s unassigned, %s attendance day(s) detached)',
      v_schedule.name,
      v_unassigned,
      v_attendance
    ),
    jsonb_build_object(
      'name', v_schedule.name,
      'description', v_schedule.description,
      'grace_minutes', v_schedule.grace_minutes,
      'work_days', v_schedule.work_days,
      'is_active', v_schedule.is_active,
      'attendance_days', v_attendance
    ),
    jsonb_build_object('forced', coalesce(p_force, false))
  );

  return jsonb_build_object(
    'deleted', true,
    'id', v_schedule.id,
    'name', v_schedule.name,
    'unassigned_employees', v_unassigned,
    'detached_attendance_days', v_attendance
  );
end;
$$;

revoke all on function public.leave_work_schedule() from public;
revoke all on function public.delete_work_schedule(uuid, boolean, boolean) from public;
grant execute on function public.leave_work_schedule() to authenticated;
grant execute on function public.delete_work_schedule(uuid, boolean, boolean) to authenticated;

commit;
