// Edge Function: business-cancel-subscription
// ---------------------------------------------------------------------------
// Manage the caller's Insights / Boutique subscription (duyen.tech business).
//
//   { action: "status" }  → { plan, plan_status, renews_at, cancel_at_period_end, ends_at }
//   { action: "cancel" }  → schedule cancellation at period end (keeps access
//                           until the paid month ends), returns the updated status
//   { action: "resume" }  → undo a scheduled cancellation (keep the plan)
//
// Cancellation is "at period end", not immediate: the customer keeps analytics
// and push until the month they already paid for runs out. When Stripe finally
// ends the subscription it fires customer.subscription.deleted, and the existing
// stripe-webhook flips plan_status → canceled (dropping the entitlement). This
// function never writes plan_status itself — Stripe's webhook stays the single
// source of truth, exactly like checkout.
//
// Called from the business app:
//   db.functions.invoke('business-cancel-subscription', { body: { action } })
//
// Secrets: STRIPE_SECRET_KEY.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const toIso = (unixSecs: unknown) =>
  (typeof unixSecs === "number" && unixSecs > 0) ? new Date(unixSecs * 1000).toISOString() : null;

// Recent Stripe API versions moved current_period_end from the subscription to
// the subscription item, so read the top level first and fall back to the item.
function periodEndIso(sub: any): string | null {
  if (!sub) return null;
  const top = toIso(sub.current_period_end);
  if (top) return top;
  const item = sub.items?.data?.[0]?.current_period_end;
  return toIso(item);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) return json({ error: "Stripe not configured (STRIPE_SECRET_KEY)." }, 501);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Identify the caller from their JWT.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: ANON },
  });
  if (!ures.ok) return json({ error: "Not authenticated" }, 401);
  const user = await ures.json();
  if (!user?.id) return json({ error: "Not authenticated" }, 401);

  let action = "status";
  try { const b = await req.json(); if (b?.action) action = String(b.action); } catch { /* default */ }
  if (!["status", "cancel", "resume"].includes(action)) return json({ error: "Unknown action" }, 400);

  // Read this user's business account (service role — RLS-independent, scoped by user_id).
  const ares = await fetch(
    `${SUPABASE_URL}/rest/v1/business_accounts?user_id=eq.${user.id}&select=plan,plan_status,stripe_subscription_id,renews_at`,
    { headers: { apikey: SR, Authorization: `Bearer ${SR}` } },
  );
  const rows = ares.ok ? await ares.json() : [];
  const acct = Array.isArray(rows) && rows.length ? rows[0] : null;
  const subId = acct?.stripe_subscription_id || null;

  if (!subId) return json({ error: "no_subscription", message: "No active subscription to manage." }, 400);

  const stripeHeaders = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // Apply a change first (cancel / resume), then read the subscription back so
  // the response always reflects Stripe's post-change truth.
  if (action === "cancel" || action === "resume") {
    const body = new URLSearchParams();
    body.set("cancel_at_period_end", action === "cancel" ? "true" : "false");
    const ures2 = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
      method: "POST", headers: stripeHeaders, body: body.toString(),
    });
    const updated = await ures2.json();
    if (!ures2.ok) {
      console.error("cancel/resume stripe error:", updated?.error?.message || updated);
      return json({ error: "stripe_error", message: "Could not update the subscription." }, 500);
    }
    return json({
      ok: true,
      action,
      plan: acct?.plan || null,
      plan_status: acct?.plan_status || null,
      cancel_at_period_end: !!updated.cancel_at_period_end,
      ends_at: periodEndIso(updated),
      renews_at: acct?.renews_at || periodEndIso(updated),
    });
  }

  // action === "status": read the subscription from Stripe for the live cancel flag.
  const sres = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, { headers: stripeHeaders });
  const sub = sres.ok ? await sres.json() : null;
  return json({
    ok: true,
    action: "status",
    plan: acct?.plan || null,
    plan_status: acct?.plan_status || null,
    cancel_at_period_end: !!(sub && sub.cancel_at_period_end),
    ends_at: sub ? periodEndIso(sub) : (acct?.renews_at || null),
    renews_at: acct?.renews_at || (sub ? periodEndIso(sub) : null),
  });
});
