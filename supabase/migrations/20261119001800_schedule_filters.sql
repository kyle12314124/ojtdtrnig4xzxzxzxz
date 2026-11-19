-- ===========================================================================
-- DTR Management System - Phase 10
-- Schedule scoping for the administrator views.
--
-- Every aggregate can now be restricted to one schedule. The schedule in
-- force on the relevant day is used (assignment history first, then the
-- employee's current pointer), so history stays correct after a switch.
-- ===========================================================================

begin;

drop function if exists public.admin_dashboard(date);
drop function if exists public.admin_dashboard(date, uuid);

create or replace function public.admin_dashboard(
  p_date date default null,
  p_schedule_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Manila')::date);
  v_total integer;
  v_present integer;
  v_late integer;
  v_absent integer;
  v_working integer;
  v_minutes integer;
  v_onboarding integer;
  v_corrections integer;
  v_trend jsonb;
  v_recent jsonb;
  v_departments jsonb;
begin
  if not (private.is_admin() or private.is_supervisor()) then
    raise exception 'FORBIDDEN'
      using errcode = '42501',
            detail = 'Only administrators and supervisors can read the dashboard.';
  end if;

  select count(*) into v_total
  from public.employees e
  where e.status = 'active'
    and (
      p_schedule_id is null
      or private.resolve_schedule(e.id, v_date) = p_schedule_id
    );

  select
    count(*) filter (where r.first_time_in is not null),
    count(*) filter (where r.late_minutes > 0),
    coalesce(sum(r.worked_minutes), 0)
  into v_present, v_late, v_minutes
  from public.attendance_records r
  join public.employees e on e.id = r.employee_id
  where r.work_date = v_date
    and (
      p_schedule_id is null
      or private.resolve_schedule(e.id, v_date) = p_schedule_id
    );

  select count(*) into v_working
  from public.attendance_sessions s
  join public.employees e on e.id = s.employee_id
  where s.time_out is null
    and (
      p_schedule_id is null
      or private.resolve_schedule(e.id, s.work_date) = p_schedule_id
    );

  select count(*) into v_absent
  from public.employees e
  join public.work_schedules w on w.id = private.resolve_schedule(e.id, v_date)
  where e.status = 'active'
    and extract(isodow from v_date)::integer = any (w.work_days)
    and (p_schedule_id is null or w.id = p_schedule_id)
    and not exists (
      select 1 from public.attendance_records r
      where r.employee_id = e.id
        and r.work_date = v_date
        and r.first_time_in is not null
    );

  select count(*) into v_onboarding
  from public.employees e
  where e.approved_at is null
    and e.status = 'inactive'
    and (
      p_schedule_id is null
      or private.resolve_schedule(e.id, v_date) = p_schedule_id
    );

  select count(*) into v_corrections
  from public.attendance_corrections c
  join public.employees e on e.id = c.employee_id
  where c.status = 'pending'
    and (
      p_schedule_id is null
      or private.resolve_schedule(e.id, c.work_date) = p_schedule_id
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'day', d::date,
        'present', (
          select count(*)
          from public.attendance_records r
          join public.employees e on e.id = r.employee_id
          where r.work_date = d::date
            and r.first_time_in is not null
            and (
              p_schedule_id is null
              or private.resolve_schedule(e.id, d::date) = p_schedule_id
            )
        ),
        'late', (
          select count(*)
          from public.attendance_records r
          join public.employees e on e.id = r.employee_id
          where r.work_date = d::date
            and r.late_minutes > 0
            and (
              p_schedule_id is null
              or private.resolve_schedule(e.id, d::date) = p_schedule_id
            )
        ),
        'minutes', (
          select coalesce(sum(r.worked_minutes), 0)
          from public.attendance_records r
          join public.employees e on e.id = r.employee_id
          where r.work_date = d::date
            and (
              p_schedule_id is null
              or private.resolve_schedule(e.id, d::date) = p_schedule_id
            )
        )
      )
      order by d
    ),
    '[]'::jsonb
  )
  into v_trend
  from generate_series(v_date - 13, v_date, interval '1 day') as d;

  select coalesce(
    jsonb_agg(row_data order by created_at desc),
    '[]'::jsonb
  )
  into v_recent
  from (
    select
      jsonb_build_object(
        'employee_id', e.id,
        'employee_no', e.employee_no,
        'employee_name', concat_ws(' ', e.first_name, e.last_name),
        'time_in', s.time_in,
        'time_out', s.time_out,
        'work_date', s.work_date
      ) as row_data,
      s.time_in as created_at
    from public.attendance_sessions s
    join public.employees e on e.id = s.employee_id
    where (
      p_schedule_id is null
      or private.resolve_schedule(e.id, s.work_date) = p_schedule_id
    )
    order by s.time_in desc
    limit 8
  ) recent;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'department', coalesce(d.name, 'Unassigned'),
        'count', counts.total
      )
      order by counts.total desc
    ),
    '[]'::jsonb
  )
  into v_departments
  from (
    select e.department_id, count(*) as total
    from public.employees e
    where e.status = 'active'
      and (
        p_schedule_id is null
        or private.resolve_schedule(e.id, v_date) = p_schedule_id
      )
    group by e.department_id
  ) counts
  left join public.departments d on d.id = counts.department_id;

  return jsonb_build_object(
    'date', v_date,
    'server_time', now(),
    'schedule_id', p_schedule_id,
    'total_employees', v_total,
    'present_today', v_present,
    'late_today', v_late,
    'absent_today', v_absent,
    'currently_working', v_working,
    'worked_minutes_today', v_minutes,
    'pending_onboarding', v_onboarding,
    'pending_corrections', v_corrections,
    'trend', v_trend,
    'recent', v_recent,
    'departments', v_departments
  );
end;
$$;

drop function if exists public.list_attendance(date, date, uuid, integer, integer);
drop function if exists public.list_attendance(date, date, uuid, integer, integer, uuid);

create or replace function public.list_attendance(
  p_start date,
  p_end date,
  p_employee_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 25,
  p_schedule_id uuid default null
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
    and private.can_view_employee(r.employee_id)
    and (
      p_schedule_id is null
      or private.resolve_schedule(r.employee_id, r.work_date) = p_schedule_id
    );

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
      and (
        p_schedule_id is null
        or private.resolve_schedule(r.employee_id, r.work_date) = p_schedule_id
      )
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

drop function if exists public.list_corrections(text, integer, integer);
drop function if exists public.list_corrections(text, integer, integer, uuid);

create or replace function public.list_corrections(
  p_status text default 'pending',
  p_page integer default 1,
  p_page_size integer default 20,
  p_schedule_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_status public.correction_status;
  v_total integer;
  v_items jsonb;
begin
  if not (private.is_admin() or private.is_supervisor()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_status is not null and btrim(p_status) <> '' then
    begin
      v_status := p_status::public.correction_status;
    exception when others then
      raise exception 'INVALID_STATUS' using errcode = '22023';
    end;
  end if;

  select count(*) into v_total
  from public.attendance_corrections c
  where (v_status is null or c.status = v_status)
    and private.can_view_employee(c.employee_id)
    and (
      p_schedule_id is null
      or private.resolve_schedule(c.employee_id, c.work_date) = p_schedule_id
    );

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      c.created_at,
      jsonb_build_object(
        'id', c.id,
        'employee_id', c.employee_id,
        'employee_no', e.employee_no,
        'employee_name', concat_ws(' ', e.first_name, e.last_name),
        'work_date', c.work_date,
        'correction_type', c.correction_type,
        'requested_time_in', c.requested_time_in,
        'requested_time_out', c.requested_time_out,
        'reason', c.reason,
        'status', c.status,
        'review_notes', c.review_notes,
        'reviewed_at', c.reviewed_at,
        'created_at', c.created_at
      ) as item
    from public.attendance_corrections c
    join public.employees e on e.id = c.employee_id
    where (v_status is null or c.status = v_status)
      and private.can_view_employee(c.employee_id)
      and (
        p_schedule_id is null
        or private.resolve_schedule(c.employee_id, c.work_date) = p_schedule_id
      )
    order by c.created_at desc
    offset (v_page - 1) * v_size
    limit v_size
  ) rows;

  return jsonb_build_object(
    'items', v_items, 'total', v_total, 'page', v_page, 'page_size', v_size
  );
end;
$$;

revoke all on function public.admin_dashboard(date, uuid) from public;
revoke all on function public.list_attendance(date, date, uuid, integer, integer, uuid) from public;
revoke all on function public.list_corrections(text, integer, integer, uuid) from public;
grant execute on function public.admin_dashboard(date, uuid) to authenticated;
grant execute on function public.list_attendance(date, date, uuid, integer, integer, uuid) to authenticated;
grant execute on function public.list_corrections(text, integer, integer, uuid) to authenticated;

commit;
