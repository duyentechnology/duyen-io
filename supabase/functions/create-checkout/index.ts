// Edge Function: create-checkout
// ---------------------------------------------------------------------------
// Starts a Stripe Checkout session to buy token bundles (5 tokens = $5).
// Called from the app: db.functions.invoke('create-checkout', { body: { quantity } })
// Returns { url } — the app redirects the user there.
//
// Secrets (supabase secrets set ...):
//   STRIPE_SECRET_KEY   sk_test_… (then sk_live_… to go live)
//   STRIPE_PRICE_ID     price_…   (the "5 Moment Tokens — $5" price)
//   APP_URL             https://duyen.io   (optional; where Stripe returns the user)
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY

import Stripe from "https://esm.sh/stripe@16.2.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const TOKENS_PER_BUNDLE = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID");
  const APP_URL = Deno.env.get("APP_URL") || "https://duyen.io";
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    return json({ error: "Stripe not configured (STRIPE_SECRET_KEY / STRIPE_PRICE_ID)." }, 501);
  }

  // Identify the caller from their JWT.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supa.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const user = userData.user;

  // How many bundles (clamped).
  let quantity = 1;
  try { const b = await req.json(); quantity = Math.max(1, Math.min(20, parseInt(b?.quantity, 10) || 1)); } catch { /* default 1 */ }
  const tokens = quantity * TOKENS_PER_BUNDLE;

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: STRIPE_PRICE_ID, quantity }],
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      metadata: { user_id: user.id, tokens: String(tokens) },
      success_url: `${APP_URL}/?tokens=success`,
      cancel_url: `${APP_URL}/?tokens=cancel`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error("create-checkout error:", e);
    return json({ error: "Could not start checkout." }, 500);
  }
});
