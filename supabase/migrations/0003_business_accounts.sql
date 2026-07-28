-- 0003: Business accounts / entitlements  (duyen.tech business tiers)
-- ---------------------------------------------------------------------------
-- One row per business user — the single source of truth for what a business
-- has unlocked. Every business feature (generator, analytics, minting) gates
-- off this row. Writes go through SECURITY DEFINER functions or the service
-- role (the Stripe webhook, later); clients can only READ their own row.
--
-- Entitlement ladder:
--   free (claimed a Duyen Note card) -> has_generator = true, origin = 'card'
--   $20 one-time                     -> has_generator = true, origin = 'direct'
--   +$9.99/mo  (plan 'insights')     -> analytics + push promotions
--   +$19.99/mo (plan 'boutique')     -> multi-QR minting @ $0.10 (mint_credits)

create table if not exists public.business_accounts (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  origin                 text not null default 'direct'   check (origin in ('card','direct')),
  has_generator          boolean not null default false,  -- single-QR generator unlocked
  plan                   text not null default 'none'     check (plan in ('none','insights','boutique')),
  plan_status            text not null default 'inactive' check (plan_status in ('inactive','active','past_due','canceled')),
  mint_credits           integer not null default 0       check (mint_credits >= 0), -- prepaid $0.10 QR credits (count)
  stripe_customer_id     text,
  stripe_subscription_id text,
  renews_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.business_accounts enable row level security;

-- Read-only access to your own row; no direct client writes.
drop policy if exists business_accounts_select_own on public.business_accounts;
create policy business_accounts_select_own on public.business_accounts
  for select using (auth.uid() = user_id);

-- Return the caller's business account, creating it on first touch.
create or replace function public.get_or_create_business_account()
returns public.business_accounts
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_row public.business_accounts;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_row from business_accounts where user_id = v_uid;
  if not found then
    insert into business_accounts(user_id) values (v_uid)
      on conflict (user_id) do nothing;
    select * into v_row from business_accounts where user_id = v_uid;
  end if;
  return v_row;
end $$;

-- Compact entitlement snapshot for the frontend gate. Business rules live here
-- (server-side), so the UI only ever checks the boolean flags this returns.
create or replace function public.get_my_entitlements()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_row public.business_accounts;
begin
  v_row := public.get_or_create_business_account();
  return jsonb_build_object(
    'origin',              v_row.origin,
    'plan',                v_row.plan,
    'plan_status',         v_row.plan_status,
    'mint_credits',        v_row.mint_credits,
    'can_generate_single', v_row.has_generator,
    'can_view_analytics',  (v_row.plan in ('insights','boutique') and v_row.plan_status = 'active'),
    'can_push',            (v_row.plan in ('insights','boutique') and v_row.plan_status = 'active'),
    'can_mint',            (v_row.plan = 'boutique' and v_row.plan_status = 'active')
  );
end $$;

grant execute on function public.get_or_create_business_account() to authenticated;
grant execute on function public.get_my_entitlements()            to authenticated;

-- Keep updated_at fresh on every write.
create or replace function public.touch_business_accounts_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_business_accounts_touch on public.business_accounts;
create trigger trg_business_accounts_touch
  before update on public.business_accounts
  for each row execute function public.touch_business_accounts_updated_at();
