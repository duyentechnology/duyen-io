// Edge Function: business-checkout
// ---------------------------------------------------------------------------
// Starts a Stripe Checkout session for a duyen.tech business tier:
//   generator  $20   one-time   (mode=payment)      → unlocks the QR generator
//   insights   $9.99 / month    (mode=subscription) → analytics + push
//   boutique   $19.99 / month   (mode=subscription) → + multi-QR minting
//
// Called from the business app:
//   db.functions.invoke('business-checkout', { body: { tier } })
// Returns { url } — the app redirects the user there. The stripe-webhook then
// flips the entitlement on business_accounts (never the client).
//
// Uses the Stripe REST API via plain fetch (no SDK import) so the function
// boots cleanly on the Supabase edge runtime.
//
// Secrets: STRIPE_SECRET_KEY, BIZ_APP_URL (where Stripe returns the user).
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// The single source of truth for business pricing. Amounts in cents.
const TIERS: Record<string, { name: string; cents: number; mode: "payment" | "subscription" }> = {
  generator: { name: "QR generator (one-time unlock)", cents: 2000,  mode: "payment" },
  insights:  { name: "Insights plan",                  cents: 999,   mode: "subscription" },
  boutique:  { name: "Boutique plan",                  cents: 1999,  mode: "subscription" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const APP_URL = Deno.env.get("BIZ_APP_URL") || "https://dayduyen.tech";
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

  // Parse the request: which tier, and (for credit top-ups) how many credits.
  // profileId matters for the generator tier — the $20 unlocks ONE profile,
  // so the webhook needs to know which one it paid for.
  let tier = "generator";
  let qty = 1;
  let profileId = "";
  try {
    const b = await req.json();
    if (b?.tier) tier = String(b.tier);
    if (b?.qty) qty = Math.max(1, Math.min(1000, parseInt(b.qty, 10) || 1));
    if (b?.profileId) profileId = String(b.profileId).slice(0, 128);
  } catch { /* defaults */ }

  // Build a Checkout session via the Stripe REST API (form-encoded, inline price).
  const p = new URLSearchParams();
  p.set("client_reference_id", user.id);
  if (user.email) p.set("customer_email", user.email);
  // Metadata the webhook reads to grant the right entitlement.
  p.set("metadata[kind]", "business");
  p.set("metadata[tier]", tier);
  p.set("metadata[user_id]", user.id);
  if (profileId) p.set("metadata[profile_id]", profileId);

  if (tier === "credits") {
    // Boutique mint-credit top-up: $0.10 per credit, one-time (qty credits).
    p.set("mode", "payment");
    p.set("line_items[0][price_data][currency]", "usd");
    p.set("line_items[0][price_data][unit_amount]", "10"); // $0.10
    p.set("line_items[0][price_data][product_data][name]", "Mint credits ($0.10 / QR)");
    p.set("line_items[0][quantity]", String(qty));
    p.set("metadata[credits]", String(qty));
  } else {
    const spec = TIERS[tier];
    if (!spec) return json({ error: `Unknown tier: ${tier}` }, 400);
    p.set("mode", spec.mode);
    p.set("line_items[0][price_data][currency]", "usd");
    p.set("line_items[0][price_data][unit_amount]", String(spec.cents));
    p.set("line_items[0][price_data][product_data][name]", spec.name);
    p.set("line_items[0][quantity]", "1");
    if (spec.mode === "subscription") {
      p.set("line_items[0][price_data][recurring][interval]", "month");
      // Stamp the subscription's own metadata so lifecycle events carry it.
      p.set("subscription_data[metadata][kind]", "business");
      p.set("subscription_data[metadata][tier]", tier);
      p.set("subscription_data[metadata][user_id]", user.id);
    }
  }
  p.set("success_url", `${APP_URL}/?upgrade=success`);
  p.set("cancel_url", `${APP_URL}/?upgrade=cancel`);

  const sres = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: p.toString(),
  });
  const session = await sres.json();
  if (!sres.ok) {
    console.error("business-checkout stripe error:", session?.error?.message || session);
    return json({ error: "Could not start checkout." }, 500);
  }
  return json({ url: session.url });
});
