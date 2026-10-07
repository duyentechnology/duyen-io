-- SECURITY FIX: lock the payment-grant RPCs to the server (service role) only.
--
-- credit_tokens(p_user, p_amount, p_ref) and business_unlock_profile(p_user, …)
-- GRANT paid value — tokens, and the business "generator" + unlocked profiles +
-- memory layer — and they take the TARGET USER as an argument with no caller
-- check (they do not use auth.uid()). They are meant to be called ONLY by the
-- Stripe webhook (stripe-webhook edge function, service role) AFTER a real
-- payment. They were ALSO executable by anon/authenticated, so anyone holding the
-- public anon key (it ships in the client) could call:
--     rpc/credit_tokens { p_user: <self>, p_amount: 999999, p_ref: <any-new> }
--     rpc/business_unlock_profile { p_user: <self>, p_profile: <x>, p_customer: <y> }
-- to grant themselves unlimited tokens or unlock the paid business features for
-- free. Revoke execute from anon/authenticated/public; the webhook uses the
-- service role (which keeps its explicit grant) and is unaffected. No frontend
-- calls these directly.

revoke execute on function public.credit_tokens(uuid, integer, text)         from anon, authenticated, public;
revoke execute on function public.business_unlock_profile(uuid, text, text)   from anon, authenticated, public;

grant  execute on function public.credit_tokens(uuid, integer, text)          to service_role;
grant  execute on function public.business_unlock_profile(uuid, text, text)   to service_role;
