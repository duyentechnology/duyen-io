-- Attach an item to a batch of just-activated tags.
--
-- The dayduyen "Activate a QR code" flow scans a stack of printed tags and
-- attaches the business profile to all of them in one call
-- (activate_business_cards, 0022). That call writes only the profile: it
-- deliberately leaves source and label alone so a note stays a note.
--
-- The product module is the other half. After the profile is attached, the
-- business can describe the ITEM the tags are stuck on — up to three photos and
-- a line of details — and that has to land on every tag in the batch, on the
-- shared qr_codes row rather than the profile (the menu and the "about" photos
-- stay on the profile; the item is per-tag).
--
-- Those columns cannot be written from the client. After 0016/0017 the only
-- UPDATE policies left on qr_codes are the creator's own rows (auth.uid() =
-- user_id) and the claim-an-unclaimed-code path. A business's activated product
-- tags are neither: their user_id is the admin who printed the stock, and their
-- business_user_id is the business. So, exactly like activate_business_cards,
-- this is a SECURITY DEFINER function scoped to the caller's own claimed cards.
--
-- source becomes 'product' here on purpose. That is the kind duyen.io keys on
-- to lead with the item and keep the gift roles (renderProductItemBlock, the
-- data.source === 'product' branch) — it is what makes the tag render the item
-- at all. It is set only when the business actually attaches an item, never by
-- the bare profile attach.

create or replace function public.attach_product_to_cards(
  p_urls    text[],
  p_details text,
  p_photo   text,
  p_media   jsonb
)
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
       set details      = p_details,
           photo        = p_photo,
           media        = coalesce(p_media, '[]'::jsonb),
           source       = 'product',
           -- Set once, in case this is the first time the tag goes live; a tag
           -- already stamped by activate_business_cards keeps its stamp.
           activated_at = coalesce(activated_at, now()),
           updated_at   = now()
     -- Only the caller's own claimed cards. A tag activate_business_cards
     -- skipped (owned by another business) is skipped here too.
     where url = any(p_urls)
       and business_user_id = v_uid
    returning 1
  )
  select count(*) into v_count from updated;

  return v_count;
end $$;

revoke all on function public.attach_product_to_cards(text[], text, text, jsonb) from public;
grant execute on function public.attach_product_to_cards(text[], text, text, jsonb) to authenticated;

comment on function public.attach_product_to_cards(text[], text, text, jsonb) is
  'Attach an item (details + photo/media) to a batch of the caller''s own claimed tags and mark them source=product. Used by the dayduyen activation flow after the profile is attached.';
