// share-preview — per-business link previews for shared QR pages.
//
// duyen.io/_redirects proxies /s/<code> to this function. Link-preview
// crawlers (iMessage, WhatsApp, etc.) read the og tags below and render a
// card with the business's own name + logo; human visitors are immediately
// forwarded to the real page at duyen.io/q/<code>?v=share by the script.
// The redirect is JS-only on purpose: a meta refresh can be followed by
// preview crawlers, which would land them on the generic app-shell tags.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

Deno.serve(async (req: Request) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  let code = parts[parts.length - 1] || "";
  if (code === "share-preview" || !/^[A-Za-z0-9-]{1,64}$/.test(code)) code = "";
  const target = code ? `https://duyen.io/q/${code}?v=share` : "https://duyen.io/";

  let name = "", logo = "", desc = "";
  if (code) {
    try {
      const filter = /^[0-9a-f-]{36}$/i.test(code)
        ? `id=eq.${code}`
        : `url=eq.${encodeURIComponent("https://duyen.io/q/" + code)}`;
      const r = await fetch(
        `${SB_URL}/rest/v1/qr_codes?select=business_data&limit=1&${filter}`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
      );
      const rows = await r.json();
      const biz = rows?.[0]?.business_data;
      if (biz) {
        name = (biz.name || "").trim();
        logo = (biz.logo || "").trim();
        desc = (biz.description || "").trim();
      }
    } catch (_e) {
      // fall through to generic tags
    }
  }

  const title = name ? `${name} on Duyên` : "Duyên — Your Life's Tapestry";
  const description = desc || "Every thread has an origin.";
  const image = /^https:\/\//.test(logo) ? logo : "https://duyen.io/icon-512.png";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:site_name" content="Duyên">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(target)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:image" content="${esc(image)}">
</head>
<body>
<p><a href="${esc(target)}">Open ${esc(name || "Duyên")}</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
});
