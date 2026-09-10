# Duyên — End-to-End Flow & Test Plan

The canonical walkthrough of the whole product, written so it can drive both
automated Playwright tests and a scheduled Claude "smoke-run" agent. Each step
lists the **actor**, **screen/URL**, **action**, **selector** (real DOM id / text,
usable as a test locator), **expected result**, and the **backend** it touches.

> Keep this file in sync with the apps. When a screen, id, or flow changes,
> update the matching step here first — the tests and the agent read from this.

---

## 0. System shape

| | |
|---|---|
| **Customer app** | `duyen.io` (primary/canonical) — the tapestry PWA. Single file `index.html`. |
| **Business app** | `dayduyen.tech` (a.k.a. duyen.tech) — the operator PWA. Single file `index.html` in the `dayduyen-tech` repo. |
| **Backend** | One Supabase project, ref `qnlaaieyipeglfuepmor`, URL `https://qnlaaieyipeglfuepmor.supabase.co`. Edge functions in `supabase/functions/`. |
| **Auth** | Both apps: Supabase **email + password** (`signInWithPassword` / `signUp`) plus Google OAuth. **No magic-link in the main flows** — so a password test account logs in cleanly. |
| **Deploy** | Static, from each repo's `main` (Netlify-style, `_redirects`). No build step. Service worker caches the shell, so a new deploy needs a full PWA quit/reopen (or hard reload) to take effect. |
| **Payments** | Stripe is in **LIVE mode**. Automated tests must **not** run real checkout. Subscriber-gated paths are exercised with a DB-seeded test account instead (see §2). |

SW cache names (bump on every deploy): customer `duyen-app-vNN` (`duyen-io/sw.js`),
business `dayduyen-app-vNN` (`dayduyen-tech/sw.js`).

---

## 1. Environments

There is **no separate staging project** — one Supabase project serves prod.
Tests therefore run against production URLs using clearly-labelled test accounts
and test QR codes that are never deleted. Anything a test writes (a tapestry row,
a scan count bump) is either idempotent or cleaned up in teardown.

| Name | URL |
|---|---|
| Customer app | `https://duyen.io` |
| Business app | `https://dayduyen.tech` |
| Supabase REST | `https://qnlaaieyipeglfuepmor.supabase.co/rest/v1` |
| Supabase Auth | `https://qnlaaieyipeglfuepmor.supabase.co/auth/v1` |

---

## 2. Test data (seed once, reuse)

Provisioned via the service-role key by `e2e/seed.mjs` (never checked in with the
key — key comes from `SUPABASE_SERVICE_KEY` env). This keeps Stripe out of the loop:
the "subscriber" is made active directly in `business_accounts`, no charge.

| Fixture | What | How |
|---|---|---|
| `E2E_CUSTOMER_EMAIL` / `_PASSWORD` | A customer account on duyen.io | `auth.admin.createUser` (email confirmed) |
| `E2E_BIZ_EMAIL` / `_PASSWORD` | A business account, **Insights active** | createUser + `business_accounts` row `plan='insights', plan_status='active'` |
| `E2E_TEST_QR` | A stable, active QR code slug used as the scan target | insert into `qr_codes` (source `business`, a fixed test profile) |

Suggested values: `e2e-customer@duyen.test`, `e2e-biz@duyen.test`. `.test` never
receives mail, which is fine — no email confirmation is required.

---

## 3. The end-to-end journey

The story: **a business owner sets up a profile, generates a QR, subscribes to
Insights, and pushes a promo → a customer scans the code, saves it to their
tapestry, and sees the promo + a notification → the owner sees the scan/save
counts and analytics update.**

### Phase A — Business owner: sign up & profile  *(app: dayduyen.tech)*

| # | Action | Selector | Expected | Backend |
|---|---|---|---|---|
| A1 | Open app | — | `#landingView` visible when logged out | — |
| A2 | Open auth, switch to Create Account | `#headerBtn` → `toggleAuth()` | `#authModal.active`, `#signupForm` shown | — |
| A3 | Fill name/email/pw/confirm, submit | `#signupName`,`#signupEmail`,`#signupPassword`,`#signupPasswordConfirm`, `.btn-auth` "Create Account" | account created, `onAuthStateChange` fires, first-timer routed to `#bizProfileView` | `auth.signUp` |
| A4 | Fill business profile, save | `#bizProfileView` fields → save | profile persists; land on `#bizDashboardView` | `business_accounts` / profile rows |

### Phase B — Business owner: generate a QR

| # | Action | Selector | Expected | Backend |
|---|---|---|---|---|
| B1 | Start a new code | `#adminNewQR` "+ New QR" → `showView('mode')` | `#modeView` visible | — |
| B2 | Pick Single | card `selectMode('single')` | `#generatorView` + `#singleForm` | — |
| B3 | (admin only) pick kind | `#printKindNote/Business/Product` | highlight + `#stickerBgSection` shows only for admin+note | — |
| B4 | Set label/color, Generate | `#singleLabel`,`#colorPicker`, `.btn-primary` "🎯 Generate QR Code" → `generateQR()` | `#qrResult`/`#qrGrid` shows the rendered QR | insert into **`qr_codes`** (`saveQRToSupabase`) |

> Non-admin single generation requires a business profile (`requireBizProfile()`)
> and an entitlement (`canGenerateSingle()`); the seeded biz account has it.

### Phase C — Business owner: subscribe to Insights  *(documented; seeded in tests)*

| # | Action | Selector | Expected | Backend |
|---|---|---|---|---|
| C1 | Open upgrade | Insights paywall `#dashInsightsPaywall` → `startUpgrade('insights')` | `#startUpgradeModal` | — |
| C2 | Go to checkout | `#startUpgradeGo` → `beginBusinessCheckout('insights')` | redirect to Stripe Checkout URL | edge fn **`business-checkout`** |
| C3 | Pay | *(Stripe hosted page)* | on return `?upgrade=success`; `handleUpgradeReturn()` re-loads entitlements | **`stripe-webhook`** sets `business_accounts.plan/plan_status` |
| C4 | Verify entitlement | — | `canViewAnalytics()`/`canPush()` true; `#dashSubCard` appears | RPC `get_my_entitlements` |

> **Automated tests skip C1–C3** (live Stripe). The seed makes the account
> `plan='insights', plan_status='active'`, so C4's post-state is what tests assert.

### Phase D — Business owner: push a promo

| # | Action | Selector | Expected | Backend |
|---|---|---|---|---|
| D1 | Open composer on a profile | "Push a promo" → `openProfilePush(pid)` | inline composer; gated by `canPush()` | — |
| D2 | Type text (+ optional photos) | `#pushDraft_<pid>`, `#pushPhoto_<pid>` | live preview `#pushPreviewBox_<pid>` updates | Storage (photos) |
| D3 | Send | `#pushSendBtn_<pid>` → `sendProfilePush(pid)` | success toast | **`qr_codes.promotion`** updated across the profile's codes `{text,photos,pushedAt}` |

### Phase E — Customer: scan the code  *(app: duyen.io)*

| # | Action | Selector | Expected | Backend |
|---|---|---|---|---|
| E1 | Open scan URL | `https://duyen.io/q/<E2E_TEST_QR>` | `handleRoute()` → `navigate('qr')`; role screen `#qrIdentityScreen` | RPC **`get_qr_for_scan`** (3× retry), then **`bump_scan_count`** |
| E2 | See role cards | `#roleGiverCard` "I'm Giving a Gift", `#roleReceiverCard` "I Received This", `#roleBusinessOption` | cards render in `#qrRoleCards` | — |

### Phase F — Customer: view & save to tapestry

| # | Action | Selector | Expected | Backend |
|---|---|---|---|---|
| F1 | Choose "I Received This" | `#roleReceiverCard` → `selectRole('receiver')` | `navigate('qrContent')` (view first, no gate) | — |
| F2 | Save/reply (prompts auth) | save/respond action | routed to `#authScreen`; `postAuthDestination` set | — |
| F3 | Log in | `#loginEmail`,`#loginPassword`, "Sign In" → `handleLogin()` | session established; resume to save | `auth.signInWithPassword` |
| F4 | Save | `saveToTapestryDirect()` / `claim_receiver` | `#successScreen`; row in **`tapestry`** | RPC `claim_receiver` + insert `tapestry`; `bump_save_count` |

### Phase G — Customer: sees promo + notification

| # | Action | Selector | Expected | Backend |
|---|---|---|---|---|
| G1 | Open tapestry | `navigate('tapestry')` | `#tapestryContainer`; saved card shows `✦ New` badge (`.thread-card-category`) when the code has a promo | reads **`tapestry`** ⋈ `qr_codes` |
| G2 | Open the card | card → `navigate('threadDetail')` | `bizProfileCard(..., {promoOpen:true})` — "What's new" auto-expanded | — |
| G3 | Notifications | `#notifBell` → `toggleNotifPanel()` | `#notifPanel`, a `type:'promo'` item "✦ Something new" | `syncPromoNotifications()` inserts into **`notifications`**; `loadNotifications()` reads it |

### Phase H — Business owner: counts & analytics update

| # | Action | Selector | Expected | Backend |
|---|---|---|---|---|
| H1 | Return to dashboard | `#bizDashboardView` | per-profile Scans/Saves/Shares reflect the new scan+save | `refreshProfileCounts()` (30s auto-refresh) |
| H2 | Analytics strip | `_profileAnalyticsBlockHTML` (gated `canViewAnalytics()`) | Scans/Saves/Shares cells non-zero | reads `qr_codes.scan_count/save_count/share_count` |

### Phase I — Business owner: cancel & resume

| # | Action | Selector | Expected | Backend |
|---|---|---|---|---|
| I1 | Cancel | `#subActionBtn` "Cancel plan" → `cancelSubscription()` | card shows "Ends … · won't renew"; access kept until period end | edge fn `business-cancel-subscription` `{action:'cancel'}` |
| I2 | Resume | `#subActionBtn` "Resume plan" → `resumeSubscription()` | back to renewing | `{action:'resume'}` |

> Tests exercise I1/I2 against the **seeded** subscription (a real Stripe test
> sub is not created); or assert the UI states from a stubbed `_subStatus`.

---

## 4. What each mechanism covers

| Layer | Runs | Covers | Skips |
|---|---|---|---|
| **Playwright E2E** (GitHub Actions) | every push to `main` + daily cron | Phases A,B,D,E,F,G,H,I against seeded accounts; a no-auth **smoke** subset (both apps' shells load, scan screen renders) with no secrets | live Stripe checkout (C1–C3) |
| **Claude agent** (scheduled session) | daily (or chosen cadence) | walks this doc as a checklist, judges "looks wrong" (layout, copy, broken image, promo not showing), messages you | anything requiring a real payment |
| **Manual** | pre-launch & on Stripe changes | C1–C3 real checkout in Stripe **test mode**, refund/receipt emails | — |

---

## 5. Known gotchas (check these first when something "breaks")

1. **Service worker staleness** — after a deploy the PWA serves the old shell until
   fully closed/reopened. A test failing right after deploy may be the SW, not code.
   Tests run with a fresh context (no SW) to avoid this.
2. **Image transforms distort with width-only params** — always `width`+`height`+
   `resize=contain` (see `thumbUrl()`); a squished promo photo is a URL bug, not CSS.
3. **Count auto-refresh is 30s** — Phase H counts may lag; tests should poll/wait,
   not assert instantly. Auto-refresh pauses while a push composer is open.
4. **`get_qr_for_scan` retries 3× over ~3s** — the scan screen can take a moment;
   wait for `#qrRoleCards` content, not a fixed timeout.
5. **Entitlements are cached** (`window.entitlements`) — after a plan change the app
   re-calls `get_my_entitlements`; a stale gate is usually a missing reload.
6. **Two domains, one codebase** — `dayduyen.tech` is matched in code; duyen.io is
   canonical. Don't assert one domain's copy on the other.

---

## 6. Backend objects touched (for seeding / teardown)

- **Tables:** `qr_codes`, `tapestry`, `notifications`, `saved_links`, `business_accounts`, `orders`.
- **RPCs:** `get_qr_for_scan`, `bump_scan_count`, `bump_save_count`, `bump_share_count`, `claim_giver`, `claim_receiver`, `get_my_entitlements`, `spend_mint_credits`, `my_print_runs`.
- **Edge functions:** `business-checkout`, `business-cancel-subscription`, `stripe-webhook`, `create-store-checkout`, `resolve-link`.
- **Storage buckets:** `qr-media` (customer), promo photos (business).
