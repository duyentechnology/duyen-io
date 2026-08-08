-- Scan-path RPCs, so an unauthenticated scanner never needs table-wide rights.
--
-- The scan flow has to work before anyone logs in: read one code, count the
-- scan. That was granted by giving `anon` SELECT and UPDATE on qr_codes with
-- RLS `using (true)` — which also let anyone with the public anon key list the
-- whole table (every gift message) and rewrite any row (urls, ownership,
-- someone else's message). RLS cannot restrict columns, so the policy named
-- "scan count updates" allowed writes to all 31 of them.
--
-- These three functions are the only things a scanner needs. They are
-- SECURITY DEFINER so they see past RLS, but each one is keyed to a single
-- code, so nothing can be enumerated and nothing else can be written.
--
-- Applied BEFORE the client switches to them, and the grants are revoked
-- only AFTER the new client is live (0015) — revoking first would break
-- every scan in production.

-- ---------------------------------------------------------------------------
-- Read one code, the way the client already looks it up: by its public URL,
-- falling back to the uuid when the scanned value IS the uuid.
-- ---------------------------------------------------------------------------
create or replace function public.get_qr_for_scan(p_code text)
returns setof public.qr_codes
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select *
    from public.qr_codes
   where url = 'https://duyen.io/q/' || p_code
      or (p_code ~* '^[0-9a-f-]{36}$' and id::text = lower(p_code))
   limit 1;
$$;

comment on function public.get_qr_for_scan(text) is
  'Scan lookup for a single code. Replaces table-wide anon SELECT, which allowed enumerating every row.';

-- ---------------------------------------------------------------------------
-- Counters. A scanner may bump these; it may not write anything else.
-- Increment-by-one only: the caller cannot set a value, so counts can be
-- inflated by scanning (as before) but not forged outright.
-- ---------------------------------------------------------------------------
create or replace function public.bump_scan_count(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.qr_codes
     set scan_count      = coalesce(scan_count, 0) + 1,
         last_scanned_at  = now()
   where id = p_id;
$$;

create or replace function public.bump_share_count(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.qr_codes
     set share_count = coalesce(share_count, 0) + 1
   where id = p_id;
$$;

comment on function public.bump_scan_count(uuid) is
  'Increment scan_count and stamp last_scanned_at. The only write a scanner needs.';
comment on function public.bump_share_count(uuid) is
  'Increment share_count. The only other write a scanner needs.';

-- Callable by a scanner (anon) and by a signed-in user on someone else''s code.
grant execute on function public.get_qr_for_scan(text)  to anon, authenticated;
grant execute on function public.bump_scan_count(uuid)  to anon, authenticated;
grant execute on function public.bump_share_count(uuid) to anon, authenticated;

-- SECURITY DEFINER functions are owned by the migration role; make sure a
-- narrower role can't redefine them.
revoke all on function public.get_qr_for_scan(text)  from public;
revoke all on function public.bump_scan_count(uuid)  from public;
revoke all on function public.bump_share_count(uuid) from public;
grant execute on function public.get_qr_for_scan(text)  to anon, authenticated;
grant execute on function public.bump_scan_count(uuid)  to anon, authenticated;
grant execute on function public.bump_share_count(uuid) to anon, authenticated;
