-- Atomic save for external (scanned/pasted) links.
--
-- The client used to write the qr_codes row and the tapestry row in two
-- separate REST calls. If anything interrupted the client between them
-- (network drop, tab closed on flaky mobile data), the qr_codes row was left
-- with no tapestry entry — an invisible orphan — and the user, seeing nothing
-- saved, would save again, producing a second row. This RPC does both inserts
-- in a single transaction: the save either fully lands or not at all, so an
-- interrupted save can never leave an orphan.
--
-- SECURITY DEFINER + auth.uid(): the row owner is always the authenticated
-- caller; callers cannot write rows for anyone else. search_path is pinned.

create or replace function public.save_external_link(
  p_url         text,
  p_title       text,
  p_notes       text        default '',
  p_media       jsonb       default null,
  p_voice       text        default null,
  p_giver_data  jsonb       default null,
  p_occurred_at timestamptz default null
)
returns table (qr_id uuid, tapestry_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_qr  uuid;
  v_tap uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into qr_codes (user_id, url, label, details, source, media, voice, status, giver_data)
  values (v_uid, p_url, p_title, coalesce(p_notes, ''), 'external', p_media, p_voice, 'active', p_giver_data)
  returning id into v_qr;

  insert into tapestry (user_id, qr_code_id, role, title, note, occurred_at)
  values (v_uid, v_qr, 'external', p_title, p_url, p_occurred_at)
  returning id into v_tap;

  return query select v_qr, v_tap;
end;
$$;

revoke all on function public.save_external_link(text, text, text, jsonb, text, jsonb, timestamptz) from public, anon;
grant execute on function public.save_external_link(text, text, text, jsonb, text, jsonb, timestamptz) to authenticated;
