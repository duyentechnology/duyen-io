-- Phase 2: token wallet for "Send a moment"
-- ---------------------------------------------------------------------------
-- wallets       — one row per user, the live balance
-- token_ledger  — append-only audit of every credit/debit (source of truth)
-- All writes go through SECURITY DEFINER functions (below) or the service role
-- (the Stripe webhook). Clients can only READ their own rows.

create table if not exists public.wallets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.token_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      integer not null,                       -- + credited / - spent
  reason     text not null check (reason in ('signup_bonus','purchase','send','refund','adjust')),
  ref        text,                                   -- stripe session id, qr_code id, etc.
  created_at timestamptz not null default now()
);
create index if not exists token_ledger_user_idx on public.token_ledger(user_id, created_at desc);
-- Idempotency guard: at most one ledger row per (reason, ref) when ref is set.
create unique index if not exists token_ledger_reason_ref_uniq
  on public.token_ledger(reason, ref) where ref is not null;

alter table public.wallets      enable row level security;
alter table public.token_ledger enable row level security;

-- Read-only access to your own rows; no direct client writes.
drop policy if exists wallets_select_own on public.wallets;
create policy wallets_select_own on public.wallets
  for select using (auth.uid() = user_id);

drop policy if exists ledger_select_own on public.token_ledger;
create policy ledger_select_own on public.token_ledger
  for select using (auth.uid() = user_id);

-- Return the caller's balance, creating the wallet with a starter grant on first call.
create or replace function public.get_or_create_wallet()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_balance integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select balance into v_balance from wallets where user_id = v_uid;
  if not found then
    insert into wallets(user_id, balance) values (v_uid, 2)          -- 2 free starter tokens
      on conflict (user_id) do nothing;
    insert into token_ledger(user_id, delta, reason, ref)
      values (v_uid, 2, 'signup_bonus', v_uid::text)
      on conflict (reason, ref) do nothing;
    select balance into v_balance from wallets where user_id = v_uid;
  end if;
  return coalesce(v_balance, 0);
end $$;

-- Spend 1 token for a moment. Idempotent per qr_code id (re-saving an edited
-- moment never double-charges). Returns the new balance, or -1 if insufficient.
create or replace function public.spend_token_for_moment(p_qr_id text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_balance integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from token_ledger
             where user_id = v_uid and reason = 'send' and ref = p_qr_id) then
    select balance into v_balance from wallets where user_id = v_uid;   -- already paid
    return coalesce(v_balance, 0);
  end if;
  select balance into v_balance from wallets where user_id = v_uid for update;
  if coalesce(v_balance, 0) <= 0 then
    return -1;                                                          -- insufficient
  end if;
  update wallets set balance = balance - 1, updated_at = now() where user_id = v_uid;
  insert into token_ledger(user_id, delta, reason, ref) values (v_uid, -1, 'send', p_qr_id);
  return v_balance - 1;
end $$;

-- Credit tokens after a Stripe purchase. Called by the webhook (service role).
-- Idempotent per Stripe session id.
create or replace function public.credit_tokens(p_user uuid, p_amount integer, p_ref text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_balance integer;
begin
  if exists (select 1 from token_ledger where reason = 'purchase' and ref = p_ref) then
    select balance into v_balance from wallets where user_id = p_user;
    return coalesce(v_balance, 0);
  end if;
  insert into wallets(user_id, balance) values (p_user, p_amount)
    on conflict (user_id) do update set balance = wallets.balance + p_amount, updated_at = now();
  insert into token_ledger(user_id, delta, reason, ref) values (p_user, p_amount, 'purchase', p_ref);
  select balance into v_balance from wallets where user_id = p_user;
  return v_balance;
end $$;

grant execute on function public.get_or_create_wallet()          to authenticated;
grant execute on function public.spend_token_for_moment(text)    to authenticated;
-- credit_tokens is invoked by the webhook via the service role only — no grant here.
