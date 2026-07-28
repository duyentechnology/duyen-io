-- 0005: Stripe grants for the duyen.tech business tiers
-- ---------------------------------------------------------------------------
-- These SECURITY DEFINER functions are the ONLY writers of paid entitlements on
-- business_accounts. They are called exclusively by the Stripe webhook using the
-- service role — no grant to `authenticated`, so a client can never self-upgrade.
--
-- Tier → effect:
--   $20 one-time            → business_grant_generator  (has_generator = true)
--   $9.99/mo  (insights)    → business_set_plan('insights','active', …)
--   $19.99/mo (boutique)    → business_set_plan('boutique','active', …)
-- Subscription lifecycle (renew / dunning / cancel) → business_update_sub_status.

-- One-time $20: unlock the single-QR generator. Idempotent (re-runs are no-ops
-- beyond refreshing the customer id).
create or replace function public.business_grant_generator(p_user uuid, p_customer text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into business_accounts(user_id, origin, has_generator, stripe_customer_id)
    values (p_user, 'direct', true, p_customer)
  on conflict (user_id) do update
    set has_generator      = true,
        stripe_customer_id = coalesce(excluded.stripe_customer_id, business_accounts.stripe_customer_id),
        updated_at         = now();
end $$;

-- Subscription purchase: activate the plan and record the Stripe ids so later
-- lifecycle events (keyed by subscription id) can find this row.
create or replace function public.business_set_plan(
  p_user uuid, p_plan text, p_status text,
  p_sub text, p_customer text, p_renews timestamptz)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_plan   not in ('none','insights','boutique')                 then raise exception 'bad plan %',   p_plan;   end if;
  if p_status not in ('inactive','active','past_due','canceled')    then raise exception 'bad status %', p_status; end if;
  insert into business_accounts(user_id, plan, plan_status, stripe_subscription_id, stripe_customer_id, renews_at)
    values (p_user, p_plan, p_status, p_sub, p_customer, p_renews)
  on conflict (user_id) do update
    set plan                   = excluded.plan,
        plan_status            = excluded.plan_status,
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, business_accounts.stripe_subscription_id),
        stripe_customer_id     = coalesce(excluded.stripe_customer_id,     business_accounts.stripe_customer_id),
        renews_at              = excluded.renews_at,
        updated_at             = now();
end $$;

-- Subscription lifecycle keyed by Stripe subscription id: renewals (active),
-- failed payments (past_due), cancellations (canceled). Entitlements in
-- get_my_entitlements() gate on plan_status = 'active', so flipping the status
-- here is enough to grant/revoke access without touching `plan`.
create or replace function public.business_update_sub_status(
  p_sub text, p_status text, p_renews timestamptz)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_status not in ('inactive','active','past_due','canceled') then raise exception 'bad status %', p_status; end if;
  update business_accounts
    set plan_status = p_status,
        renews_at   = coalesce(p_renews, renews_at),
        updated_at  = now()
  where stripe_subscription_id = p_sub;
end $$;

-- Service role only — the webhook. Never grant to authenticated.
revoke all on function public.business_grant_generator(uuid, text)            from public, authenticated, anon;
revoke all on function public.business_set_plan(uuid, text, text, text, text, timestamptz) from public, authenticated, anon;
revoke all on function public.business_update_sub_status(text, text, timestamptz)          from public, authenticated, anon;
