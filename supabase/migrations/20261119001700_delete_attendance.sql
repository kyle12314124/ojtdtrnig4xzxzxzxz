-- ===========================================================================
-- DTR Management System - Phase 10
-- Delete one saved attendance day (administrator only, audited).
--
-- This is the clean-up path for test punches. A reason is required, the
-- open-punch and pending-correction guards prevent accidental loss, and the
-- deleted record plus its sessions are snapshotted into the audit trail.
-- ===========================================================================

begin;

create or replace function public.delete_attendance_record(
  p_record_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_record public.attendance_records;
  v_employee public.employees;
  v_sessions jsonb;
  v_open integer;
begin
  if char_length(v_reason) < 5 then
    raise exception 'REASON_REQUIRED'
      using errcode = '22023',
            detail = 'Give a reason of at least 5 characters.';
  end if;

  select * into v_record
  from public.attendance_records r
  where r.id = p_record_id
  for update;

  if not found then
    raise exception 'ATTENDANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_employee
  from public.employees e
  where e.id = v_record.employee_id;

  select count(*) into v_open
  from public.attendance_sessions s
  where s.attendance_record_id = v_record.id
    and s.time_out is null;

  if v_open > 0 then
    raise exception 'OPEN_SESSION_EXISTS'
      using errcode = '55000',
            detail = 'Time out the open punch before deleting the day.';
  end if;

  if exists (
    select 1 from public.attendance_corrections c
    where c.employee_id = v_record.employee_id
      and c.work_date = v_record.work_date
      and c.status = 'pending'
  ) then
    raise exception 'PENDING_CORRECTION'
      using errcode = '55000',
            detail = 'Resolve the pending correction for this day first.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'time_in', s.time_in,
        'time_out', s.time_out,
        'worked_minutes', s.worked_minutes,
        'source', s.source
      )
      order by s.time_in
    ),
    '[]'::jsonb
  )
  into v_sessions
  from public.attendance_sessions s
  where s.attendance_record_id = v_record.id;

  delete from public.attendance_records r
  where r.id = v_record.id;

  perform private.log_audit(
    'attendance.deleted',
    'attendance_record',
    v_record.id::text,
    format(
      'Deleted attendance for %s on %s: %s',
      coalesce(concat_ws(' ', v_employee.first_name, v_employee.last_name), 'employee'),
      v_record.work_date,
      v_reason
    ),
    jsonb_build_object(
      'employee_id', v_record.employee_id,
      'employee_no', v_employee.employee_no,
      'work_date', v_record.work_date,
      'schedule_id', v_record.schedule_id,
      'first_time_in', v_record.first_time_in,
      'last_time_out', v_record.last_time_out,
      'worked_minutes', v_record.worked_minutes,
      'late_minutes', v_record.late_minutes,
      'undertime_minutes', v_record.undertime_minutes,
      'overtime_minutes', v_record.overtime_minutes,
      'status', v_record.status,
      'sessions', v_sessions
    ),
    jsonb_build_object('deleted', true, 'reason', v_reason, 'deleted_by', v_uid)
  );

  return jsonb_build_object(
    'deleted', true,
    'id', v_record.id,
    'work_date', v_record.work_date,
    'employee_id', v_record.employee_id,
    'employee_name', concat_ws(' ', v_employee.first_name, v_employee.last_name)
  );
end;
$$;

revoke all on function public.delete_attendance_record(uuid, text) from public;
grant execute on function public.delete_attendance_record(uuid, text) to authenticated;

commit;
