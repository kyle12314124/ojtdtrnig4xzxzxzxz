-- ===========================================================================
-- Bootstrap the FIRST administrator (run once, manually).
--
-- 1. Authentication → Users → Add user. Create the account with a strong
--    password and confirm the email.
-- 2. Replace the email below.
-- 3. Run this entire file in the Supabase SQL editor.
--
-- This is intentionally NOT an RPC. It must never be reachable from the app.
-- Every later role change goes through an audited administrator action.
-- ===========================================================================

do $$
declare
  v_email text := 'admin@example.com'; -- <-- CHANGE THIS
  v_profile public.profiles;
  v_first text;
  v_last text;
  v_employee_no text;
begin
  select *
    into v_profile
  from public.profiles
  where lower(email) = lower(btrim(v_email));

  if v_profile.id is null then
    raise exception
      'No profile exists for %. Create the user under Authentication → Users first, then re-run this script.',
      v_email;
  end if;

  update public.profiles
     set role = 'admin',
         is_active = true
   where id = v_profile.id;

  if not exists (
    select 1 from public.employees e where e.profile_id = v_profile.id
  ) then
    v_first := split_part(v_profile.full_name, ' ', 1);
    v_last := nullif(btrim(substr(v_profile.full_name, length(v_first) + 1)), '');
    if v_last is null then
      v_last := 'Administrator';
    end if;

    -- Stable, collision-resistant placeholder employee number.
    v_employee_no := 'ADMIN-' || upper(substr(replace(v_profile.id::text, '-', ''), 1, 8));

    insert into public.employees (
      profile_id, employee_no, first_name, last_name, email,
      position, employment_type, date_hired, status
    )
    values (
      v_profile.id, v_employee_no, v_first, v_last, v_profile.email,
      'Administrator', 'regular', current_date, 'active'
    )
    on conflict (profile_id) do nothing;
  end if;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, summary
  )
  values (
    v_profile.id, 'admin', 'admin.bootstrap', 'profile', v_profile.id::text,
    'First administrator bootstrapped manually'
  );

  raise notice 'Administrator ready: % (profile %)', v_profile.email, v_profile.id;
end;
$$;
