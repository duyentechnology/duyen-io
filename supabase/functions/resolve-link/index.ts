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
    const ogImage = html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1] || html.match(/<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;
    const ogDesc = html.match(/<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] || html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;
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
      fetched_at: new Date().toISOString()
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
