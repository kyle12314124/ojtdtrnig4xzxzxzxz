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
