CREATE OR REPLACE FUNCTION public.claim_card_as_business(p_qr_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_qr  qr_codes;
  v_profile jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select * into v_qr from qr_codes where id = p_qr_id for update;
  if not found then raise exception 'qr_not_found'; end if;

  if v_qr.business_user_id is not null and v_qr.business_user_id <> v_uid then
    raise exception 'already_claimed';
  end if;

  -- The claimer's primary business profile (null before first profile setup;
  -- the app attaches it right after profile creation in that case).
  select business_profiles->0 into v_profile
    from profiles
   where id = v_uid
     and jsonb_typeof(business_profiles) = 'array'
     and jsonb_array_length(business_profiles) > 0;

  -- Link the card to this business (idempotent if already theirs) and attach
  -- their profile. The QR's source is left untouched: claimed notes stay
  -- notes; only admin-minted business-profile QRs carry source='business'
  -- (stamped at generation), which is what unlocks the design studio.
  update qr_codes
     set business_user_id = v_uid,
         business_data = coalesce(v_profile, business_data)
   where id = p_qr_id;

  -- Ensure a business account exists and mark it card-origin (free hosting).
  -- Does NOT grant has_generator: generating NEW QR codes still requires the
  -- $20 single tier or the Boutique plan.
  perform get_or_create_business_account();
  update business_accounts
     set origin = 'card', updated_at = now()
   where user_id = v_uid and origin = 'direct';

  return jsonb_build_object('ok', true, 'qr_id', v_qr.id, 'label', v_qr.label, 'url', v_qr.url);
end
$function$
