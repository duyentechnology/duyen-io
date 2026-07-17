# Phase 2 — Token wallet + Stripe (setup)

"Send a moment" costs **1 token**. Tokens are sold in **5-packs for $5**. New users
get **2 free** starter tokens. The whole flow is behind a frontend flag
(`TOKENS_ENABLED` in `index.html`) so nothing charges until you finish this and flip it on.

## Pieces
- `migrations/0001_tokens.sql` — `wallets` + `token_ledger` tables, RLS, and the
  functions `get_or_create_wallet`, `spend_token_for_moment`, `credit_tokens`.
- `functions/create-checkout` — starts a Stripe Checkout for buying packs.
- `functions/stripe-webhook` — credits tokens when a payment completes (idempotent).

## One-time setup

1. **Run the migration** (creates tables + functions):
   ```bash
   supabase db push          # or paste 0001_tokens.sql into the SQL editor
   ```

2. **Stripe (test mode):** create a Product "5 Moment Tokens", one-time price **$5.00**,
   copy its **Price ID** (`price_…`) and your **Secret key** (`sk_test_…`).

3. **Set secrets:**
   ```bash
   supabase secrets set \
     STRIPE_SECRET_KEY="sk_test_…" \
     STRIPE_PRICE_ID="price_…" \
     APP_URL="https://duyen.io"
   ```

4. **Deploy the functions** (webhook must skip JWT — Stripe can't send one):
   ```bash
   supabase functions deploy create-checkout
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```

5. **Add the webhook in Stripe:** Developers → Webhooks → Add endpoint →
   URL `https://<project-ref>.functions.supabase.co/stripe-webhook`, event
   `checkout.session.completed`. Copy the **signing secret** (`whsec_…`) and:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_…"
   ```

6. **Flip the flag:** set `TOKENS_ENABLED = true` in `index.html`.

## Test (all fake money)
- Buy a pack with test card `4242 4242 4242 4242`, any future expiry/CVC.
- Watch the balance go +5; send a moment; watch it go −1.
- `supabase functions logs stripe-webhook` to see the credit land.

## Go live
Activate the Stripe account (personal/sole-proprietor is fine), swap
`sk_test_…`→`sk_live_…` and re-create the webhook + price in live mode, redeploy.

## Notes
- **Starter grant:** 2 free tokens on first wallet touch (`get_or_create_wallet`). Change the `2` in the migration to taste.
- **Idempotency:** purchases are keyed by Stripe session id, spends by qr_code id — so retries/edits never double-charge or double-credit.
- **Refund on failed send:** not needed — a token is only spent once the moment row is written; `spend_token_for_moment` is called at save time.
