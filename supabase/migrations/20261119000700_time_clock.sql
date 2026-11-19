-- ===========================================================================
-- DTR Management System - Phase 6
-- Work schedules, schedule assignment, and real server-timestamped punches.
--
-- Rules implemented here:
--   * Time in/out are written with the database clock (`now()`), never the
--     browser clock.
--   * One open session per employee (also enforced by a unique index).
--   * Worked minutes count only the overlap with paid periods; the gaps
--     between periods are unpaid breaks.
--   * Late is measured against the first paid period plus the grace period.
--   * Undertime is only computed once every session of the day is closed.
--   * Overtime is time outside the day's first-start..last-end envelope, so a
--     lunch break inside the envelope is never counted as overtime.
--   * Overnight schedules are handled by rolling the end of a period forward
--     one day when its end time is not after its start time.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Timezone helpers
-- ---------------------------------------------------------------------------
create or replace function private.schedule_timezone(p_schedule_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.timezone from public.work_schedules s where s.id = p_schedule_id),
    'Asia/Manila'
  );
$$;

/**
 * The work date a punch belongs to. A punch made after midnight belongs to the
 * previous day when that day's schedule has an overnight period still running.
 */
create or replace function private.attendance_work_date(
  p_schedule_id uuid,
  p_instant timestamptz
)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := private.schedule_timezone(p_schedule_id);
  v_local timestamp := p_instant at time zone v_tz;
  v_date date := v_local::date;
  v_time time := v_local::time;
begin
  if exists (
    select 1
    from public.schedule_periods sp
    where sp.schedule_id = p_schedule_id
      and sp.end_time <= sp.start_time
      and v_time < sp.end_time
  ) then
    return v_date - 1;
  end if;

  return v_date;
end;
$$;

/** Paid periods of a schedule on a given work date, as concrete instants. */
create or replace function private.paid_windows(
  p_schedule_id uuid,
  p_work_date date
)
returns table (window_start timestamptz, window_end timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (p_work_date + sp.start_time) at time zone s.timezone,
    (
      case
        when sp.end_time <= sp.start_time then p_work_date + 1
        else p_work_date
      end + sp.end_time
    ) at time zone s.timezone
  from public.schedule_periods sp
  join public.work_schedules s on s.id = sp.schedule_id
  where sp.schedule_id = p_schedule_id
  order by sp.sort_order, sp.start_time;
$$;

-- ---------------------------------------------------------------------------
-- Recompute the official totals for one attendance record
-- ---------------------------------------------------------------------------
create or replace function private.recompute_attendance(p_record_id uuid)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_record public.attendance_records;
  v_schedule uuid;
  v_scheduled integer := 0;
  v_worked integer := 0;
  v_late integer := 0;
  v_undertime integer := 0;
  v_overtime integer := 0;
  v_open integer := 0;
  v_session_count integer := 0;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_grace integer := 0;
  v_work_days smallint[];
  v_dow integer;
  v_is_holiday boolean := false;
  v_status public.attendance_status;
begin
  select * into v_record
  from public.attendance_records r
  where r.id = p_record_id
  for update;

  if not found then
    raise exception 'RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_schedule := coalesce(
    v_record.schedule_id,
    private.resolve_schedule(v_record.employee_id, v_record.work_date)
  );

  select
    coalesce(sum(extract(epoch from (w.window_end - w.window_start)) / 60), 0)::integer,
    min(w.window_start),
    max(w.window_end)
  into v_scheduled, v_day_start, v_day_end
  from private.paid_windows(v_schedule, v_record.work_date) w;

  select
    min(sess.time_in),
    max(sess.time_out),
    count(*) filter (where sess.time_out is null),
    count(*)
  into v_first_in, v_last_out, v_open, v_session_count
  from public.attendance_sessions sess
  where sess.attendance_record_id = p_record_id;

  -- Worked minutes: overlap of each closed session with the paid windows.
  select coalesce(
    round(
      sum(
        greatest(
          0,
          extract(epoch from (
            least(sess.time_out, w.window_end) - greatest(sess.time_in, w.window_start)
          )) / 60
        )
      )
    ),
    0
  )::integer
  into v_worked
  from public.attendance_sessions sess
  cross join private.paid_windows(v_schedule, v_record.work_date) w
  where sess.attendance_record_id = p_record_id
    and sess.time_out is not null
    and sess.time_in < w.window_end
    and sess.time_out > w.window_start;

  if v_scheduled = 0 then
    -- No schedule: fall back to total elapsed time so the punch still counts.
    select coalesce(
      round(sum(extract(epoch from (sess.time_out - sess.time_in)) / 60)),
      0
    )::integer
    into v_worked
    from public.attendance_sessions sess
    where sess.attendance_record_id = p_record_id
      and sess.time_out is not null;
  end if;

  select coalesce(s.grace_minutes, 0), coalesce(s.work_days, '{1,2,3,4,5,6,7}'::smallint[])
  into v_grace, v_work_days
  from public.work_schedules s
  where s.id = v_schedule;

  v_grace := coalesce(v_grace, 0);
  v_work_days := coalesce(v_work_days, '{1,2,3,4,5,6,7}'::smallint[]);

  if v_day_start is not null and v_first_in is not null then
    v_late := greatest(
      0,
      floor(
        extract(
          epoch from (v_first_in - (v_day_start + make_interval(mins => v_grace)))
        ) / 60
      )
    )::integer;
    v_late := least(v_late, v_scheduled);
  end if;

  if v_scheduled > 0 and v_open = 0 and v_session_count > 0 then
    v_undertime := greatest(0, v_scheduled - v_worked);
  end if;

  if v_day_start is not null then
    select coalesce(
      round(
        sum(
          greatest(
            0,
            extract(epoch from (least(sess.time_out, v_day_start) - sess.time_in)) / 60
          )
          + greatest(
            0,
            extract(epoch from (sess.time_out - greatest(sess.time_in, v_day_end))) / 60
          )
        )
      ),
      0
    )::integer
    into v_overtime
    from public.attendance_sessions sess
    where sess.attendance_record_id = p_record_id
      and sess.time_out is not null;
  end if;

  v_dow := extract(isodow from v_record.work_date)::integer;
  v_is_holiday := exists (
    select 1 from public.holidays h where h.holiday_date = v_record.work_date
  );

  if v_is_holiday and v_worked = 0 then
    v_status := 'holiday';
  elsif v_scheduled = 0 then
    v_status := 'present';
  elsif not (v_dow = any (v_work_days)) and v_worked = 0 then
    v_status := 'rest_day';
  elsif v_late > 0 then
    v_status := 'late';
  else
    v_status := 'present';
  end if;

  update public.attendance_records
     set schedule_id = v_schedule,
         first_time_in = v_first_in,
         last_time_out = v_last_out,
         worked_minutes = v_worked,
         late_minutes = v_late,
         undertime_minutes = v_undertime,
         overtime_minutes = v_overtime,
         status = v_status
   where id = p_record_id
   returning * into v_record;

  return v_record;
end;
$$;

-- ---------------------------------------------------------------------------
-- Punch payload shared by time_in / time_out / get_my_day
-- ---------------------------------------------------------------------------
create or replace function private.day_payload(
  p_employee_id uuid,
  p_work_date date,
  p_record_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule uuid;
  v_record jsonb;
  v_sessions jsonb;
  v_schedule_json jsonb;
begin
  select r.schedule_id into v_schedule
  from public.attendance_records r
  where r.id = p_record_id;

  v_schedule := coalesce(
    v_schedule,
    private.resolve_schedule(p_employee_id, p_work_date)
  );

  select to_jsonb(r) into v_record
  from public.attendance_records r
  where r.id = p_record_id;

  select coalesce(
    jsonb_agg(to_jsonb(sess) order by sess.time_in),
    '[]'::jsonb
  )
  into v_sessions
  from public.attendance_sessions sess
  where sess.attendance_record_id = p_record_id;

  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'timezone', s.timezone,
    'grace_minutes', s.grace_minutes,
    'work_days', s.work_days,
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
    )
  )
  into v_schedule_json
  from public.work_schedules s
  where s.id = v_schedule;

  return jsonb_build_object(
    'work_date', p_work_date,
    'record', v_record,
    'sessions', coalesce(v_sessions, '[]'::jsonb),
    'schedule', v_schedule_json,
    'server_time', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Time in
-- ---------------------------------------------------------------------------
create or replace function public.time_in()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_employee public.employees;
  v_schedule uuid;
  v_probe_date date;
  v_work_date date;
  v_record public.attendance_records;
  v_session public.attendance_sessions;
  v_now timestamptz := now();
begin
  select * into v_employee
  from public.employees e
  where e.profile_id = v_uid
    and e.status = 'active';

  if not found then
    raise exception 'EMPLOYEE_NOT_ACTIVE'
      using errcode = '42501',
            detail = 'Your OJT account is not active yet.';
  end if;

  if exists (
    select 1 from public.attendance_sessions sess
    where sess.employee_id = v_employee.id
      and sess.time_out is null
  ) then
    raise exception 'ALREADY_TIMED_IN'
      using errcode = '55000',
            detail = 'You already have an open time-in.';
  end if;

  v_probe_date := (
    v_now at time zone private.schedule_timezone(v_employee.schedule_id)
  )::date;

  v_schedule := private.resolve_schedule(v_employee.id, v_probe_date);

  if v_schedule is null then
    raise exception 'SCHEDULE_NOT_ASSIGNED'
      using errcode = 'P0002',
            detail = 'No work schedule is assigned to your account yet.';
  end if;

  v_work_date := private.attendance_work_date(v_schedule, v_now);
  v_schedule := coalesce(
    private.resolve_schedule(v_employee.id, v_work_date),
    v_schedule
  );

  insert into public.attendance_records (employee_id, work_date, schedule_id)
  values (v_employee.id, v_work_date, v_schedule)
  on conflict (employee_id, work_date) do update
    set schedule_id = coalesce(public.attendance_records.schedule_id, excluded.schedule_id)
  returning * into v_record;

  insert into public.attendance_sessions (
    attendance_record_id, employee_id, work_date, time_in, source, created_by
  )
  values (v_record.id, v_employee.id, v_work_date, v_now, 'web', v_uid)
  returning * into v_session;

  v_record := private.recompute_attendance(v_record.id);

  return private.day_payload(v_employee.id, v_work_date, v_record.id)
    || jsonb_build_object('action', 'time_in', 'session', to_jsonb(v_session));
end;
$$;

-- ---------------------------------------------------------------------------
-- Time out
-- ---------------------------------------------------------------------------
create or replace function public.time_out()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_employee public.employees;
  v_session public.attendance_sessions;
  v_record public.attendance_records;
  v_schedule uuid;
  v_now timestamptz := now();
  v_worked integer;
begin
  select * into v_employee
  from public.employees e
  where e.profile_id = v_uid
    and e.status = 'active';

  if not found then
    raise exception 'EMPLOYEE_NOT_ACTIVE'
      using errcode = '42501',
            detail = 'Your OJT account is not active yet.';
  end if;

  select * into v_session
  from public.attendance_sessions sess
  where sess.employee_id = v_employee.id
    and sess.time_out is null
  for update;

  if not found then
    raise exception 'NOT_TIMED_IN'
      using errcode = '55000',
            detail = 'There is no open time-in to close.';
  end if;

  select * into v_record
  from public.attendance_records r
  where r.id = v_session.attendance_record_id
  for update;

  v_schedule := coalesce(
    v_record.schedule_id,
    private.resolve_schedule(v_employee.id, v_record.work_date)
  );

  select coalesce(
    round(
      sum(
        greatest(
          0,
          extract(epoch from (
            least(v_now, w.window_end) - greatest(v_session.time_in, w.window_start)
          )) / 60
        )
      )
    ),
    0
  )::integer
  into v_worked
  from private.paid_windows(v_schedule, v_record.work_date) w
  where v_session.time_in < w.window_end
    and v_now > w.window_start;

  if v_schedule is null then
    v_worked := greatest(
      0,
      round(extract(epoch from (v_now - v_session.time_in)) / 60)
    )::integer;
  end if;

  update public.attendance_sessions
     set time_out = v_now,
         worked_minutes = v_worked
   where id = v_session.id
   returning * into v_session;

  v_record := private.recompute_attendance(v_record.id);

  return private.day_payload(v_employee.id, v_record.work_date, v_record.id)
    || jsonb_build_object('action', 'time_out', 'session', to_jsonb(v_session));
end;
$$;

-- ---------------------------------------------------------------------------
-- Today's clock state for the signed-in employee
-- ---------------------------------------------------------------------------
create or replace function public.get_my_day(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_authenticated();
  v_employee public.employees;
  v_schedule uuid;
  v_work_date date;
  v_record_id uuid;
  v_record public.attendance_records;
  v_open public.attendance_sessions;
  v_holiday jsonb;
  v_is_work_day boolean := true;
begin
  select * into v_employee
  from public.employees e
  where e.profile_id = v_uid
    and e.status = 'active';

  if not found then
    raise exception 'EMPLOYEE_NOT_ACTIVE'
      using errcode = '42501',
            detail = 'Your OJT account is not active yet.';
  end if;

  v_schedule := private.resolve_schedule(v_employee.id, coalesce(p_date, current_date));
  v_work_date := coalesce(p_date, private.attendance_work_date(v_schedule, now()));

  if v_schedule is null and p_date is null then
    v_work_date := (now() at time zone 'Asia/Manila')::date;
  end if;

  v_schedule := coalesce(
    private.resolve_schedule(v_employee.id, v_work_date),
    v_schedule
  );

  select * into v_record
  from public.attendance_records r
  where r.employee_id = v_employee.id
    and r.work_date = v_work_date;

  v_record_id := v_record.id;

  select * into v_open
  from public.attendance_sessions sess
  where sess.employee_id = v_employee.id
    and sess.time_out is null
  limit 1;

  select to_jsonb(h) into v_holiday
  from public.holidays h
  where h.holiday_date = v_work_date;

  if v_schedule is not null then
    v_is_work_day := (
      select extract(isodow from v_work_date)::integer = any (s.work_days)
      from public.work_schedules s
      where s.id = v_schedule
    );
  end if;

  return private.day_payload(v_employee.id, v_work_date, v_record_id)
    || jsonb_build_object(
      'employee_id', v_employee.id,
      'employee_name', concat_ws(' ', v_employee.first_name, v_employee.last_name),
      'schedule_id', v_schedule,
      'is_work_day', coalesce(v_is_work_day, true),
      'holiday', v_holiday,
      'open_session', case when v_open.id is null then null else to_jsonb(v_open) end,
      'server_time', now()
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule administration
-- ---------------------------------------------------------------------------
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

create or replace function public.create_work_schedule(
  p_name text,
  p_description text default null,
  p_grace_minutes integer default 0,
  p_work_days smallint[] default '{1,2,3,4,5}'::smallint[],
  p_periods jsonb default '[]'::jsonb,
  p_assign_unassigned boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_schedule public.work_schedules;
  v_period jsonb;
  v_index integer := 0;
  v_assigned integer := 0;
  v_label text;
  v_start time;
  v_end time;
begin
  if char_length(v_name) not between 2 and 80 then
    raise exception 'SCHEDULE_NAME_INVALID' using errcode = '22023';
  end if;

  if p_grace_minutes is null or p_grace_minutes < 0 or p_grace_minutes > 120 then
    raise exception 'GRACE_INVALID' using errcode = '22023';
  end if;

  if p_work_days is null
     or cardinality(p_work_days) = 0
     or not (p_work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]) then
    raise exception 'WORK_DAYS_INVALID' using errcode = '22023';
  end if;

  if p_periods is null
     or jsonb_typeof(p_periods) <> 'array'
     or jsonb_array_length(p_periods) = 0
     or jsonb_array_length(p_periods) > 6 then
    raise exception 'PERIODS_INVALID'
      using errcode = '22023',
            detail = 'Provide between 1 and 6 paid periods.';
  end if;

  if exists (
    select 1 from public.work_schedules s where lower(btrim(s.name)) = lower(v_name)
  ) then
    raise exception 'SCHEDULE_NAME_TAKEN' using errcode = '23505';
  end if;

  insert into public.work_schedules (name, description, grace_minutes, work_days)
  values (v_name, v_description, p_grace_minutes, p_work_days)
  returning * into v_schedule;

  for v_period in select * from jsonb_array_elements(p_periods)
  loop
    v_index := v_index + 1;
    v_label := nullif(btrim(coalesce(v_period ->> 'label', '')), '');
    if v_label is null then
      v_label := format('Period %s', v_index);
    end if;

    begin
      v_start := (v_period ->> 'start')::time;
      v_end := (v_period ->> 'end')::time;
    exception when others then
      raise exception 'PERIOD_TIME_INVALID'
        using errcode = '22023',
              detail = 'Each period needs valid start and end times.';
    end;

    insert into public.schedule_periods (
      schedule_id, label, start_time, end_time, sort_order
    )
    values (v_schedule.id, v_label, v_start, v_end, v_index);
  end loop;

  if coalesce(p_assign_unassigned, true) then
    with updated as (
      update public.employees e
         set schedule_id = v_schedule.id
       where e.status = 'active'
         and e.schedule_id is null
      returning e.id
    )
    select count(*) into v_assigned from updated;

    insert into public.schedule_assignments (
      employee_id, schedule_id, effective_from, assigned_by
    )
    select e.id, v_schedule.id, current_date, v_uid
    from public.employees e
    where e.schedule_id = v_schedule.id
      and e.status = 'active'
      and not exists (
        select 1 from public.schedule_assignments a
        where a.employee_id = e.id
          and a.effective_to is null
      );
  end if;

  perform private.log_audit(
    'schedule.created',
    'work_schedule',
    v_schedule.id::text,
    format('Schedule "%s" created', v_schedule.name),
    null,
    jsonb_build_object(
      'name', v_schedule.name,
      'grace_minutes', v_schedule.grace_minutes,
      'work_days', v_schedule.work_days,
      'periods', p_periods,
      'assigned_employees', v_assigned
    )
  );

  return jsonb_build_object(
    'id', v_schedule.id,
    'name', v_schedule.name,
    'assigned_employees', v_assigned
  );
end;
$$;

create or replace function public.assign_schedule(
  p_employee_id uuid,
  p_schedule_id uuid,
  p_effective_from date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_employee public.employees;
  v_existing public.schedule_assignments;
begin
  select * into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.work_schedules s where s.id = p_schedule_id
  ) then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_existing
  from public.schedule_assignments a
  where a.employee_id = p_employee_id
    and a.effective_to is null
  order by a.effective_from desc
  limit 1;

  if v_existing.id is not null and v_existing.schedule_id = p_schedule_id then
    update public.employees set schedule_id = p_schedule_id where id = p_employee_id;
    return jsonb_build_object('employee_id', p_employee_id, 'schedule_id', p_schedule_id, 'changed', false);
  end if;

  if v_existing.id is not null then
    if v_existing.effective_from >= p_effective_from then
      delete from public.schedule_assignments where id = v_existing.id;
    else
      update public.schedule_assignments
         set effective_to = p_effective_from - 1
       where id = v_existing.id;
    end if;
  end if;

  insert into public.schedule_assignments (
    employee_id, schedule_id, effective_from, assigned_by
  )
  values (p_employee_id, p_schedule_id, p_effective_from, v_uid);

  update public.employees
     set schedule_id = p_schedule_id
   where id = p_employee_id;

  perform private.log_audit(
    'schedule.assigned',
    'employee',
    p_employee_id::text,
    'Work schedule assigned',
    jsonb_build_object('schedule_id', v_employee.schedule_id),
    jsonb_build_object('schedule_id', p_schedule_id, 'effective_from', p_effective_from)
  );

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'schedule_id', p_schedule_id,
    'effective_from', p_effective_from,
    'changed', true
  );
end;
$$;

create or replace function public.assign_schedule_to_unassigned(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_employee public.employees;
  v_count integer := 0;
begin
  if not exists (select 1 from public.work_schedules s where s.id = p_schedule_id) then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0002';
  end if;

  for v_employee in
    select * from public.employees e
    where e.status = 'active'
      and e.schedule_id is null
    for update
  loop
    update public.employees set schedule_id = p_schedule_id where id = v_employee.id;

    insert into public.schedule_assignments (
      employee_id, schedule_id, effective_from, assigned_by
    )
    values (v_employee.id, p_schedule_id, current_date, v_uid);

    v_count := v_count + 1;
  end loop;

  perform private.log_audit(
    'schedule.assigned_bulk',
    'work_schedule',
    p_schedule_id::text,
    format('Schedule assigned to %s unassigned employee(s)', v_count),
    null,
    jsonb_build_object('assigned', v_count)
  );

  return jsonb_build_object('assigned_employees', v_count);
end;
$$;

create or replace function public.ensure_default_schedule()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := private.require_role(array['admin']::public.user_role[]);
  v_schedule public.work_schedules;
  v_assigned integer := 0;
begin
  select * into v_schedule
  from public.work_schedules s
  order by s.created_at
  limit 1;

  if v_schedule.id is not null then
    return jsonb_build_object(
      'id', v_schedule.id,
      'name', v_schedule.name,
      'created', false
    );
  end if;

  insert into public.work_schedules (name, description, grace_minutes, work_days)
  values (
    'OJT Standard',
    'Monday to Friday, 8:00-12:00 and 13:00-17:00',
    10,
    '{1,2,3,4,5}'::smallint[]
  )
  returning * into v_schedule;

  insert into public.schedule_periods (schedule_id, label, start_time, end_time, sort_order)
  values
    (v_schedule.id, 'Morning', '08:00', '12:00', 1),
    (v_schedule.id, 'Afternoon', '13:00', '17:00', 2);

  with updated as (
    update public.employees e
       set schedule_id = v_schedule.id
     where e.status = 'active'
       and e.schedule_id is null
    returning e.id
  )
  select count(*) into v_assigned from updated;

  insert into public.schedule_assignments (
    employee_id, schedule_id, effective_from, assigned_by
  )
  select e.id, v_schedule.id, current_date, v_uid
  from public.employees e
  where e.schedule_id = v_schedule.id
    and e.status = 'active'
    and not exists (
      select 1 from public.schedule_assignments a
      where a.employee_id = e.id
        and a.effective_to is null
    );

  perform private.log_audit(
    'schedule.created',
    'work_schedule',
    v_schedule.id::text,
    'Default OJT schedule created',
    null,
    jsonb_build_object('assigned_employees', v_assigned)
  );

  return jsonb_build_object(
    'id', v_schedule.id,
    'name', v_schedule.name,
    'created', true,
    'assigned_employees', v_assigned
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.time_in() from public;
revoke all on function public.time_out() from public;
revoke all on function public.get_my_day(date) from public;
revoke all on function public.list_work_schedules() from public;
revoke all on function public.create_work_schedule(text, text, integer, smallint[], jsonb, boolean) from public;
revoke all on function public.assign_schedule(uuid, uuid, date) from public;
revoke all on function public.assign_schedule_to_unassigned(uuid) from public;
revoke all on function public.ensure_default_schedule() from public;

grant execute on function public.time_in() to authenticated;
grant execute on function public.time_out() to authenticated;
grant execute on function public.get_my_day(date) to authenticated;
grant execute on function public.list_work_schedules() to authenticated;
grant execute on function public.create_work_schedule(text, text, integer, smallint[], jsonb, boolean) to authenticated;
grant execute on function public.assign_schedule(uuid, uuid, date) to authenticated;
grant execute on function public.assign_schedule_to_unassigned(uuid) to authenticated;
grant execute on function public.ensure_default_schedule() to authenticated;

commit;
