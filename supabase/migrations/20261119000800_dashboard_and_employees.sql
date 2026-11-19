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
