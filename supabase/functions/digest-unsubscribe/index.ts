// digest-unsubscribe — turn off the "What's New" email for a customer, no login.
//
// Deployed with verify_jwt=false (clicked straight from an email). The user's
// unsubscribe token is in ?token=. We flip digest_prefs.email_opt_in to false.
//   GET  -> flips + returns a branded confirmation page (manual click of the link)
//   POST -> flips + returns 200 (RFC 8058 one-click, from the List-Unsubscribe-Post
//           header that Gmail / Apple Mail act on)
// An unknown/empty token still returns a graceful page (never leaks whether a token
// exists) and changes nothing.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sr(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

function page(title: string, msg: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title></head>
  <body style="margin:0;background:#faf7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2E2A28;">
  <div style="max-width:420px;margin:12vh auto;padding:32px 28px;background:#fff;border:1px solid #E8DDD6;border-radius:16px;text-align:center;">
    <div style="font-size:30px;color:#DA251D;line-height:1;">緣</div>
    <div style="font-size:12px;font-weight:700;letter-spacing:3px;color:#DA251D;margin-top:6px;">DUYÊN</div>
    <h1 style="font-family:Georgia,serif;font-size:22px;color:#8B3A7F;margin:20px 0 10px;">${title}</h1>
    <p style="font-size:15px;line-height:1.6;color:#4a4540;margin:0 0 20px;">${msg}</p>
    <a href="https://duyen.io" style="display:inline-block;background:#8B3A7F;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 26px;border-radius:10px;">Go to Duyên</a>
  </div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function optOut(token: string): Promise<boolean> {
  if (!token) return false;
  const r = await sr(`digest_prefs?unsubscribe_token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ email_opt_in: false }),
  });
  if (!r.ok) return false;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  const token = (new URL(req.url).searchParams.get("token") || "").trim();

  if (req.method === "POST") {
    // One-click (RFC 8058): just acknowledge.
    await optOut(token);
    return new Response("ok", { status: 200 });
  }
  if (req.method === "GET") {
    await optOut(token); // graceful either way; never reveal token validity
    return page("You're unsubscribed", "You won't receive the What's New email anymore. You can still see new promotions from shops you saved anytime inside the app.");
  }
  return new Response("Method not allowed", { status: 405 });
});
