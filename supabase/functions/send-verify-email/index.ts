// send-verify-email — email a magic link that confirms the signed-in user's
// address. Called right after signup (fire-and-forget) and by the "Resend" action
// on the soft confirmation banner.
//
// Flow: verify the caller from their own auth token (never trust a client-supplied
// id), mint a random token, store ONLY its sha256 hash in email_verifications, and
// send the link through Resend from the app's branded address. The raw token lives
// only in the email + the link; the DB keeps the hash so a DB read can't be replayed.
//
// Branded senders (both domains verified in Resend):
//   duyen    -> Duyên <hello@duyen.io>        link https://duyen.io/?verify=TOKEN
//   dayduyen -> Duyên <hello@dayduyen.tech>   link https://dayduyen.tech/?verify=TOKEN
// Reply-To is set to the same address so a reply (incl. a support question) lands
// in that Google inbox.
//
// Secrets: RESEND_API_KEY. Absent => 500 (nothing silently dropped).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SR   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

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

const APPS: Record<string, { from: string; base: string; label: string }> = {
  duyen:    { from: "Duyên <hello@duyen.io>",       base: "https://duyen.io",      label: "Duyên" },
  dayduyen: { from: "Duyên <hello@dayduyen.tech>",  base: "https://dayduyen.tech", label: "Duyên for Business" },
};

function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function emailHtml(label: string, link: string): string {
  return `<!doctype html><html><body style="margin:0;background:#faf7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2E2A28;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f4;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #E8DDD6;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:32px 36px 8px;text-align:center;">
          <div style="font-size:30px;color:#DA251D;line-height:1;">緣</div>
          <div style="font-size:13px;font-weight:700;letter-spacing:3px;color:#DA251D;margin-top:6px;">DUYÊN</div>
        </td></tr>
        <tr><td style="padding:12px 36px 0;text-align:center;">
          <h1 style="font-size:22px;margin:16px 0 8px;color:#8B3A7F;">Confirm your email</h1>
          <p style="font-size:15px;line-height:1.6;color:#4a4540;margin:0 0 24px;">
            Welcome to ${label}. Tap the button below to confirm this is your email address.
          </p>
        </td></tr>
        <tr><td style="padding:0 36px;text-align:center;">
          <a href="${link}" style="display:inline-block;background:#8B3A7F;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 32px;border-radius:10px;">Confirm email</a>
        </td></tr>
        <tr><td style="padding:24px 36px 8px;text-align:center;">
          <p style="font-size:12px;line-height:1.6;color:#9A8478;margin:0;">
            Or paste this link into your browser:<br>
            <a href="${link}" style="color:#8B3A7F;word-break:break-all;">${link}</a>
          </p>
        </td></tr>
        <tr><td style="padding:20px 36px 32px;text-align:center;border-top:1px solid #F0E9E3;">
          <p style="font-size:12px;line-height:1.6;color:#9A8478;margin:16px 0 0;">
            This link expires in 7 days. If you didn't create a ${label} account, you can ignore this email.
          </p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#B5A79C;margin:18px 0 0;">© Duyên · duyen.io</p>
    </td></tr>
  </table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!RESEND_API_KEY) return json({ error: "Email not configured" }, 500);

  // Caller identity comes from their own token, not the request body.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: authHeader, apikey: ANON } });
  if (!ures.ok) return json({ error: "Not authenticated" }, 401);
  const user = await ures.json();
  if (!user?.id || !user?.email) return json({ error: "Not authenticated" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const app = APPS[String(body.app || "duyen")] ? String(body.app) : "duyen";
  const cfg = APPS[app];

  // Already confirmed? Don't re-send (e.g. banner "Resend" after verifying elsewhere).
  const existing = await (await sr(
    `email_verifications?user_id=eq.${user.id}&select=verified_at`
  )).json().catch(() => []);
  if (Array.isArray(existing) && existing[0]?.verified_at) {
    return json({ ok: true, already: true });
  }

  const token = makeToken();
  const token_hash = await sha256hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Upsert on user_id (PK). verified_at is omitted so an existing unverified row
  // keeps its null; a new row defaults to null.
  const up = await sr(`email_verifications?on_conflict=user_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: user.id, email: user.email, app,
      token_hash, sent_at: now.toISOString(), expires_at: expires.toISOString(),
    }),
  });
  if (!up.ok) {
    const t = await up.text().catch(() => "");
    return json({ error: "Could not record verification", detail: t }, 500);
  }

  const link = `${cfg.base}/?verify=${token}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.from,
      to: [user.email],
      reply_to: cfg.from,
      subject: `Confirm your email · ${cfg.label}`,
      html: emailHtml(cfg.label, link),
      text: `Welcome to ${cfg.label}.\n\nConfirm your email by opening this link:\n${link}\n\nThis link expires in 7 days. If you didn't create an account, you can ignore this email.`,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return json({ error: "Could not send email", detail: t }, 502);
  }
  return json({ ok: true });
});
