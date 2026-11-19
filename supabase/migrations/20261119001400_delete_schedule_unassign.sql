-- ===========================================================================
-- DTR Management System - Phase 10
-- Delete a work schedule, optionally unassigning the employees on it.
--
-- Guards:
--   * a schedule with attendance history can never be deleted, because past
--     DTR rows and reports reference it;
--   * a schedule still assigned to employees is refused unless the caller
--     explicitly passes p_unassign = true.
-- ===========================================================================

begin;

drop function if exists public.delete_work_schedule(uuid);
drop function if exists public.delete_work_schedule(uuid, boolean);

create or replace function public.delete_work_schedule(
  p_schedule_id uuid,
  p_unassign boolean default false
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

  if v_attendance > 0 then
    raise exception 'SCHEDULE_HAS_ATTENDANCE'
      using errcode = '23503',
            detail = 'Attendance was recorded against this schedule.';
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
      'Schedule "%s" deleted (%s employee(s) unassigned)',
      v_schedule.name,
      v_unassigned
    ),
    jsonb_build_object(
      'name', v_schedule.name,
      'description', v_schedule.description,
      'grace_minutes', v_schedule.grace_minutes,
      'work_days', v_schedule.work_days,
      'is_active', v_schedule.is_active
    ),
    null
  );

  return jsonb_build_object(
    'deleted', true,
    'id', v_schedule.id,
    'name', v_schedule.name,
    'unassigned_employees', v_unassigned
  );
end;
$$;

revoke all on function public.delete_work_schedule(uuid, boolean) from public;
grant execute on function public.delete_work_schedule(uuid, boolean) to authenticated;

commit;
