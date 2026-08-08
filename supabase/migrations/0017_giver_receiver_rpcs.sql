-- Close the authenticated half: a signed-in account can no longer write rows
-- it has nothing to do with.
--
-- The policy "Authenticated users can update QR giver/receiver" was
-- `using (auth.uid() is not null)` with no with-check, and authenticated holds
-- column-level UPDATE on all 31 columns. Since signup is free, that meant any
-- account could rewrite any row — verified against this database with a
-- throwaway account: PATCH url → 204, PATCH someone else's giver_data → 204.
--
-- It was that wide because two legitimate writes touch a code the writer does
-- not own: the giver leaving a message, and the receiver replying. Both move
-- here, where each writes only its own columns.
--
-- These also refuse to overwrite a role that is already taken. The UI used to
-- be the only thing preventing that, and it was failing: a June edit dropped
-- the bizOption declaration, so the role-gating block threw and every scanner
-- was offered "I'm Giving a Gift" even on a note whose message was written.
-- The button is fixed, but the rule belongs here, where a client bug cannot
-- bypass it.

-- ---------------------------------------------------------------------------
-- The giver's message. Claims the giver role, or updates it if already yours.
-- ---------------------------------------------------------------------------
create or replace function public.claim_giver(p_id uuid, p_giver_data jsonb, p_is_draft boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select giver_user_id into v_owner from public.qr_codes where id = p_id for update;
  if not found then raise exception 'qr_not_found'; end if;

  -- Someone else got there first: their message stands.
  if v_owner is not null and v_owner <> v_uid then
    raise exception 'giver_already_set';
  end if;

  update public.qr_codes
     set giver_data    = p_giver_data,
         giver_user_id = v_uid,
         status        = case when p_is_draft then 'draft' else 'active' end,
         updated_at    = now()
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- The receiver's reply. Same rule from the other end.
-- ---------------------------------------------------------------------------
create or replace function public.claim_receiver(p_id uuid, p_receiver_data jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select receiver_user_id into v_owner from public.qr_codes where id = p_id for update;
  if not found then raise exception 'qr_not_found'; end if;

  if v_owner is not null and v_owner <> v_uid then
    raise exception 'receiver_already_set';
  end if;

  update public.qr_codes
     set receiver_data    = p_receiver_data,
         receiver_user_id = v_uid,
         updated_at       = now()
   where id = p_id;
end $$;

revoke all on function public.claim_giver(uuid, jsonb, boolean) from public;
revoke all on function public.claim_receiver(uuid, jsonb)       from public;
grant execute on function public.claim_giver(uuid, jsonb, boolean) to authenticated;
grant execute on function public.claim_receiver(uuid, jsonb)       to authenticated;

comment on function public.claim_giver(uuid, jsonb, boolean) is
  'Write the giver message on a code you do not own. Refuses if another account already took the giver role.';
comment on function public.claim_receiver(uuid, jsonb) is
  'Write the receiver reply on a code you do not own. Refuses if another account already took the receiver role.';

-- ---------------------------------------------------------------------------
-- Now the blanket write policy can go.
-- ---------------------------------------------------------------------------
drop policy if exists "Authenticated users can update QR giver/receiver" on public.qr_codes;

-- Own rows had no with-check, so a row could be handed to another account by
-- rewriting user_id. Keep the same reach, close that.
drop policy if exists "Users can update own QR codes" on public.qr_codes;
create policy "Users can update own QR codes"
  on public.qr_codes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- What remains for authenticated: its own rows, claiming an unclaimed code as a
-- business, and its own business codes. Note the claim policy still allows any
-- column on a row whose business_user_id is null — that is the claim-by-scan
-- mechanism itself (whoever holds the card can claim it), not an oversight.
