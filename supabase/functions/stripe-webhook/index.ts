// Edge Function: stripe-webhook
// ---------------------------------------------------------------------------
// Stripe calls this after a payment. On checkout.session.completed we credit the
// buyer's tokens (idempotent per Stripe session id, enforced in credit_tokens).
//
// Verifies the Stripe signature manually with Web Crypto (HMAC-SHA256) and
// credits via the credit_tokens RPC using the service role — no SDK import, so
// the function boots cleanly on the edge runtime.
//
// Deploy WITHOUT JWT verification (Stripe can't send a Supabase JWT).
//
// Secrets (Edge Function secrets):
//   STRIPE_WEBHOOK_SECRET  whsec_…  (from the webhook endpoint in Stripe)
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

  // constant-time compare against any provided v1 signature
  const eq = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  return v1s.some((v1) => eq(hex, v1));
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

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object || {};
    const userId = session.metadata?.user_id || session.client_reference_id || null;
    const tokens = parseInt(session.metadata?.tokens || "0", 10);
    if (userId && tokens > 0) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      // Idempotent per session id (credit_tokens guards on ref).
      const rr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/credit_tokens`, {
        method: "POST",
        headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_user: userId, p_amount: tokens, p_ref: session.id }),
      });
      if (!rr.ok) {
        console.error("credit_tokens failed:", await rr.text());
        return new Response("Credit failed", { status: 500 }); // let Stripe retry
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
