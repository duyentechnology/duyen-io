// Edge Function: stripe-webhook
// ---------------------------------------------------------------------------
// Stripe calls this after a payment. On checkout.session.completed we credit the
// buyer's tokens (idempotent per Stripe session id, enforced in credit_tokens).
//
// Deploy WITHOUT JWT verification (Stripe can't send a Supabase JWT):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// We verify authenticity via the Stripe signature instead.
//
// Secrets (supabase secrets set ...):
//   STRIPE_SECRET_KEY      sk_test_… / sk_live_…
//   STRIPE_WEBHOOK_SECRET  whsec_…  (from the webhook endpoint you create in Stripe)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from "https://esm.sh/stripe@16.2.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return new Response("Stripe not configured", { status: 501 });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, sig!, STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch (e) {
    console.error("Signature verification failed:", (e as Error).message);
    return new Response("Bad signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id || session.client_reference_id || null;
    const tokens = parseInt(session.metadata?.tokens || "0", 10);
    if (userId && tokens > 0) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      // Idempotent per session id (credit_tokens guards on ref).
      const { error } = await admin.rpc("credit_tokens", {
        p_user: userId, p_amount: tokens, p_ref: session.id,
      });
      if (error) {
        console.error("credit_tokens failed:", error);
        return new Response("Credit failed", { status: 500 }); // let Stripe retry
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
