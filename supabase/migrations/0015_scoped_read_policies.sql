-- Owner-scoped reads, so the blanket "Anyone can read QR codes" can go.
--
-- That blanket policy (SELECT, using true, to anon+authenticated) is what the
-- app has actually been relying on for reads nobody wrote a policy for. Two of
-- them matter:
--
--   * a business reading its own claimed codes — every dayduyen dashboard read
--     filters on business_user_id, and NO policy covers that column, so the
--     dashboard works only because the blanket policy exists;
--   * a giver or receiver reading a code they wrote into but do not own.
--
-- Both get a real policy here. Dropping the blanket policy without these would
-- empty the business dashboard.
--
-- Additive and safe to apply before the client ships: adding permissive
-- policies cannot take access away. The revocations are separate (0016).

-- A business sees the codes it has claimed.
drop policy if exists "Business sees own claimed codes" on public.qr_codes;
create policy "Business sees own claimed codes"
  on public.qr_codes for select to authenticated
  using (business_user_id = auth.uid());

-- A giver or receiver sees the code they took part in, whether or not it is in
-- their tapestry yet.
drop policy if exists "Giver and receiver see their code" on public.qr_codes;
create policy "Giver and receiver see their code"
  on public.qr_codes for select to authenticated
  using (giver_user_id = auth.uid() or receiver_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Saves are counted on a code the saver does not own, so counting one used to
-- need a read plus an update on someone else's row. Same shape as the scan and
-- share counters: one function, one column, nothing else reachable.
-- ---------------------------------------------------------------------------
create or replace function public.bump_save_count(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.qr_codes
     set save_count = coalesce(save_count, 0) + 1
   where id = p_id;
$$;

comment on function public.bump_save_count(uuid) is
  'Increment save_count on a code the saver does not own. Replaces a read+update on someone else''s row.';

revoke all on function public.bump_save_count(uuid) from public;
grant execute on function public.bump_save_count(uuid) to anon, authenticated;
