// vet-link — validate a business profile's website / social URLs at submit time.
//
// Called by the profile editor with the links that were added or changed. Each
// URL runs a fixed battery of checks; a link that passes ALL of them is 'live'
// immediately, otherwise it is 'flagged' with the reasons recorded and held out
// of the public fan-out until an admin approves it. Fail-closed: a check that
// cannot complete (Safe Browsing down/missing key, an unreachable site) flags
// the link rather than letting it through.
//
// Auth: the caller (verified via /auth/v1/user) is always the link owner —
// callers can only vet their own profile's links. Writes use the service role.
//
// Secrets: GOOGLE_SAFE_BROWSING_KEY (optional; absent => that check is
// inconclusive => the link is flagged for manual review).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SR   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GSB_KEY = Deno.env.get("GOOGLE_SAFE_BROWSING_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const KINDS = ["website","facebook","pinterest","youtube","yelp","linkedin","x","instagram","tiktok"];

// Known link shorteners — flagged so a masked destination can't go live unseen.
const SHORTENERS = new Set([
  "bit.ly","tinyurl.com","t.co","goo.gl","ow.ly","is.gd","buff.ly","rebrand.ly",
  "cutt.ly","t.ly","rb.gy","shorturl.at","bl.ink","lnkd.in","tiny.cc","soo.gd",
  "s.id","v.gd","clck.ru","qrco.de","short.io","snip.ly","trib.al","amzn.to",
  "fb.me","youtu.be","wa.me","forms.gle","g.co","mzl.la",
]);

// A few multi-label public suffixes so eTLD+1 comparison doesn't treat
// e.g. example.co.uk as suffix "co.uk". Heuristic, not the full PSL.
const MULTI_SUFFIX = new Set([
  "co.uk","org.uk","gov.uk","ac.uk","me.uk","com.au","net.au","org.au","com.br",
  "com.mx","co.nz","co.jp","co.in","co.kr","co.za","com.sg","com.hk","com.tw",
]);

function registrable(host: string): string {
  const h = (host || "").toLowerCase().replace(/\.$/, "");
  const p = h.split(".");
  if (p.length <= 2) return h;
  const last2 = p.slice(-2).join(".");
  if (MULTI_SUFFIX.has(last2)) return p.slice(-3).join(".");
  return last2;
}

async function follow(url: string): Promise<{ ok: boolean; status?: number; finalUrl?: string; error?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    // GET (not HEAD — many hosts reject HEAD); we only need where it lands.
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctl.signal,
      headers: { "User-Agent": "DuyenLinkVetter/1.0 (+https://duyen.io)" },
    });
    return { ok: true, status: res.status, finalUrl: res.url };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function safeBrowsing(urls: string[]): Promise<{ checked: boolean; safe: boolean; note?: string }> {
  if (!GSB_KEY) return { checked: false, safe: false, note: "no_key" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(GSB_KEY)}`,
      {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "duyen", clientVersion: "1.0" },
          threatInfo: {
            threatTypes: ["MALWARE","SOCIAL_ENGINEERING","UNWANTED_SOFTWARE","POTENTIALLY_HARMFUL_APPLICATION"],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [...new Set(urls.filter(Boolean))].map((u) => ({ url: u })),
          },
        }),
      },
    );
    if (!res.ok) return { checked: false, safe: false, note: "api_" + res.status };
    const data = await res.json();
    const hasMatch = Array.isArray(data.matches) && data.matches.length > 0;
    return { checked: true, safe: !hasMatch };
  } catch (e) {
    return { checked: false, safe: false, note: String((e as Error)?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// Run the full battery on one URL. reasons empty => live.
async function vetOne(rawUrl: string) {
  const checks: Record<string, unknown> = {};
  const reasons: string[] = [];
  let finalUrl: string | null = null;
  let submittedDomain: string | null = null;
  let finalDomain: string | null = null;
  let isShortener = false;

  // 1. Well-formed + https only.
  let u: URL | null = null;
  try { u = new URL(rawUrl); } catch { /* invalid */ }
  if (!u || u.protocol !== "https:") {
    checks.https = false;
    reasons.push("invalid_url");
    return { status: "flagged", reasons, checks, final_url: null, submitted_domain: null, final_domain: null, is_shortener: false };
  }
  checks.https = true;
  submittedDomain = registrable(u.hostname);

  // 2. Shortener.
  if (SHORTENERS.has(u.hostname.toLowerCase().replace(/^www\./, ""))) {
    isShortener = true;
    reasons.push("shortener");
  }
  checks.shortener = isShortener;

  // 3. Resolves + redirect destination.
  const f = await follow(rawUrl);
  if (!f.ok || (f.status !== undefined && f.status >= 500)) {
    reasons.push("dead_link");             // unreachable/timeout/5xx (fail-closed)
    checks.resolve = { ok: false, status: f.status ?? null, error: f.error ?? null };
  } else {
    finalUrl = f.finalUrl || rawUrl;
    let fu: URL | null = null;
    try { fu = new URL(finalUrl); } catch { /* keep null */ }
    finalDomain = fu ? registrable(fu.hostname) : null;
    checks.resolve = { ok: true, status: f.status ?? null, final_url: finalUrl };
    if (finalDomain && submittedDomain && finalDomain !== submittedDomain) {
      reasons.push("redirect_mismatch");   // lands on a genuinely different site
    }
    checks.redirect = { submitted_domain: submittedDomain, final_domain: finalDomain,
                        mismatch: !!(finalDomain && submittedDomain && finalDomain !== submittedDomain) };
  }

  // 4. Google Safe Browsing (submitted + final). Inconclusive => fail-closed.
  const sb = await safeBrowsing([rawUrl, finalUrl || ""].filter(Boolean));
  checks.safebrowsing = sb;
  if (sb.checked && !sb.safe) reasons.push("unsafe");
  else if (!sb.checked) reasons.push("safebrowsing_unavailable");

  return {
    status: reasons.length === 0 ? "live" : "flagged",
    reasons, checks, final_url: finalUrl,
    submitted_domain: submittedDomain, final_domain: finalDomain, is_shortener: isShortener,
  };
}

async function sr(path: string, init: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Authenticate the caller = link owner.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: authHeader, apikey: ANON } });
  if (!ures.ok) return json({ error: "Not authenticated" }, 401);
  const user = await ures.json();
  if (!user?.id) return json({ error: "Not authenticated" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const profileId = String(body.profileId || "").trim();
  const links = body.links && typeof body.links === "object" ? body.links : null;
  if (!profileId || !links) return json({ error: "profileId and links required" }, 400);

  const results: Record<string, any> = {};
  for (const [kind, rawVal] of Object.entries(links)) {
    if (!KINDS.includes(kind)) continue;
    const raw = String(rawVal ?? "").trim();

    // Cleared slot => remove any existing record (owner un-set the link).
    if (!raw) {
      await sr(`business_links?user_id=eq.${user.id}&profile_id=eq.${encodeURIComponent(profileId)}&kind=eq.${kind}`,
               { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await sr(`link_review_audit`, { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: user.id, profile_id: profileId, kind, url: null, event: "removed", actor: user.id, detail: { by: "owner_cleared" } }) });
      results[kind] = { status: "removed" };
      continue;
    }

    const v = await vetOne(raw);

    // Upsert the current verdict for this slot (resets any prior decision).
    const row = {
      user_id: user.id, profile_id: profileId, kind, url: raw,
      final_url: v.final_url, submitted_domain: v.submitted_domain, final_domain: v.final_domain,
      status: v.status, reasons: v.reasons, checks: v.checks, is_shortener: v.is_shortener,
      updated_at: new Date().toISOString(), decided_at: null, decided_by: null,
    };
    const up = await sr(`business_links?on_conflict=user_id,profile_id,kind`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    const saved = await up.json().catch(() => null);
    const linkId = Array.isArray(saved) && saved[0]?.id ? saved[0].id : null;

    // Audit: the submission + the automatic decision.
    await sr(`link_review_audit`, { method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([
        { link_id: linkId, user_id: user.id, profile_id: profileId, kind, url: raw, event: "submitted", actor: user.id, detail: v.checks },
        { link_id: linkId, user_id: user.id, profile_id: profileId, kind, url: raw, event: v.status === "live" ? "auto_live" : "auto_flagged", actor: "system", detail: { reasons: v.reasons } },
      ]) });

    results[kind] = { status: v.status, reasons: v.reasons, final_url: v.final_url, link_id: linkId };
  }

  return json({ ok: true, profileId, results });
});
