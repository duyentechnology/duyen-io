-- Fix a regression from 0016: businesses could no longer activate scanned cards.
--
-- finishBatchScan (dayduyen) claims a stack of printed cards with a filtered
-- update:  update qr_codes set ... where url = $1
--
-- A filtered UPDATE references a column, so PostgreSQL applies SELECT policies
-- as well as the UPDATE policy. While "Anyone can read QR codes" existed, that
-- was free. With it gone, a business cannot SEE an unclaimed card, so the
-- update matched nothing — it returned 204 with zero rows changed and the app
-- reported "No QR codes were activated".
--
-- Verified against this database: the raw update claims nothing, while the
-- existing claim_card_as_business (SECURITY DEFINER) still works. Batch
-- activation gets the same treatment rather than a policy that would re-expose
-- every unclaimed card — some of those carry gift messages.
--
-- Also the first thing to stamp activated_at (0013): this is the moment a
-- printed card stops being stock and starts being something.

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
       set business_data     = p_profile,
           business_user_id  = v_uid,
           label             = coalesce(nullif(p_profile->>'name', ''), label),
           source            = 'business',
           -- Set once: the first time this card went live, never overwritten.
           activated_at      = coalesce(activated_at, now()),
           updated_at        = now()
     where url = any(p_urls)
       -- Only unclaimed cards, or ones already this business's own. A card
       -- belonging to another business is skipped, not stolen.
       and (business_user_id is null or business_user_id = v_uid)
    returning 1
  )
  select count(*) into v_count from updated;

  return v_count;
end $$;

revoke all on function public.activate_business_cards(text[], jsonb) from public;
grant execute on function public.activate_business_cards(text[], jsonb) to authenticated;

comment on function public.activate_business_cards(text[], jsonb) is
  'Claim a batch of scanned cards for the calling business. Skips cards owned by another business. Stamps activated_at once.';
