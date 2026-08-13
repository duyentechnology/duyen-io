// Edge Function: stripe-webhook
// ---------------------------------------------------------------------------
// One Stripe endpoint for BOTH products on the shared backend:
//
//   Consumer (duyen.io)  — moment-token bundles. checkout.session.completed with
//                          metadata.tokens → credit_tokens.
//   Business (duyen.tech) — tier purchases. metadata.kind === 'business':
//       tier 'generator' (one-time)   → business_grant_generator
//       tier 'insights'/'boutique'    → business_set_plan(active)
//     plus subscription lifecycle (renew / dunning / cancel) via
//       customer.subscription.updated|deleted, invoice.payment_failed
//       → business_update_sub_status.
//
// Verifies the Stripe signature manually with Web Crypto (HMAC-SHA256) — no SDK
// import, so the function boots cleanly on the edge runtime.
//
// Deploy WITHOUT JWT verification (Stripe can't send a Supabase JWT).
//
// Secrets: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY.
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

// Verify a Stripe-Signature header ("t=…,v1=…") against the raw body.
async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((kv) => {
    const i = kv.indexOf("=");
    return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as [string, string];
  });
  const t = parts.find((p) => p[0] === "t")?.[1];
  const v1s = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || v1s.length === 0) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const eq = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  return v1s.some((v1) => eq(hex, v1));
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Call a SECURITY DEFINER RPC with the service role. Returns true on success.
async function rpc(name: string, body: Record<string, unknown>): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { console.error(`rpc ${name} failed:`, r.status, await r.text()); return false; }
  return true;
}

// Map a Stripe subscription status to our plan_status enum.
function mapSubStatus(s: string): string {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "inactive";
}
const toIso = (unixSecs: unknown) =>
  (typeof unixSecs === "number" && unixSecs > 0) ? new Date(unixSecs * 1000).toISOString() : null;

// Fetch a subscription from Stripe to read current_period_end (for renews_at).
async function fetchSubscription(subId: string): Promise<any | null> {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key || !subId) return null;
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok) { console.error("fetchSubscription failed:", r.status, await r.text()); return null; }
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const WHSEC = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!WHSEC) return new Response("Stripe not configured", { status: 501 });

  const sig = req.headers.get("stripe-signature") || "";
  const body = await req.text();
  if (!(await verifySignature(body, sig, WHSEC))) {
    console.error("stripe-webhook: signature verification failed");
    return new Response("Bad signature", { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(body); } catch { return new Response("Bad payload", { status: 400 }); }

  const obj = event.data?.object || {};
  let ok = true;

  switch (event.type) {
    // ── Purchase completed ───────────────────────────────────────────────
    case "checkout.session.completed": {
      const meta = obj.metadata || {};
      if (meta.kind === "business") {
        // duyen.tech business tier.
        const userId = meta.user_id || obj.client_reference_id || null;
        const tier = meta.tier || "";
        const customer = typeof obj.customer === "string" ? obj.customer : null;
        if (!userId) break;
        if (tier === "generator") {
          // $10 unlocks this profile's own QR (design + print). Flat pricing:
          // modulars are billed separately, one credit each.
          ok = await rpc("business_unlock_profile", {
            p_user: userId,
            p_profile: meta.profile_id || "",
            p_customer: customer,
          });
        } else if (tier === "modular") {
          // $10 per modular QR. Idempotent per session id.
          ok = await rpc("business_add_modular_credits", {
            p_user: userId, p_qty: 1, p_ref: obj.id,
          });
        } else if (tier === "credits") {
          // Boutique mint-credit top-up ($0.10/QR). Idempotent per session id.
          const credits = parseInt(meta.credits || "0", 10);
          if (credits > 0) ok = await rpc("business_add_mint_credits", { p_user: userId, p_qty: credits, p_ref: obj.id });
        } else if (tier === "insights" || tier === "boutique") {
          const subId = typeof obj.subscription === "string" ? obj.subscription : null;
          const sub = subId ? await fetchSubscription(subId) : null;
          const status = sub ? mapSubStatus(sub.status) : "active";
          const renews = sub ? toIso(sub.current_period_end) : null;
          ok = await rpc("business_set_plan", {
            p_user: userId, p_plan: tier, p_status: status,
            p_sub: subId, p_customer: customer, p_renews: renews,
          });
        }
      } else {
        // duyen.io moment-token bundle.
        const userId = meta.user_id || obj.client_reference_id || null;
        const tokens = parseInt(meta.tokens || "0", 10);
        if (userId && tokens > 0) {
          ok = await rpc("credit_tokens", { p_user: userId, p_amount: tokens, p_ref: obj.id });
        }
      }
      break;
    }

    // ── Subscription lifecycle (renew / status change) ───────────────────
    case "customer.subscription.updated": {
      const subId = obj.id;
      const status = mapSubStatus(obj.status || "");
      const renews = toIso(obj.current_period_end);
      if (subId) ok = await rpc("business_update_sub_status", { p_sub: subId, p_status: status, p_renews: renews });
      break;
    }
    case "customer.subscription.deleted": {
      const subId = obj.id;
      if (subId) ok = await rpc("business_update_sub_status", { p_sub: subId, p_status: "canceled", p_renews: null });
      break;
    }

    // ── Failed renewal → past_due ────────────────────────────────────────
    case "invoice.payment_failed": {
      const subId = typeof obj.subscription === "string" ? obj.subscription : null;
      if (subId) ok = await rpc("business_update_sub_status", { p_sub: subId, p_status: "past_due", p_renews: null });
      break;
    }

    default:
      // Unhandled event types are acknowledged so Stripe doesn't retry them.
      break;
  }

  if (!ok) return new Response("Handler failed", { status: 500 }); // let Stripe retry
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
