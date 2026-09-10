-- Make save_external_link idempotent for retries.
--
-- The atomic version (20260820) removed orphan rows, but each call still
-- INSERTs a fresh qr_codes + tapestry pair. On flaky convention wifi a save
-- with a photo/video can commit on the server yet time out before the client
-- gets the response — the client shows "failed", the user taps Save again, and
-- a full duplicate (new qr_codes + new tapestry row) is created. Observed in the
-- field: the same qrco.de link saved twice, 19 seconds apart.
--
-- Fix: before inserting, reuse this user's existing external save of the SAME
-- url made within a short window (retry/double-tap), returning its ids instead
-- of creating a second copy. The window (not a permanent unique key) is
-- deliberate — the tapestry is a life log, so re-saving the same place on a
-- different day is a legitimate new moment and must still be allowed. Empty
-- urls are never deduped (an empty url is not a meaningful key).

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
  v_uid    uuid := auth.uid();
  v_qr     uuid;
  v_tap    uuid;
  v_window constant interval := interval '30 minutes';
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Idempotency window: a recent identical save by the same user is treated as
  -- a retry, not a new moment. Only matches rows that already have a tapestry
  -- entry, so a true orphan (should not exist post-20260820) is never reused.
  if coalesce(p_url, '') <> '' then
    select q.id, t.id
      into v_qr, v_tap
      from qr_codes q
      join tapestry t
        on t.qr_code_id = q.id and t.user_id = v_uid and t.role = 'external'
     where q.user_id = v_uid
       and q.source = 'external'
       and q.url = p_url
       and q.created_at >= now() - v_window
     order by q.created_at desc
     limit 1;

    if v_qr is not null then
      -- Backfill anything the first attempt lacked (defensive; a retry usually
      -- carries the same payload). Never overwrites existing content.
      update qr_codes set
        media      = coalesce(media, p_media),
        voice      = coalesce(voice, p_voice),
        giver_data = coalesce(giver_data, p_giver_data),
        details    = case when coalesce(details, '') = '' then coalesce(p_notes, '') else details end
       where id = v_qr;
      return query select v_qr, v_tap;
      return;
    end if;
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
