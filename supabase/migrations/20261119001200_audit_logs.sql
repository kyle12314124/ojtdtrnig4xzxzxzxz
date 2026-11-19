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
