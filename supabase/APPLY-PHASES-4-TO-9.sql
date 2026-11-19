-- ===========================================================================
-- DTR Management System - apply Phases 4, 5, 7, 8, 9, 10 in one transaction file
--
-- Supabase Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- It is safe to run once. If a statement fails, nothing in that section is
-- committed; fix the reported error and run the same file again.
--
-- Sections:
--   1. Administrator dashboard and employee management
--   2. DTR payloads and attendance listings
--   3. Attendance corrections
--   4. Default schedule text cleanup
--   5. Audit trail viewer
--   6. Delete a work schedule
--   7. Delete a work schedule and unassign its employees
--   8. Self-service schedule joining
--   9. Leaving a schedule and forced deletion
--  10. Delete a test attendance day
--  11. Schedule filters for dashboard, attendance, and corrections
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 20261119000800_dashboard_and_employees.sql
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- DTR Management System - Phase 4 & 5
-- Live administrator dashboard and employee management.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Departments (small, admin-managed reference data)
-- ---------------------------------------------------------------------------
create or replace function public.list_departments()
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
        'id', d.id,
        'name', d.name,
        'code', d.code,
        'is_active', d.is_active,
        'employee_count', (
          select count(*) from public.employees e
          where e.department_id = d.id and e.status <> 'archived'
        )
      )
      order by d.name
    ),
    '[]'::jsonb
  )
  into v_result
  from public.departments d;

  return v_result;
end;
$$;

create or replace function public.create_department(p_name text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_department public.departments;
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if char_length(v_name) < 2 then
    raise exception 'DEPARTMENT_NAME_INVALID' using errcode = '22023';
  end if;
  if v_code !~ '^[A-Z0-9-]{2,12}$' then
    raise exception 'DEPARTMENT_CODE_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.departments d where upper(d.code) = v_code) then
    raise exception 'DEPARTMENT_CODE_TAKEN' using errcode = '23505';
  end if;

  insert into public.departments (name, code)
  values (v_name, v_code)
  returning * into v_department;

  perform private.log_audit(
    'department.created', 'department', v_department.id::text,
    format('Department "%s" created', v_department.name), null, to_jsonb(v_department)
  );

  return jsonb_build_object(
    'id', v_department.id, 'name', v_department.name, 'code', v_department.code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard(p_date date default null)
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
  where e.status = 'active';

  select
    count(*) filter (where r.first_time_in is not null),
    count(*) filter (where r.late_minutes > 0),
    coalesce(sum(r.worked_minutes), 0)
  into v_present, v_late, v_minutes
  from public.attendance_records r
  where r.work_date = v_date;

  select count(*) into v_working
  from public.attendance_sessions s
  where s.time_out is null;

  select count(*) into v_absent
  from public.employees e
  join public.work_schedules w on w.id = e.schedule_id
  where e.status = 'active'
    and extract(isodow from v_date)::integer = any (w.work_days)
    and not exists (
      select 1 from public.attendance_records r
      where r.employee_id = e.id
        and r.work_date = v_date
        and r.first_time_in is not null
    );

  select count(*) into v_onboarding
  from public.employees e
  where e.approved_at is null and e.status = 'inactive';

  select count(*) into v_corrections
  from public.attendance_corrections c
  where c.status = 'pending';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'day', d::date,
        'present', (
          select count(*) from public.attendance_records r
          where r.work_date = d::date and r.first_time_in is not null
        ),
        'late', (
          select count(*) from public.attendance_records r
          where r.work_date = d::date and r.late_minutes > 0
        ),
        'minutes', (
          select coalesce(sum(r.worked_minutes), 0)
          from public.attendance_records r
          where r.work_date = d::date
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
    group by e.department_id
  ) counts
  left join public.departments d on d.id = counts.department_id;

  return jsonb_build_object(
    'date', v_date,
    'server_time', now(),
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

-- ---------------------------------------------------------------------------
-- Employee directory
-- ---------------------------------------------------------------------------
create or replace function public.list_employees(
  p_search text default null,
  p_status text default null,
  p_schedule_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 10), 1), 100);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status public.account_status;
  v_total integer;
  v_items jsonb;
begin
  if not (private.is_admin() or private.is_supervisor()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_status is not null and btrim(p_status) <> '' then
    begin
      v_status := p_status::public.account_status;
    exception when others then
      raise exception 'INVALID_STATUS' using errcode = '22023';
    end;
  end if;

  select count(*) into v_total
  from public.employees e
  where (v_search is null or (
          e.employee_no ilike '%' || v_search || '%'
          or e.first_name ilike '%' || v_search || '%'
          or e.last_name ilike '%' || v_search || '%'
          or e.email ilike '%' || v_search || '%'
        ))
    and (v_status is null or e.status = v_status)
    and (p_schedule_id is null or e.schedule_id = p_schedule_id)
    and e.status <> 'archived';

  select coalesce(jsonb_agg(item order by last_name, first_name), '[]'::jsonb)
  into v_items
  from (
    select
      e.last_name,
      e.first_name,
      jsonb_build_object(
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
        'department_id', e.department_id,
        'department', case when d.id is null then null else jsonb_build_object('id', d.id, 'name', d.name, 'code', d.code) end,
        'schedule_id', e.schedule_id,
        'schedule', case when w.id is null then null else jsonb_build_object('id', w.id, 'name', w.name) end,
        'supervisor_id', e.supervisor_id
      ) as item
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.work_schedules w on w.id = e.schedule_id
    where (v_search is null or (
            e.employee_no ilike '%' || v_search || '%'
            or e.first_name ilike '%' || v_search || '%'
            or e.last_name ilike '%' || v_search || '%'
            or e.email ilike '%' || v_search || '%'
          ))
      and (v_status is null or e.status = v_status)
      and (p_schedule_id is null or e.schedule_id = p_schedule_id)
      and e.status <> 'archived'
    order by e.last_name, e.first_name
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

create or replace function public.update_employee(
  p_employee_id uuid,
  p_first_name text,
  p_middle_name text default null,
  p_last_name text default null,
  p_position text default null,
  p_department_id uuid default null,
  p_employment_type text default null,
  p_date_hired date default null,
  p_supervisor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_before public.employees;
  v_after public.employees;
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
  v_middle text := nullif(btrim(coalesce(p_middle_name, '')), '');
  v_position text := nullif(btrim(coalesce(p_position, '')), '');
  v_type public.employment_type;
begin
  select * into v_before
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
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

  if p_employment_type is not null then
    begin
      v_type := p_employment_type::public.employment_type;
    exception when others then
      raise exception 'INVALID_EMPLOYMENT_TYPE' using errcode = '22023';
    end;
  end if;

  if p_supervisor_id is not null and p_supervisor_id = p_employee_id then
    raise exception 'SUPERVISOR_SELF' using errcode = '22023';
  end if;

  if p_department_id is not null and not exists (
    select 1 from public.departments d where d.id = p_department_id
  ) then
    raise exception 'DEPARTMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.employees
     set first_name = v_first,
         middle_name = v_middle,
         last_name = v_last,
         position = v_position,
         department_id = p_department_id,
         employment_type = coalesce(v_type, employment_type),
         date_hired = coalesce(p_date_hired, date_hired),
         supervisor_id = p_supervisor_id
   where id = p_employee_id
   returning * into v_after;

  update public.profiles p
     set full_name = concat_ws(' ', v_after.first_name, v_after.middle_name, v_after.last_name)
   where p.id = v_after.profile_id;

  perform private.log_audit(
    'employee.updated', 'employee', p_employee_id::text,
    'Employee details updated', to_jsonb(v_before), to_jsonb(v_after)
  );

  return to_jsonb(v_after);
end;
$$;

create or replace function public.set_employee_status(
  p_employee_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_before public.employees;
  v_after public.employees;
  v_status public.account_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_open integer;
begin
  begin
    v_status := p_status::public.account_status;
  exception when others then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end;

  select * into v_before
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_status = 'active' and v_before.approved_at is null then
    raise exception 'NOT_APPROVED'
      using errcode = '55000',
            detail = 'Approve this account through the onboarding queue first.';
  end if;

  if v_status <> 'active' then
    select count(*) into v_open
    from public.attendance_sessions s
    where s.employee_id = p_employee_id and s.time_out is null;

    if v_open > 0 then
      raise exception 'OPEN_SESSION'
        using errcode = '55000',
              detail = 'This employee has an open time-in. Ask them to time out first.';
    end if;
  end if;

  update public.employees
     set status = v_status,
         archived_at = case when v_status = 'archived' then now() else null end
   where id = p_employee_id
   returning * into v_after;

  update public.profiles p
     set is_active = (v_status = 'active')
   where p.id = v_after.profile_id;

  perform private.log_audit(
    'employee.status_changed', 'employee', p_employee_id::text,
    format('Status changed to %s%s', v_status, case when v_reason is null then '' else ': ' || v_reason end),
    jsonb_build_object('status', v_before.status, 'is_active', true),
    jsonb_build_object('status', v_after.status)
  );

  return jsonb_build_object('employee_id', p_employee_id, 'status', v_after.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.list_departments() from public;
revoke all on function public.create_department(text, text) from public;
revoke all on function public.admin_dashboard(date) from public;
revoke all on function public.list_employees(text, text, uuid, integer, integer) from public;
revoke all on function public.update_employee(uuid, text, text, text, text, uuid, text, date, uuid) from public;
revoke all on function public.set_employee_status(uuid, text, text) from public;

grant execute on function public.list_departments() to authenticated;
grant execute on function public.create_department(text, text) to authenticated;
grant execute on function public.admin_dashboard(date) to authenticated;
grant execute on function public.list_employees(text, text, uuid, integer, integer) to authenticated;
grant execute on function public.update_employee(uuid, text, text, text, text, uuid, text, date, uuid) to authenticated;
grant execute on function public.set_employee_status(uuid, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- 20261119000900_dtr.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20261119001000_corrections.sql
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- DTR Management System - Phase 9
-- Attendance correction requests and reviews. Original punches are snapshotted
-- before any change, and only administrators/supervisors can apply them.
-- ===========================================================================

begin;

create or replace function public.request_correction(
  p_work_date date,
  p_type text,
  p_time_in timestamptz default null,
  p_time_out timestamptz default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_employee public.employees;
  v_type public.correction_type;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_record public.attendance_records;
  v_snapshot jsonb;
  v_correction public.attendance_corrections;
begin
  select * into v_employee
  from public.employees e
  where e.profile_id = v_uid and e.status = 'active';

  if not found then
    raise exception 'EMPLOYEE_NOT_ACTIVE' using errcode = '42501';
  end if;

  begin
    v_type := p_type::public.correction_type;
  exception when others then
    raise exception 'INVALID_CORRECTION_TYPE' using errcode = '22023';
  end;

  if p_work_date is null then
    raise exception 'WORK_DATE_REQUIRED' using errcode = '22023';
  end if;

  if p_work_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'FUTURE_DATE'
      using errcode = '22023',
            detail = 'Corrections cannot be requested for a future date.';
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'REASON_TOO_SHORT'
      using errcode = '22023',
            detail = 'Explain what happened in at least 10 characters.';
  end if;

  if v_type = 'missing_time_in' and p_time_in is null then
    raise exception 'TIME_IN_REQUIRED' using errcode = '22023';
  end if;
  if v_type = 'missing_time_out' and p_time_out is null then
    raise exception 'TIME_OUT_REQUIRED' using errcode = '22023';
  end if;
  if v_type = 'incorrect_time' and (p_time_in is null or p_time_out is null) then
    raise exception 'BOTH_TIMES_REQUIRED' using errcode = '22023';
  end if;
  if p_time_out is not null and p_time_in is not null and p_time_out <= p_time_in then
    raise exception 'TIME_ORDER_INVALID' using errcode = '22023';
  end if;

  select * into v_record
  from public.attendance_records r
  where r.employee_id = v_employee.id
    and r.work_date = p_work_date;

  if v_record.id is not null then
    select jsonb_build_object(
      'record', to_jsonb(v_record),
      'sessions', coalesce(
        (
          select jsonb_agg(to_jsonb(s) order by s.time_in)
          from public.attendance_sessions s
          where s.attendance_record_id = v_record.id
        ),
        '[]'::jsonb
      )
    )
    into v_snapshot;
  end if;

  begin
    insert into public.attendance_corrections (
      employee_id, attendance_record_id, work_date, correction_type,
      requested_time_in, requested_time_out, reason, original_snapshot
    )
    values (
      v_employee.id, v_record.id, p_work_date, v_type,
      p_time_in, p_time_out, v_reason, v_snapshot
    )
    returning * into v_correction;
  exception
    when unique_violation then
      raise exception 'DUPLICATE_CORRECTION'
        using errcode = '23505',
              detail = 'You already have a pending correction of this type for that date.';
  end;

  perform private.log_audit(
    'correction.requested', 'attendance_correction', v_correction.id::text,
    format('Correction requested for %s (%s)', p_work_date, v_type),
    v_snapshot, to_jsonb(v_correction)
  );

  return jsonb_build_object(
    'id', v_correction.id,
    'work_date', v_correction.work_date,
    'correction_type', v_correction.correction_type,
    'status', v_correction.status
  );
end;
$$;

create or replace function public.list_my_corrections(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_employee uuid;
  v_result jsonb;
begin
  select id into v_employee
  from public.employees e
  where e.profile_id = v_uid and e.status = 'active';

  if v_employee is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(c) order by c.created_at desc),
    '[]'::jsonb
  )
  into v_result
  from (
    select * from public.attendance_corrections c
    where c.employee_id = v_employee
    order by c.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) c;

  return v_result;
end;
$$;

create or replace function public.cancel_correction(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_employee uuid;
  v_correction public.attendance_corrections;
begin
  select id into v_employee
  from public.employees e
  where e.profile_id = v_uid and e.status = 'active';

  if v_employee is null then
    raise exception 'EMPLOYEE_NOT_ACTIVE' using errcode = '42501';
  end if;

  select * into v_correction
  from public.attendance_corrections c
  where c.id = p_id
  for update;

  if not found then
    raise exception 'CORRECTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_correction.employee_id <> v_employee then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_correction.status <> 'pending' then
    raise exception 'NOT_PENDING'
      using errcode = '55000',
            detail = 'Only pending requests can be cancelled.';
  end if;

  update public.attendance_corrections
     set status = 'cancelled'
   where id = p_id;

  perform private.log_audit(
    'correction.cancelled', 'attendance_correction', p_id::text,
    'Correction cancelled by employee', to_jsonb(v_correction), null
  );

  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end;
$$;

create or replace function public.list_corrections(
  p_status text default 'pending',
  p_page integer default 1,
  p_page_size integer default 20
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
    and private.can_view_employee(c.employee_id);

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
    order by c.created_at desc
    offset (v_page - 1) * v_size
    limit v_size
  ) rows;

  return jsonb_build_object(
    'items', v_items, 'total', v_total, 'page', v_page, 'page_size', v_size
  );
end;
$$;

create or replace function public.review_correction(
  p_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin', 'supervisor']::public.user_role[]);
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_correction public.attendance_corrections;
  v_record public.attendance_records;
  v_first public.attendance_sessions;
  v_last public.attendance_sessions;
  v_before jsonb;
begin
  select * into v_correction
  from public.attendance_corrections c
  where c.id = p_id
  for update;

  if not found then
    raise exception 'CORRECTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_correction.status <> 'pending' then
    raise exception 'ALREADY_REVIEWED'
      using errcode = '55000',
            detail = 'This request has already been reviewed.';
  end if;

  if not private.can_view_employee(v_correction.employee_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'record', to_jsonb(r),
    'sessions', coalesce(
      (
        select jsonb_agg(to_jsonb(s) order by s.time_in)
        from public.attendance_sessions s
        where s.attendance_record_id = r.id
      ),
      '[]'::jsonb
    )
  )
  into v_before
  from public.attendance_records r
  where r.id = v_correction.attendance_record_id;

  if not p_approve then
    if v_notes is null then
      raise exception 'REVIEW_NOTES_REQUIRED'
        using errcode = '22023',
              detail = 'Give a reason when rejecting a correction.';
    end if;

    update public.attendance_corrections
       set status = 'rejected',
           reviewed_by = v_uid,
           reviewed_at = now(),
           review_notes = v_notes,
           original_snapshot = coalesce(original_snapshot, v_before)
     where id = p_id;

    perform private.log_audit(
      'correction.rejected', 'attendance_correction', p_id::text,
      format('Correction rejected: %s', v_notes), v_before, jsonb_build_object('status', 'rejected')
    );

    return jsonb_build_object('id', p_id, 'status', 'rejected');
  end if;

  select * into v_record
  from public.attendance_records r
  where r.employee_id = v_correction.employee_id
    and r.work_date = v_correction.work_date
  for update;

  if v_record.id is null then
    insert into public.attendance_records (employee_id, work_date, schedule_id)
    values (
      v_correction.employee_id,
      v_correction.work_date,
      private.resolve_schedule(v_correction.employee_id, v_correction.work_date)
    )
    returning * into v_record;
  end if;

  select * into v_first
  from public.attendance_sessions s
  where s.attendance_record_id = v_record.id
  order by s.time_in
  limit 1;

  select * into v_last
  from public.attendance_sessions s
  where s.attendance_record_id = v_record.id
  order by s.time_in desc
  limit 1;

  begin
    if v_correction.correction_type = 'missing_time_in' then
      if v_first.id is null then
        insert into public.attendance_sessions (
          attendance_record_id, employee_id, work_date, time_in, time_out, source, created_by
        )
        values (
          v_record.id, v_correction.employee_id, v_correction.work_date,
          v_correction.requested_time_in, v_correction.requested_time_out, 'correction', v_uid
        );
      else
        update public.attendance_sessions
           set time_in = v_correction.requested_time_in
         where id = v_first.id;
      end if;

    elsif v_correction.correction_type = 'missing_time_out' then
      if v_last.id is null then
        raise exception 'NO_SESSION_TO_COMPLETE'
          using errcode = '55000',
                detail = 'There is no punch on that date to complete.';
      end if;

      update public.attendance_sessions
         set time_out = v_correction.requested_time_out
       where id = v_last.id;

    elsif v_correction.correction_type = 'incorrect_time' then
      if v_first.id is null then
        insert into public.attendance_sessions (
          attendance_record_id, employee_id, work_date, time_in, time_out, source, created_by
        )
        values (
          v_record.id, v_correction.employee_id, v_correction.work_date,
          v_correction.requested_time_in, v_correction.requested_time_out, 'correction', v_uid
        );
      elsif v_first.id = v_last.id then
        -- One punch pair covers the day; update both ends in a single statement
        -- so the time-order check never sees a half-applied pair.
        update public.attendance_sessions
           set time_in = v_correction.requested_time_in,
               time_out = v_correction.requested_time_out
         where id = v_first.id;
      else
        update public.attendance_sessions
           set time_in = v_correction.requested_time_in
         where id = v_first.id;

        update public.attendance_sessions
           set time_out = v_correction.requested_time_out
         where id = v_last.id;
      end if;
    end if;
  exception
    when others then
      raise exception 'CORRECTION_CONFLICT'
        using errcode = '23514',
              detail = 'The requested times overlap another punch or break the time order.';
  end;

  v_record := private.recompute_attendance(v_record.id);

  update public.attendance_corrections
     set status = 'approved',
         reviewed_by = v_uid,
         reviewed_at = now(),
         review_notes = v_notes,
         applied_at = now(),
         original_snapshot = coalesce(original_snapshot, v_before)
   where id = p_id;

  perform private.log_audit(
    'correction.approved', 'attendance_correction', p_id::text,
    'Correction approved and applied', v_before, to_jsonb(v_record)
  );

  return jsonb_build_object(
    'id', p_id,
    'status', 'approved',
    'record', to_jsonb(v_record)
  );
end;
$$;

revoke all on function public.request_correction(date, text, timestamptz, timestamptz, text) from public;
revoke all on function public.list_my_corrections(integer) from public;
revoke all on function public.cancel_correction(uuid) from public;
revoke all on function public.list_corrections(text, integer, integer) from public;
revoke all on function public.review_correction(uuid, boolean, text) from public;

grant execute on function public.request_correction(date, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.list_my_corrections(integer) to authenticated;
grant execute on function public.cancel_correction(uuid) to authenticated;
grant execute on function public.list_corrections(text, integer, integer) to authenticated;
grant execute on function public.review_correction(uuid, boolean, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- 20261119001100_text_cleanup.sql
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- DTR Management System - Phase 6 text cleanup
--
-- The default schedule description was pasted through a Windows-1252 terminal,
-- which turned the en dashes into replacement characters. Normalize it to plain
-- ASCII so exports and PDFs stay readable.
-- ===========================================================================

begin;

update public.work_schedules
   set description = 'Monday to Friday, 8:00-12:00 and 13:00-17:00'
 where name = 'OJT Standard'
   and description is distinct from 'Monday to Friday, 8:00-12:00 and 13:00-17:00';

commit;

-- ---------------------------------------------------------------------------
-- 20261119001200_audit_logs.sql
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- DTR Management System - Phase 10
-- Read-only audit trail for administrators.
-- ===========================================================================

begin;

create or replace function public.list_audit_logs(
  p_search text default null,
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
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total integer;
  v_items jsonb;
begin
  perform private.require_role(array['admin']::public.user_role[]);

  select count(*) into v_total
  from public.audit_logs a
  where v_search is null
     or a.action ilike '%' || v_search || '%'
     or a.entity_type ilike '%' || v_search || '%'
     or concat_ws(' ', a.summary, a.entity_id) ilike '%' || v_search || '%';

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      a.created_at,
      jsonb_build_object(
        'id', a.id,
        'created_at', a.created_at,
        'actor_id', a.actor_id,
        'actor_name', p.full_name,
        'actor_role', a.actor_role,
        'action', a.action,
        'entity_type', a.entity_type,
        'entity_id', a.entity_id,
        'summary', a.summary,
        'before_data', a.before_data,
        'after_data', a.after_data
      ) as item
    from public.audit_logs a
    left join public.profiles p on p.id = a.actor_id
    where v_search is null
       or a.action ilike '%' || v_search || '%'
       or a.entity_type ilike '%' || v_search || '%'
       or concat_ws(' ', a.summary, a.entity_id) ilike '%' || v_search || '%'
    order by a.created_at desc, a.id desc
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

revoke all on function public.list_audit_logs(text, integer, integer) from public;
grant execute on function public.list_audit_logs(text, integer, integer) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- 20261119001300_delete_schedule.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20261119001400_delete_schedule_unassign.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20261119001500_join_schedule.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20261119001600_leave_and_force_delete.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20261119001700_delete_attendance.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20261119001800_schedule_filters.sql
-- ---------------------------------------------------------------------------

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
