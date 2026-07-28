// Edge Function: create-checkout
// ---------------------------------------------------------------------------
// Starts a Stripe Checkout session to buy token bundles ($5 = 5 tokens).
// Called from the app: db.functions.invoke('create-checkout', { body: { quantity } })
// Returns { url } — the app redirects the user there.
//
// Uses the Stripe REST API via plain fetch (no SDK import) so the function
// boots cleanly on the Supabase edge runtime.
//
// Secrets (Edge Function secrets):
//   STRIPE_SECRET_KEY   sk_live_… / sk_test_…
//   APP_URL             https://duyen.io   (optional; where Stripe returns the user)
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const TOKENS_PER_BUNDLE = 5;
const BUNDLE_PRICE_CENTS = 500; // $5.00 for 5 tokens

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const APP_URL = Deno.env.get("APP_URL") || "https://duyen.io";
  if (!STRIPE_SECRET_KEY) return json({ error: "Stripe not configured (STRIPE_SECRET_KEY)." }, 501);

  // Identify the caller from their JWT via the Supabase Auth REST endpoint.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: ANON },
  });
  if (!ures.ok) return json({ error: "Not authenticated" }, 401);
  const user = await ures.json();
  if (!user?.id) return json({ error: "Not authenticated" }, 401);

  // How many bundles (clamped 1..20).
  let quantity = 1;
  try { const b = await req.json(); quantity = Math.max(1, Math.min(20, parseInt(b?.quantity, 10) || 1)); } catch { /* default */ }
  const tokens = quantity * TOKENS_PER_BUNDLE;

  // Build a Checkout session via the Stripe REST API (form-encoded).
  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("line_items[0][price_data][currency]", "usd");
  p.set("line_items[0][price_data][unit_amount]", String(BUNDLE_PRICE_CENTS));
  p.set("line_items[0][price_data][product_data][name]", "Moment Tokens (5-pack)");
  p.set("line_items[0][quantity]", String(quantity));
  p.set("client_reference_id", user.id);
  if (user.email) p.set("customer_email", user.email);
  p.set("metadata[user_id]", user.id);
  p.set("metadata[tokens]", String(tokens));
  p.set("success_url", `${APP_URL}/?tokens=success`);
  p.set("cancel_url", `${APP_URL}/?tokens=cancel`);

  const sres = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: p.toString(),
  });
  const session = await sres.json();
  if (!sres.ok) {
    console.error("create-checkout stripe error:", session?.error?.message || session);
    return json({ error: "Could not start checkout." }, 500);
  }
  return json({ url: session.url });
});
