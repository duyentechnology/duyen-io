-- set_digest_opt_in — let a signed-in user turn their "What's New" email on/off
-- from an in-app toggle. A customer has no digest_prefs row until the digest first
-- processes them, and the table grants the client only SELECT/UPDATE (no INSERT),
-- so a plain client upsert can't create the first row. This SECURITY DEFINER RPC
-- upserts the CALLER's own row (keyed on auth.uid()), minting the default
-- unsubscribe_token on first write. It only ever touches the caller's row.

create or replace function public.set_digest_opt_in(p_opt_in boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.digest_prefs (user_id, email_opt_in)
  values (auth.uid(), p_opt_in)
  on conflict (user_id) do update set email_opt_in = excluded.email_opt_in;
  return p_opt_in;
end;
$$;

revoke all on function public.set_digest_opt_in(boolean) from public, anon;
grant execute on function public.set_digest_opt_in(boolean) to authenticated;
