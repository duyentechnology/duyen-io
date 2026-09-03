-- get_my_entitlements() drove the business app's per-profile paywall, but it
-- never returned unlocked_profiles (or has_generator). So on the client
-- ent().unlocked_profiles was always undefined, profileUnlocked() always read
-- false for a generator-only account, and every already-paid profile still
-- showed "Generate this profile's QR — $10" — tapping it would charge again and
-- never reach design & print.
--
-- Expose the two missing fields. Purely additive: every existing key is
-- unchanged, so no client relying on the old shape breaks.
CREATE OR REPLACE FUNCTION public.get_my_entitlements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row public.business_accounts;
begin
  v_row := public.get_or_create_business_account();
  return jsonb_build_object(
    'origin',              v_row.origin,
    'plan',                v_row.plan,
    'plan_status',         v_row.plan_status,
    'mint_credits',        v_row.mint_credits,
    'modular_credits',     v_row.modular_credits,
    'has_generator',       v_row.has_generator,
    'unlocked_profiles',   coalesce(v_row.unlocked_profiles, '[]'::jsonb),
    'can_generate_single', v_row.has_generator,
    'can_view_analytics',  (v_row.plan in ('insights','boutique') and v_row.plan_status = 'active'),
    'can_push',            (v_row.plan in ('insights','boutique') and v_row.plan_status = 'active'),
    'can_mint',            (v_row.plan = 'boutique' and v_row.plan_status = 'active')
  );
end $function$;
