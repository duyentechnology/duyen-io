-- The $20 unlocks ONE business profile, not the whole account.
--
-- Until now has_generator was an account-wide boolean, so a business that paid
-- once could mint a code for every profile they later added. The purchase now
-- names the profile it unlocks, and each further profile costs $20 again.
--
-- has_generator stays as "has ever paid" — it still drives the ladder in the
-- plans list — but minting and the design studio are decided per profile.

alter table public.business_accounts
    add column if not exists unlocked_profiles jsonb not null default '[]'::jsonb;

comment on column public.business_accounts.unlocked_profiles is
    'profileIds this business has paid $20 to unlock. One entry per purchase.';

-- Grandfather anyone who already paid: their first profile is unlocked, so a
-- prior purchase keeps working exactly as it did.
update public.business_accounts b
   set unlocked_profiles = jsonb_build_array(p.business_profiles->0->>'profileId')
  from public.profiles p
 where p.id = b.user_id
   and b.has_generator
   and b.unlocked_profiles = '[]'::jsonb
   and p.business_profiles->0->>'profileId' is not null;

-- Called by the Stripe webhook once payment for a specific profile completes.
create or replace function public.business_unlock_profile(
    p_user uuid, p_profile text, p_customer text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into business_accounts(user_id, origin, has_generator, stripe_customer_id, unlocked_profiles)
    values (p_user, 'direct', true, p_customer,
            case when p_profile is null or p_profile = '' then '[]'::jsonb
                 else jsonb_build_array(p_profile) end)
  on conflict (user_id) do update
    set has_generator      = true,
        stripe_customer_id = coalesce(excluded.stripe_customer_id, business_accounts.stripe_customer_id),
        -- append, never duplicate: paying twice for the same profile is a no-op
        unlocked_profiles  = case
            when p_profile is null or p_profile = '' then business_accounts.unlocked_profiles
            when business_accounts.unlocked_profiles @> to_jsonb(p_profile) then business_accounts.unlocked_profiles
            else business_accounts.unlocked_profiles || to_jsonb(p_profile)
        end,
        updated_at         = now();

  -- Paying also opens the memory layer on the codes this business owns.
  update qr_codes
     set memory_enabled = true, updated_at = now()
   where business_user_id = p_user
     and memory_enabled = false;
end $function$;

-- Expose the list to the app.
create or replace function public.get_my_entitlements()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.business_accounts;
begin
  v_row := public.get_or_create_business_account();
  return jsonb_build_object(
    'origin',              v_row.origin,
    'plan',                v_row.plan,
    'plan_status',         v_row.plan_status,
    'mint_credits',        v_row.mint_credits,
    'can_generate_single', v_row.has_generator,
    'unlocked_profiles',   coalesce(v_row.unlocked_profiles, '[]'::jsonb),
    'can_view_analytics',  (v_row.plan in ('insights','boutique') and v_row.plan_status = 'active'),
    'can_push',            (v_row.plan in ('insights','boutique') and v_row.plan_status = 'active'),
    'can_mint',            (v_row.plan = 'boutique' and v_row.plan_status = 'active')
  );
end $function$;
