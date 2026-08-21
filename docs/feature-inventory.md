# Duyên — Complete Feature Inventory

*As shipped in production, August 2026. Compiled from the live codebase (`index.html`, `sw.js`, Supabase migrations 0001–0024, edge functions, Netlify functions). Companion to `docs/business-plan.md` and `docs/duyen-pitch-deck.pptx`.*

**Intended use:** source material for marketing planning and early-investor outreach. Everything listed here is built and live unless marked otherwise.

---

## 1. What Duyên is (one paragraph)

Duyên is a QR-native platform, live on two domains sharing one backend: **duyen.io** turns gifts, moments, and places into a personal "life tapestry" people revisit forever; **dayduyen.tech** (the business app) gives small businesses QR profiles and per-product QR codes ("modulars") that turn every tag into a storefront and every scanned product into a keepsake in the customer's tapestry. Payments run through Stripe; the whole consumer app is an installable PWA with no app store between us and the user.

---

## 2. Consumer app — duyen.io

### Moments & the tapestry
- **Add a moment** — photos, video, or voice notes plus a written message, **dated to when it actually happened** (not when it was uploaded).
- **Tapestry timeline** — a life view woven month by month; collage layouts, month strips, stacked cards, featured photos, and a full-card detail view.
- **Tapestry search & filtering** — fuzzy search across the tapestry (typo-tolerant scoring), category filtering, month switching.
- **Inline editing** — edit moments in place: reorder media by drag, add/remove photos, re-record voice notes, edit text.
- **Lightbox media viewer** — full-screen photo/video browsing with navigation, video thumbnail capture, and captions.
- **Private memory layer** — personal annotations on saved business/shared entries that stay private to the saver (never visible to the business or other savers, never overwritten by profile updates).

### Giving & receiving
- **Give a moment** — author a message + media onto a physical Duyên QR note for someone special; they scan it and it becomes a permanent thread in *their* story.
- **Receiver responses** — the receiver can respond with their own message/media; giver and receiver each see the exchange from their side (dedicated giver/receiver views and RPCs).
- **Secret phrase lock** — optionally lock a moment with a word or phrase only the receiver would know.
- **Live preview** — "Preview how they'll see it" renders the exact receiver experience before sending.
- **Drafts** — save unfinished moments and resume later; nothing sent, no token spent.
- **Share links with rich previews** — every shared page gets a proper iMessage/WhatsApp link-preview card with the sender's or business's own name and image (dedicated share-preview service at `/s/<code>`), plus share counting.

### The link vault
- **Save any QR or link** — scan any external QR code or paste any URL into a private vault; automatic title/description/image resolution (server-side metadata fetch), site icons, edit, share, and delete. Never lose a link again.
- **External QR notes** — attach your own note, date, and photos to an external QR/link so even third-party codes become memories.

### Scanning
- **Built-in camera QR scanner** (vendored html5-qrcode, works offline-capable in the PWA) plus manual URL entry.
- **Smart routing on scan** — the app recognizes what was scanned: a Duyên moment, a business profile, a product or menu modular, an unclaimed business card (routed to claiming), or an external code (routed to the vault).

### Accounts, notifications, PWA
- **Auth** — email/password with verification codes, Google sign-in, Apple relay-friendly; password reset flow; multi-domain aware (accounts work across duyen.io and dayduyen.tech).
- **Notifications** — in-app notification center with badge, polling, mark-all-read, per-item delete and stale-notification handling (e.g., when a moment is claimed or a response arrives).
- **Installable PWA** — add-to-home-screen prompts (with iOS-specific instructions), standalone display, custom icons, service worker.
- **Token wallet** — visible token balance with a progress track, purchase flow, and clear free-allowance messaging.

---

## 3. Business platform — dayduyen.tech + shared backend

- **Business accounts & entitlement ladder** — a single server-side entitlements row per business gates every feature (no client-side trust): free card-claim origin, $20 direct unlock, Insights plan, Boutique plan.
- **QR generator** — businesses generate their own branded QR profile code (per-profile generator with claim flow).
- **Business profiles** — public profile with About and What's New sections, shown to anyone who scans; profile edits propagate to every saved copy.
- **Modulars (product & menu QRs)** — one generated QR = the business profile + one modular's content (a product, a menu, …). First bundled in the $20 unlock; each additional $10. Scan renders profile → About → product as a collapsible card.
- **Product keepsakes** — when a customer saves a scanned product, the keepsake shows *the item itself* in their tapestry — the product becomes a memory, and the business stays present in the customer's life.
- **Storefront rendering** — product scans present the business's full context (profile, story, product data) in the consumer app with collapsible sections.
- **Physical card programs** — Duyên Note cards and **print runs**: batches of physical QR cards tracked per-card, with activation states (`qr_activated_at`), kind/label tagging on activation, and product attachment to cards.
- **Business claim flow** — unclaimed codes scanned by anyone route to the business claim on dayduyen.tech; claiming keeps the source and attaches the profile.
- **Insights plan ($9.99/mo)** — scan analytics + push promotions to savers.
- **Boutique plan ($19.99/mo)** — multi-QR minting at $0.10/code via prepaid mint credits.

---

## 4. Monetization infrastructure (all live on Stripe)

- **Consumer moment tokens** — first 10 moments free, then $5 per 5-pack; token spend/credit ledger server-side.
- **Business checkout** — one-time ($20 generator) and subscription (Insights/Boutique) checkouts via a dedicated edge function.
- **Mint-credit top-ups** — prepaid $0.10/QR credits with an idempotent purchase ledger (webhook retries can never double-credit).
- **Modular credits** — $10 one-time credits with their own idempotent ledger.
- **One Stripe webhook for both products** — manual HMAC signature verification, handles token credits, tier grants, and full subscription lifecycle (renewal, dunning/past-due, cancellation).

---

## 5. Platform, security & operations

- **Single-page PWA, no build step** — the entire consumer app is one HTML file plus a service worker; deploys are a push to `main`.
- **Cost-engineered service worker** — Supabase Storage images cached cache-first with FIFO eviction (stops repeat scans from re-billing storage egress); DB/auth never cached; app shell always fetched fresh so deploys appear on next open.
- **Image pipeline** — client-side compression before upload, server-side thumbnail transforms with verified dimensions, upload progress UI, video thumbnail capture.
- **Row-level security throughout** — clients can only read their own rows; all writes to money/entitlement tables go through SECURITY DEFINER functions or the service role; anon table rights revoked; scoped read policies (24 migrations of hardened schema).
- **Funnel analytics (admin)** — a moment-funnel view across all users answering "does a gift actually make it all the way to someone?", gated to the admin.
- **Share/save counters** — per-code share counts and save counts for engagement measurement.
- **Two-domain routing** — duyen.io (canonical) and dayduyen.tech share one codebase and account system; `/q/*` and `/s/*` route shortcodes to the app.
- **CSP-hardened** — strict Content-Security-Policy, no third-party scripts beyond vendored libraries and fonts.

---

## 6. Numbers marketing can use

| Fact | Value |
|---|---|
| Consumer pricing | First 10 moments free, then $5 / 5-pack ($1 per moment) |
| Business entry price | Free with a physical card, or $20 one-time |
| Additional product QRs | $10 each |
| Insights subscription | $9.99/mo (analytics + push promotions) |
| Boutique subscription | $19.99/mo + $0.10 per minted QR |
| Time from deploy to user | Minutes (static deploy; PWA refreshes app shell on next open) |
| App store dependency | None — installable PWA, web payments (no 30% platform tax) |
| Backend | Supabase (Postgres + RLS + edge functions), Stripe |

---

## 7. Positioning hooks (for the marketing plan)

- **"A gift that outlives the wrapping paper."** The gifting flow (secret phrase, voice notes, dated moments, receiver responses) is unique versus greeting cards and generic link-in-QR tools.
- **"Your products, remembered."** Product keepsakes are a genuinely novel retail mechanic: a scanned product becomes part of the customer's life story, not a marketing impression.
- **"Compliance that tells your story."** The modular architecture doubles as EU Digital Product Passport / California SB 707 infrastructure for small brands (see business plan §6).
- **Physical-digital moat** — print runs, card activation, and claim flows mean Duyên exists in drawers, gift boxes, and on garment tags — not just in a browser tab.
- **Trust posture** — secret phrases, private memory layers, strict RLS, and no ads: codes resolve to owned, personal content.

## 8. Not built yet (do not promise externally)

DPP compliance data fields (fiber/origin/care schema), marketplace checkout ("buy again / gift this"), premium tapestry tier, printed yearbooks, family sharing, white-label print partnerships. These are roadmap items in the business plan — label them as such in any deck or outreach.
