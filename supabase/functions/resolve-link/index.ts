// Supabase Edge Function: resolve-link
// Takes { id, url }, fetches the URL (following redirects), parses title/og:image/description,
// and updates qr_codes.link_meta on the matching row.
//
// Deploy: paste this into Supabase Dashboard → Edge Functions → New function (name: resolve-link)
// or via CLI: supabase functions deploy resolve-link
//
// Env (auto-provided by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body, status = 200)=>new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json"
    }
  });

// Decode HTML entities in extracted meta values. og/twitter `content="..."` attributes and
// <title> text are HTML-escaped in the source markup (e.g. &amp; &#39; &quot; &#x2013;), so the
// raw regex captures must be decoded before storing — otherwise a literal "&amp;" corrupts image
// query strings (breaking the preview image) and mangles titles like "Q&amp;A".
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h)=>{ try { return String.fromCodePoint(parseInt(h, 16)); } catch (_) { return _; } })
    .replace(/&#(\d+);/g, (_, d)=>{ try { return String.fromCodePoint(parseInt(d, 10)); } catch (_) { return _; } })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // must be last so "&amp;lt;" doesn't become "<"
}

Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  try {
    const { id, url } = await req.json();
    if (!id || !url) return json({
      error: "missing id or url"
    }, 400);
    // ---- Verify the caller owns the qr_codes row (ownership check) ----
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({
      error: "unauthorized"
    }, 401);
    const { data: row, error: rowErr } = await userClient.from("qr_codes").select("user_id").eq("id", id).single();
    if (rowErr || !row || row.user_id !== userData.user.id) {
      return json({
        error: "forbidden"
      }, 403);
    }
    // ---- Fetch the URL with redirect-follow and an 8s timeout ----
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 8000);
    let resolvedUrl = url;
    let html = "";
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Duyen-LinkResolver/1.0; +https://duyen.io)",
          "Accept": "text/html,application/xhtml+xml"
        }
      });
      resolvedUrl = res.url || url;
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("text/html")) {
        // Limit to first ~200KB — meta tags live near the top
        const reader = res.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let bytes = 0;
          while(bytes < 200_000){
            const { done, value } = await reader.read();
            if (done) break;
            html += decoder.decode(value, {
              stream: true
            });
            bytes += value.length;
          }
          try {
            await reader.cancel();
          } catch (_) {}
        }
      }
    } finally{
      clearTimeout(timer);
    }
    // ---- Parse title, og:image, og:description ----
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    // Declared preview image. The first three cover the mainstream forms; the
    // rest are variants real sites use that were previously invisible to us —
    // a page carrying only og:image:secure_url or <link rel="image_src"> read
    // as having no image at all, and fell back to a favicon tile.
    // Every one of these is a preview image the SITE declared. Nothing here
    // guesses at <img> tags in the body, so we can never pick up a tracking
    // pixel or a spacer.
    const imagePatterns = [
      /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
      /<meta\s+[^>]*property=["']og:image:secure_url["'][^>]*content=["']([^"']+)["']/i,
      /<meta\s+[^>]*property=["']og:image:url["'][^>]*content=["']([^"']+)["']/i,
      /<meta\s+[^>]*name=["']twitter:image:src["'][^>]*content=["']([^"']+)["']/i,
      /<meta\s+[^>]*itemprop=["']image["'][^>]*content=["']([^"']+)["']/i,
      /<link\s+[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
      /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']image_src["']/i
    ];
    let ogImage = null;
    for (const re of imagePatterns){
      const m = html.match(re);
      if (m?.[1]) { ogImage = m[1]; break; }
    }
    // Which tag answered — so a link that still comes back without an image can
    // be diagnosed from the stored row instead of guessed at.
    const imageSource = ogImage ? imagePatterns.findIndex((re)=>html.match(re)?.[1] === ogImage) : -1;
    const ogDesc = html.match(/<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] || html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;

    // ---- The site's own icon, for links that declare no preview image ----
    // Falling back to Google's favicon service gives a 16px mark upscaled, or a
    // generic globe for sites it has never indexed. Most sites publish an
    // apple-touch-icon — typically 180px and usually the real logo — so read it
    // straight from the page instead.
    //
    // rel="icon" is only accepted when it declares a size of 96px or more: an
    // undeclared favicon.ico is usually 16px and would be worse than what we
    // already have.
    function pickIcon(markup) {
      const links = markup.match(/<link\b[^>]*>/gi) || [];
      let best = null;
      for (const tag of links){
        const rel = tag.match(/rel\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";
        const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
        if (!href) continue;
        const isApple = /\bapple-touch-icon(-precomposed)?\b/.test(rel);
        const isIcon  = /\b(shortcut\s+)?icon\b/.test(rel) && !/mask-icon/.test(rel);
        if (!isApple && !isIcon) continue;
        // An SVG icon scales perfectly, so treat it as large.
        const isSvg = /\.svg(\?|$)/i.test(href);
        const sizes = tag.match(/sizes\s*=\s*["'](\d+)\s*[xX]\s*(\d+)["']/i);
        const px = isSvg ? 512 : (sizes ? parseInt(sizes[1], 10) : (isApple ? 180 : 0));
        if (isIcon && !isApple && px < 96) continue;   // tiny favicon: not an upgrade
        // Apple icons win ties — they are the ones designed to be seen big.
        const score = px + (isApple ? 1000 : 0);
        if (!best || score > best.score) best = { href, score, px };
      }
      return best;
    }
    const iconPick = pickIcon(html);
    let iconUrl = iconPick ? decodeEntities(iconPick.href) : null;
    if (iconUrl && !/^https?:\/\//i.test(iconUrl)) {
      try { iconUrl = new URL(iconUrl, resolvedUrl).toString(); } catch (_) { iconUrl = null; }
    }
    // Decode HTML entities from the raw captures before any URL resolution or storage.
    const titleRaw = decodeEntities(titleMatch?.[1]?.trim().replace(/\s+/g, " ").slice(0, 300)) || null;
    const descRaw = decodeEntities(ogDesc?.trim().slice(0, 500)) || null;
    // Resolve relative image URLs to absolute
    let imageUrl = decodeEntities(ogImage);
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      try {
        imageUrl = new URL(imageUrl, resolvedUrl).toString();
      } catch (_) {
        imageUrl = null;
      }
    }
    const meta = {
      resolved_url: resolvedUrl,
      title: titleRaw,
      image: imageUrl,
      description: descRaw,
      fetched_at: new Date().toISOString(),
      // Diagnostics: distinguishes "the page declares no preview image" from
      // "we fetched nothing useful". Read from the stored row when a card comes
      // back imageless. Display code never reads these.
      image_tag: imageUrl ? imageSource : null,
      html_bytes: html.length,
      // The site's own logo. Used only when there is no preview image.
      icon: iconUrl,
      icon_px: iconPick ? iconPick.px : null
    };
    // ---- Update qr_codes.link_meta with service role (bypass RLS for write) ----
    const adminClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const { error: updErr } = await adminClient.from("qr_codes").update({
      link_meta: meta
    }).eq("id", id);
    if (updErr) return json({
      error: updErr.message,
      meta
    }, 500);
    return json({
      ok: true,
      meta
    });
  } catch (e) {
    return json({
      error: String(e?.message || e)
    }, 500);
  }
});
