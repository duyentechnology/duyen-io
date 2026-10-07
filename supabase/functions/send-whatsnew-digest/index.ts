// send-whatsnew-digest — email each customer a roundup of NEW promotions from the
// businesses they saved to their tapestry (the email form of syncPromoNotifications).
//
// Privileged batch job, not user-facing: protected by a shared secret header
// (x-digest-secret == DIGEST_SECRET), deployed with verify_jwt=false so a cron or
// admin can call it. It reads candidates from the whatsnew_digest_candidates() SQL
// function (which applies the per-user "new since last digest" watermark + opt-in),
// sends one email per customer via Resend from hello@duyen.io, then advances each
// customer's last_digest_at so the same promo is never emailed twice.
//
// CAN-SPAM: every email carries a working one-click unsubscribe (List-Unsubscribe
// header + visible link, both hitting digest-unsubscribe with the user's token) and
// a physical postal address (DIGEST_POSTAL_ADDRESS).
//
// Body options: { dryRun?: boolean } — dryRun returns the counts without sending.
// Secrets: RESEND_API_KEY, DIGEST_SECRET, DIGEST_POSTAL_ADDRESS (optional).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const DIGEST_SECRET = Deno.env.get("DIGEST_SECRET") || "";
const POSTAL = Deno.env.get("DIGEST_POSTAL_ADDRESS") || "Duyên · California, USA";

const FROM = "Duyên <hello@duyen.io>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-digest-secret",
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
const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Ensure a digest_prefs row exists (so we have an unsubscribe token); return it.
async function ensurePrefs(userId: string): Promise<{ unsubscribe_token: string } | null> {
  const r = await sr(`digest_prefs?on_conflict=user_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : rows;
}

function digestHtml(promos: any[], unsubUrl: string): string {
  const cards = promos.map((p) => {
    const photo = Array.isArray(p.photos) && p.photos[0] ? String(p.photos[0]) : "";
    const img = photo
      ? `<tr><td style="padding:0 0 10px;"><img src="${esc(photo)}" alt="" style="width:100%;max-width:468px;border-radius:12px;display:block;"></td></tr>`
      : "";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #E8DDD6;border-radius:14px;overflow:hidden;background:#fff;">
      <tr><td style="padding:16px 18px 6px;">
        <div style="font-family:Georgia,'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#8B3A7F;">${esc(p.business)}</div>
      </td></tr>
      ${img ? `<tr><td style="padding:4px 18px 0;">` + img.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, "") + `</td></tr>` : ""}
      <tr><td style="padding:6px 18px 18px;">
        <div style="font-size:15px;line-height:1.6;color:#3D2E24;white-space:pre-wrap;">${esc(p.text || "")}</div>
      </td></tr>
    </table>`;
  }).join("");

  return `<!doctype html><html><body style="margin:0;background:#faf7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2E2A28;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f4;padding:28px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:504px;padding:0 18px;">
        <tr><td style="text-align:center;padding:0 0 18px;">
          <div style="font-size:28px;color:#DA251D;line-height:1;">緣</div>
          <div style="font-size:12px;font-weight:700;letter-spacing:3px;color:#DA251D;margin-top:5px;">DUYÊN</div>
          <h1 style="font-family:Georgia,serif;font-size:22px;color:#8B3A7F;margin:18px 0 4px;">What's new</h1>
          <p style="font-size:14px;color:#6B5751;margin:0;">From the shops you saved to your tapestry</p>
        </td></tr>
        <tr><td>${cards}</td></tr>
        <tr><td style="text-align:center;padding:12px 0 0;">
          <a href="https://duyen.io" style="display:inline-block;background:#8B3A7F;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 26px;border-radius:10px;">Open your tapestry</a>
        </td></tr>
        <tr><td style="text-align:center;padding:22px 8px 0;border-top:1px solid #EFE7E0;margin-top:20px;">
          <p style="font-size:11px;line-height:1.6;color:#9A8478;margin:14px 0 0;">
            You're getting this because you saved one of these shops on Duyên.<br>
            <a href="${esc(unsubUrl)}" style="color:#8B3A7F;">Unsubscribe from What's New</a><br>
            ${esc(POSTAL)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!DIGEST_SECRET || req.headers.get("x-digest-secret") !== DIGEST_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!RESEND_API_KEY) return json({ error: "Email not configured" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const dryRun = body?.dryRun === true;

  const cres = await sr(`rpc/whatsnew_digest_candidates`, { method: "POST", body: "{}" });
  if (!cres.ok) {
    const t = await cres.text().catch(() => "");
    return json({ error: "Could not load candidates", detail: t }, 500);
  }
  const candidates: any[] = await cres.json().catch(() => []);

  if (dryRun) {
    return json({
      dryRun: true,
      recipients: candidates.length,
      promos_total: candidates.reduce((n, c) => n + (c.promos?.length || 0), 0),
      sample: candidates.slice(0, 3).map((c) => ({ email: c.email, promos: c.promos?.length || 0 })),
    });
  }

  let sent = 0, failed = 0;
  const errors: string[] = [];
  for (const c of candidates) {
    try {
      const prefs = await ensurePrefs(c.user_id);
      if (!prefs?.unsubscribe_token) { failed++; errors.push(`${c.user_id}: no token`); continue; }
      const unsubUrl = `${SUPABASE_URL}/functions/v1/digest-unsubscribe?token=${prefs.unsubscribe_token}`;
      const promos = Array.isArray(c.promos) ? c.promos : [];
      const n = promos.length;
      const subject = n === 1
        ? `What's new from ${promos[0].business} · Duyên`
        : `What's new from ${n} shops you saved · Duyên`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: [c.email],
          subject,
          html: digestHtml(promos, unsubUrl),
          headers: {
            "List-Unsubscribe": `<${unsubUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });
      if (!res.ok) { failed++; errors.push(`${c.email}: ${await res.text().catch(() => res.status)}`.slice(0, 160)); continue; }

      // Advance the watermark so these promos are never re-sent.
      await sr(`digest_prefs?user_id=eq.${c.user_id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_digest_at: new Date().toISOString() }),
      });
      sent++;
    } catch (e) {
      failed++; errors.push(`${c.email || c.user_id}: ${String((e as Error)?.message || e)}`.slice(0, 160));
    }
  }
  return json({ ok: true, sent, failed, errors: errors.slice(0, 20) });
});
