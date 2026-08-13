-- Modular pricing for the business app.
--
--   $20 one-time  → profile unlock (has_generator) + 1 modular credit
--   $10 one-time  → +1 modular credit
--   generating a modular (product/menu QR) spends 1 modular credit
--
-- A "modular" is one generated QR = the business profile + one modular's
-- content (a product, a menu, …). The first is bundled into the $20; each
-- additional is $10. This mirrors the boutique mint-credit design exactly
-- (0006): a service-role grant on purchase, idempotent per Stripe ref, and a
-- balance on business_accounts. It adds nothing to existing behaviour — the
-- column defaults to 0, so no current account is affected.

-- 1. The balance.
alter table public.business_accounts
  add column if not exists modular_credits integer not null default 0
    check (modular_credits >= 0);

-- 2. Purchase side (the Stripe webhook, service role). Idempotent per Stripe
--    session id via its own ledger, kept separate from mint credits.
create table if not exists public.business_modular_ledger (
  ref        text primary key,                        -- stripe session id (+suffix)
  user_id    uuid not null references auth.users(id) on delete cascade,
  qty        integer not null check (qty > 0),
  created_at timestamptz not null default now()
);
alter table public.business_modular_ledger enable row level security;
-- No policies: service role only. Clients never read or write it.

create or replace function public.business_add_modular_credits(p_user uuid, p_qty integer, p_ref text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_new integer;
begin
  if p_qty is null or p_qty < 1 then raise exception 'invalid quantity'; end if;

  insert into business_modular_ledger(ref, user_id, qty) values (p_ref, p_user, p_qty)
    on conflict (ref) do nothing;
  if not found then
    -- already processed this Stripe session — return balance unchanged
    select modular_credits into v_new from business_accounts where user_id = p_user;
    return coalesce(v_new, 0);
  end if;

  insert into business_accounts(user_id, modular_credits) values (p_user, p_qty)
    on conflict (user_id) do update
      set modular_credits = business_accounts.modular_credits + excluded.modular_credits,
          updated_at      = now();
  select modular_credits into v_new from business_accounts where user_id = p_user;
  return coalesce(v_new, 0);
end $$;

revoke all on function public.business_add_modular_credits(uuid, integer, text) from public, authenticated, anon;
-- service role (webhook) only — no grant to authenticated.

-- 3. Spend + create. Authenticated: spends one modular credit and creates the
--    code = the caller's business profile + this modular's content. Atomic, so
--    the credit is the paywall. Returns { id, url, code, credits_left }.
create or replace function public.create_modular_qr(
  p_label         text,
  p_details       text,
  p_photo         text,
  p_media         jsonb,
  p_business_data jsonb,
  p_source        text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_left integer;
  v_code text;
  v_url  text;
  v_id   uuid;
  v_src  text := coalesce(nullif(p_source, ''), 'product');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- Spend one credit atomically; refuse if the balance is empty.
  update public.business_accounts
     set modular_credits = modular_credits - 1, updated_at = now()
   where user_id = v_uid and modular_credits > 0
  returning modular_credits into v_left;
  if not found then raise exception 'no_modular_credit'; end if;

  -- Unique 7-char short code, same scheme as client generation (/q/<code>).
  loop
    v_code := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 7));
    v_url  := 'https://duyen.io/q/' || v_code;
    exit when not exists (select 1 from public.qr_codes where url = v_url);
  end loop;

  insert into public.qr_codes
    (user_id, business_user_id, url, label, details, photo, media,
     business_data, source, status, activated_at, created_at, updated_at)
  values
    (v_uid, v_uid, v_url, nullif(p_label, ''), p_details, p_photo,
     coalesce(p_media, '[]'::jsonb), p_business_data, v_src, 'active', now(), now(), now())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'url', v_url, 'code', v_code, 'credits_left', v_left);
end $$;

revoke all on function public.create_modular_qr(text, text, text, jsonb, jsonb, text) from public;
grant execute on function public.create_modular_qr(text, text, text, jsonb, jsonb, text) to authenticated;

comment on function public.create_modular_qr(text, text, text, jsonb, jsonb, text) is
  'Spend one modular credit and create the caller''s modular QR (profile + modular content). Paywall is the atomic credit spend.';

-- 4. Surface the balance to the frontend gate (additive field).
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
    'modular_credits',     v_row.modular_credits,
    'can_generate_single', v_row.has_generator,
    'can_view_analytics',  (v_row.plan in ('insights','boutique') and v_row.plan_status = 'active'),
    'can_push',            (v_row.plan in ('insights','boutique') and v_row.plan_status = 'active'),
    'can_mint',            (v_row.plan = 'boutique' and v_row.plan_status = 'active')
  );
end $$;
grant execute on function public.get_my_entitlements() to authenticated;
