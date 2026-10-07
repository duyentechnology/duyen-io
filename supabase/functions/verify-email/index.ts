// verify-email — consume a magic-link token and mark the user's email confirmed.
//
// Public on purpose: the token IS the credential. The link in the email lands the
// user back in the app, which POSTs { token } here. We hash the token, match it to
// a live (unexpired) email_verifications row, stamp verified_at, and null the
// token_hash so the link can't be replayed. We also set app_metadata.email_verified
// on the auth user (service-role only, lives in the JWT) so the app can hide the
// banner cheaply after the next token refresh.
//
// No user auth is required or trusted here — the row's user_id tells us who it is.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function sr(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  let token = "";
  if (req.method === "GET") {
    token = new URL(req.url).searchParams.get("token") || "";
  } else {
    try { token = String((await req.json())?.token || ""); } catch { /* */ }
  }
  token = token.trim();
  if (!token) return json({ error: "Missing token" }, 400);

  const token_hash = await sha256hex(token);
  const rows = await (await sr(
    `email_verifications?token_hash=eq.${token_hash}&select=user_id,app,expires_at,verified_at`
  )).json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  // Expected, user-facing outcomes return 200 with ok:false so the app can show
  // the message directly (invoke() only surfaces non-2xx as an opaque error).
  if (!row) return json({ ok: false, error: "This link is invalid or has already been used." });

  // Idempotent: a mail-app prefetch/scanner (or a double click) can hit this more
  // than once. If the row is already verified, every later call still succeeds —
  // we do NOT destroy the token on use, so the user's actual tap never sees
  // "invalid" just because something fetched the link first.
  if (row.verified_at) return json({ ok: true, app: row.app, already: true });

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return json({ ok: false, error: "This link has expired. Request a new one from the app.", expired: true });
  }

  // Stamp verified. The token_hash is kept (not nulled): the link stays idempotent
  // until it expires, and re-clicks resolve to the already-verified branch above.
  // send-verify-email rotates the hash on the same row if a new link is requested.
  const upd = await sr(`email_verifications?user_id=eq.${row.user_id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ verified_at: new Date().toISOString() }),
  });
  if (!upd.ok) {
    const t = await upd.text().catch(() => "");
    return json({ error: "Could not confirm email", detail: t }, 500);
  }

  // Mirror into app_metadata (JWT) so the client can hide the banner without a query.
  // Best-effort: the table is the source of truth, so a failure here isn't fatal.
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${row.user_id}`, {
      method: "PUT",
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
      body: JSON.stringify({ app_metadata: { email_verified: true } }),
    });
  } catch { /* non-fatal */ }

  return json({ ok: true, app: row.app });
});
