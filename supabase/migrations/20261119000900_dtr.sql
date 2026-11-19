-- ===========================================================================
-- DTR Management System - Phase 7
-- DTR payloads and attendance listings used by history and reports.
-- ===========================================================================

begin;

create or replace function public.get_dtr(
  p_employee_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee public.employees;
  v_schedule public.work_schedules;
  v_department public.departments;
  v_rows jsonb;
  v_minutes integer := 0;
  v_late integer := 0;
  v_undertime integer := 0;
  v_overtime integer := 0;
  v_days integer := 0;
  v_tz text;
begin
  perform private.require_authenticated();

  if not private.can_view_employee(p_employee_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'INVALID_PERIOD'
      using errcode = '22023',
            detail = 'Provide a start and end date, with the end on or after the start.';
  end if;

  if (p_end - p_start) > 62 then
    raise exception 'PERIOD_TOO_LONG'
      using errcode = '22023',
            detail = 'Export at most two months at a time.';
  end if;

  select * into v_employee
  from public.employees e
  where e.id = p_employee_id;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_schedule
  from public.work_schedules w
  where w.id = coalesce(
    private.resolve_schedule(p_employee_id, p_end),
    v_employee.schedule_id
  );

  select * into v_department
  from public.departments d
  where d.id = v_employee.department_id;

  v_tz := coalesce(v_schedule.timezone, 'Asia/Manila');

  select coalesce(
    jsonb_agg(row_data order by work_date),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      d::date as work_date,
      jsonb_build_object(
        'work_date', d::date,
        'record', to_jsonb(r),
        'sessions', coalesce(
          (
            select jsonb_agg(to_jsonb(s) order by s.time_in)
            from public.attendance_sessions s
            where s.attendance_record_id = r.id
          ),
          '[]'::jsonb
        ),
        'is_work_day', case
          when v_schedule.id is null then true
          else extract(isodow from d)::integer = any (v_schedule.work_days)
        end,
        'holiday', (
          select jsonb_build_object(
            'name', h.name,
            'holiday_type', h.holiday_type,
            'is_paid', h.is_paid
          )
          from public.holidays h
          where h.holiday_date = d::date
        )
      ) as row_data
    from generate_series(p_start, p_end, interval '1 day') as d
    left join public.attendance_records r
      on r.employee_id = p_employee_id
     and r.work_date = d::date
  ) days;

  select
    coalesce(sum(r.worked_minutes), 0),
    coalesce(sum(r.late_minutes), 0),
    coalesce(sum(r.undertime_minutes), 0),
    coalesce(sum(r.overtime_minutes), 0),
    count(*) filter (where r.first_time_in is not null)
  into v_minutes, v_late, v_undertime, v_overtime, v_days
  from public.attendance_records r
  where r.employee_id = p_employee_id
    and r.work_date between p_start and p_end;

  return jsonb_build_object(
    'employee', jsonb_build_object(
      'id', v_employee.id,
      'employee_no', v_employee.employee_no,
      'full_name', concat_ws(' ', v_employee.first_name, v_employee.middle_name, v_employee.last_name),
      'department', v_department.name,
      'position', v_employee.position,
      'schedule', v_schedule.name,
      'timezone', v_tz
    ),
    'period', jsonb_build_object(
      'start', p_start,
      'end', p_end,
      'label', to_char(p_start, 'Mon DD, YYYY') || ' - ' || to_char(p_end, 'Mon DD, YYYY')
    ),
    'rows', v_rows,
    'totals', jsonb_build_object(
      'worked_minutes', v_minutes,
      'late_minutes', v_late,
      'undertime_minutes', v_undertime,
      'overtime_minutes', v_overtime,
      'days_present', v_days
    ),
    'server_time', now()
  );
end;
$$;

create or replace function public.list_attendance(
  p_start date,
  p_end date,
  p_employee_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_total integer;
  v_items jsonb;
begin
  if not (private.is_admin() or private.is_supervisor()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.attendance_records r
  where r.work_date between p_start and p_end
    and (p_employee_id is null or r.employee_id = p_employee_id)
    and private.can_view_employee(r.employee_id);

  select coalesce(jsonb_agg(item order by work_date desc, employee_name), '[]'::jsonb)
  into v_items
  from (
    select
      r.work_date,
      e.last_name as employee_name,
      jsonb_build_object(
        'id', r.id,
        'employee_id', r.employee_id,
        'employee_no', e.employee_no,
        'employee_name', concat_ws(' ', e.first_name, e.last_name),
        'work_date', r.work_date,
        'schedule_id', r.schedule_id,
        'first_time_in', r.first_time_in,
        'last_time_out', r.last_time_out,
        'worked_minutes', r.worked_minutes,
        'late_minutes', r.late_minutes,
        'undertime_minutes', r.undertime_minutes,
        'overtime_minutes', r.overtime_minutes,
        'status', r.status,
        'remarks', r.remarks
      ) as item
    from public.attendance_records r
    join public.employees e on e.id = r.employee_id
    where r.work_date between p_start and p_end
      and (p_employee_id is null or r.employee_id = p_employee_id)
      and private.can_view_employee(r.employee_id)
    order by r.work_date desc, e.last_name
    offset (v_page - 1) * v_size
    limit v_size
  ) rows;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'page', v_page,
    'page_size', v_size
  );
end;
$$;

revoke all on function public.get_dtr(uuid, date, date) from public;
revoke all on function public.list_attendance(date, date, uuid, integer, integer) from public;

grant execute on function public.get_dtr(uuid, date, date) to authenticated;
grant execute on function public.list_attendance(date, date, uuid, integer, integer) to authenticated;

commit;
