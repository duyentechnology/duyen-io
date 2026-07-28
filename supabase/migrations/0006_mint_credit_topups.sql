-- 0006: Boutique mint-credit top-ups ($0.10 per QR)
-- ---------------------------------------------------------------------------
-- Boutique subscribers pay $0.10 per generated QR via prepaid mint_credits
-- (spent by spend_mint_credits). This adds the *purchase* side: the Stripe
-- webhook credits mint_credits after a top-up checkout. Idempotent per Stripe
-- session id via a small ledger, so a webhook retry never double-credits.

create table if not exists public.business_credit_ledger (
  ref        text primary key,                                   -- stripe session id
  user_id    uuid not null references auth.users(id) on delete cascade,
  qty        integer not null check (qty > 0),
  created_at timestamptz not null default now()
);
alter table public.business_credit_ledger enable row level security;
-- No policies: service role (the webhook) only. Clients never read/write it.

-- Add mint credits after a purchase. Idempotent per p_ref (Stripe session id).
-- Returns the new mint_credits balance.
create or replace function public.business_add_mint_credits(p_user uuid, p_qty integer, p_ref text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_new integer;
begin
  if p_qty is null or p_qty < 1 then raise exception 'invalid quantity'; end if;

  insert into business_credit_ledger(ref, user_id, qty) values (p_ref, p_user, p_qty)
    on conflict (ref) do nothing;
  if not found then
    -- already processed this session — return current balance unchanged
    select mint_credits into v_new from business_accounts where user_id = p_user;
    return coalesce(v_new, 0);
  end if;

  insert into business_accounts(user_id, mint_credits) values (p_user, p_qty)
    on conflict (user_id) do update
      set mint_credits = business_accounts.mint_credits + excluded.mint_credits,
          updated_at   = now();
  select mint_credits into v_new from business_accounts where user_id = p_user;
  return coalesce(v_new, 0);
end $$;

-- Service role only — the webhook. Never grant to authenticated.
revoke all on function public.business_add_mint_credits(uuid, integer, text) from public, authenticated, anon;
