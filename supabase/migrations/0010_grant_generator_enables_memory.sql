-- Paying for QR generation unlocks the memory layer on every code the business
-- already owns — including a flyer QR they claimed for free before paying.
-- Doing it here (rather than in the client) means it happens once, server-side,
-- on the Stripe webhook's grant call, for every purchase path.
--
-- memory_enabled is stamped, not computed: the $20 is one-time, so a business
-- that paid keeps it permanently.

create or replace function public.business_grant_generator(p_user uuid, p_customer text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into business_accounts(user_id, origin, has_generator, stripe_customer_id)
    values (p_user, 'direct', true, p_customer)
  on conflict (user_id) do update
    set has_generator      = true,
        stripe_customer_id = coalesce(excluded.stripe_customer_id, business_accounts.stripe_customer_id),
        updated_at         = now();

  update qr_codes
     set memory_enabled = true,
         updated_at     = now()
   where business_user_id = p_user
     and memory_enabled = false;
end $function$;
