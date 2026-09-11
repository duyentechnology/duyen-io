// link-admin — admin-only review actions for vetted business links.
//
// Actions (POST { action, ... }):
//   list                       -> flagged links across all businesses (+ business name)
//   approve { link_id }        -> status=live, publish the link, audit
//   reject  { link_id }        -> status=rejected, strip from public, audit, notify owner
//   remove  { link_id }        -> (for a live link) status=removed, strip, audit, notify owner
//
// Only redruffles@live.com may call this — verified from the caller's own auth
// token, not from anything client-supplied. All writes use the service role.
// Publishing/stripping edits the PUBLIC copy (qr_codes.business_data) directly so
// an approval shows and a reject/remove disappears everywhere immediately.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SR   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAIL = "redruffles@live.com";

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
const one = async (r: Response) => { const d = await r.json().catch(() => null); return Array.isArray(d) ? d[0] : d; };

// Set (or clear) the public copy of a link across the owner's codes for a profile.
async function setPublic(ownerId: string, profileId: string, kind: string, value: string) {
  const rows = await (await sr(
    `qr_codes?business_user_id=eq.${ownerId}&business_data->>profileId=eq.${encodeURIComponent(profileId)}&select=id,business_data`
  )).json().catch(() => []);
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const bd = row.business_data || {};
    if (kind === "website") bd.website = value;
    else bd.social = { ...(bd.social || {}), [kind]: value };
    await sr(`qr_codes?id=eq.${row.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ business_data: bd }),
    });
  }
  return Array.isArray(rows) ? rows.length : 0;
}

async function audit(link: any, event: string, actor: string, detail: unknown) {
  await sr(`link_review_audit`, { method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ link_id: link.id, user_id: link.user_id, profile_id: link.profile_id,
      kind: link.kind, url: link.url, event, actor, detail }) });
}

async function notify(link: any, type: string, title: string, message: string) {
  // (1) in-app notice for the owner's dashboard banner
  await sr(`owner_notices`, { method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: link.user_id, type, title, message, link_id: link.id }) });
  // (2) email hook — wired later; see docs. Intentionally a no-op for now so the
  //     "both" choice has a single place to add a provider without touching callers.
  // await sr-invoke send-email ...
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: authHeader, apikey: ANON } });
  if (!ures.ok) return json({ error: "Not authenticated" }, 401);
  const user = await ures.json();
  if (!user?.id) return json({ error: "Not authenticated" }, 401);
  if ((user.email || "").toLowerCase() !== ADMIN_EMAIL) return json({ error: "Forbidden" }, 403);
  const adminId = user.id;

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || "list");

  if (action === "list") {
    const status = String(body.status || "flagged");
    const rows = await (await sr(
      `business_links?status=eq.${status}&order=created_at.desc&select=*`
    )).json().catch(() => []);
    // Enrich with business name from each owner's profile.
    const ids = [...new Set((rows || []).map((r: any) => r.user_id))];
    const nameById: Record<string, string> = {};
    if (ids.length) {
      const profs = await (await sr(
        `profiles?id=in.(${ids.join(",")})&select=id,business_profile`
      )).json().catch(() => []);
      for (const p of (profs || [])) nameById[p.id] = p.business_profile?.name || "";
    }
    // Usage signal: Safe Browsing checks (one per submitted link) in the last
    // 30 days, so the admin panel can nudge the move to Web Risk at scale.
    let usage30d = 0;
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const cr = await sr(`link_review_audit?select=id&event=eq.submitted&created_at=gte.${since}&limit=1`,
        { headers: { Prefer: "count=exact", Range: "0-0" } });
      const m = (cr.headers.get("content-range") || "").match(/\/(\d+)$/);
      if (m) usage30d = parseInt(m[1], 10);
    } catch { /* best-effort */ }
    return json({ ok: true, usage30d, links: (rows || []).map((r: any) => ({ ...r, business_name: nameById[r.user_id] || "" })) });
  }

  const linkId = String(body.link_id || "");
  if (!linkId) return json({ error: "link_id required" }, 400);
  const link = await one(await sr(`business_links?id=eq.${linkId}&select=*`));
  if (!link) return json({ error: "link not found" }, 404);

  const now = new Date().toISOString();

  if (action === "approve") {
    await sr(`business_links?id=eq.${linkId}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "live", reasons: [], decided_at: now, decided_by: adminId, updated_at: now }) });
    const n = await setPublic(link.user_id, link.profile_id, link.kind, link.url);
    await audit(link, "approved", adminId, { published_to_codes: n });
    return json({ ok: true, action, status: "live" });
  }

  if (action === "reject" || action === "remove") {
    const newStatus = action === "reject" ? "rejected" : "removed";
    await sr(`business_links?id=eq.${linkId}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: newStatus, decided_at: now, decided_by: adminId, updated_at: now }) });
    const n = await setPublic(link.user_id, link.profile_id, link.kind, "");   // strip from public
    await audit(link, newStatus, adminId, { stripped_from_codes: n });
    const label = link.kind === "website" ? "website" : (link.kind + " link");
    await notify(link,
      action === "reject" ? "link_rejected" : "link_removed",
      action === "reject" ? "A link was not approved" : "A link was removed",
      `Your ${label} (${link.url}) was ${action === "reject" ? "not approved" : "removed"} and is no longer shown on your public profile.`);
    return json({ ok: true, action, status: newStatus });
  }

  return json({ error: "unknown action" }, 400);
});
