-- Activating a batch must not change what a code IS.
--
-- activate_business_cards (0018) stamped source='business' and overwrote the
-- label with the profile name, carried over from the finishBatchScan it
-- replaced. Two things break:
--
--   * a NOTE stops being a note. source='business' means "the shop's own code,
--     scanned off a counter" and suppresses the gift roles, so a business that
--     prints Duyen notes and attaches its profile loses the giving and
--     receiving choice — the whole point of a note. The single-claim path
--     already guards this ("claimed notes stay notes"); the batch path did the
--     opposite.
--   * the label is overwritten. On a product tag that label is the serial
--     PRINTED ON THE STICKER, so the row would say "Gap" while the sticker in
--     someone's hand says P-0001 and nothing ties them together again.
--
-- Attaching a profile now attaches a profile: business_data, ownership and the
-- activation stamp. What the code is, and what is printed on it, are left alone.

create or replace function public.activate_business_cards(p_urls text[], p_profile jsonb)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_urls is null or array_length(p_urls, 1) is null then return 0; end if;

  with updated as (
    update public.qr_codes
       set business_data    = p_profile,
           business_user_id = v_uid,
           activated_at     = coalesce(activated_at, now()),
           updated_at       = now()
           -- source and label deliberately untouched: a note stays a note, a
           -- product tag stays a product tag, and a printed serial stays the
           -- number on the sticker.
     where url = any(p_urls)
       and (business_user_id is null or business_user_id = v_uid)
    returning 1
  )
  select count(*) into v_count from updated;

  return v_count;
end $$;

comment on function public.activate_business_cards(text[], jsonb) is
  'Attach a business profile to a batch of scanned cards. Leaves source and label alone, so notes stay notes and printed serials survive.';
