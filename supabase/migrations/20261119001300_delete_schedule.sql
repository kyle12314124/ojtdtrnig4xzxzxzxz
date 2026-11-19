-- ===========================================================================
-- DTR Management System - Phase 10
-- Delete a work schedule (admin only, audited, guarded).
--
-- A schedule can only be deleted when:
--   * no employee currently uses it, and
--   * no attendance record references it.
-- Assignment history rows are removed with it because, without attendance,
-- they are only pointers to a schedule that was never used for timekeeping.
-- ===========================================================================

begin;

create or replace function public.delete_work_schedule(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule public.work_schedules;
  v_assigned integer;
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

  if v_assigned > 0 then
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

  delete from public.schedule_assignments a
  where a.schedule_id = p_schedule_id;

  delete from public.work_schedules s
  where s.id = p_schedule_id;

  perform private.log_audit(
    'schedule.deleted',
    'work_schedule',
    p_schedule_id::text,
    format('Schedule "%s" deleted', v_schedule.name),
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
    'name', v_schedule.name
  );
end;
$$;

revoke all on function public.delete_work_schedule(uuid) from public;
grant execute on function public.delete_work_schedule(uuid) to authenticated;

commit;
