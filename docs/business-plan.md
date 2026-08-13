# Duyên — Business Plan

*Prepared August 2026. Companion document to the investor pitch deck (`docs/duyen-pitch-deck.pptx`).*

---

## 1. Executive summary

**Duyên** (Vietnamese, 緣: the invisible threads of fate that connect people, places, and things) is a QR-native platform that turns physical moments into lasting digital memories — and turns physical products into living digital storefronts.

One codebase serves two sides of the same thread:

- **duyen.io (consumer)** — a personal "life tapestry." People attach photos, video, voice notes, and messages to QR notes and gifts; scanning weaves the moment into a timeline organized by when it actually happened. Any external QR or link can also be saved to a personal vault.
- **duyen.tech (business)** — small businesses and boutiques generate QR profiles for themselves and their products ("modulars": a product, a menu, …). A customer who scans a tag sees the business's story, the product's story, and can keep the item as a keepsake in their own tapestry.

The wedge is emotional (gifting and memory-keeping); the expansion is commercial (product QR infrastructure for small brands); and the horizon is regulatory: the EU's **Digital Product Passport** will require QR-accessible product data on every garment sold in the EU from ~2028, creating a compliance-driven demand wave that Duyên's product-QR architecture already points toward.

Monetization is live today: consumer moment tokens, one-time business unlocks, two subscription tiers, and per-QR minting credits — all running on Stripe.

---

## 2. Founder & origin of the idea

> *Founder: [Founder name] — placeholder; fill in bio, background, and photo before sharing externally.*

The idea comes from the word itself. In Vietnamese culture, **duyên** describes connections that are *meant to be* — woven by fate, chance, and choice. A gift from a grandmother, a café where two friends met, a handmade áo dài from a family tailor: these objects and places carry stories, but the stories evaporate. Cards get thrown away. Voice fades. The context of "who gave this, when, and why" is lost within a generation.

Three observations shaped the product:

1. **Physical gifts are mute.** A gift card holds 20 words. There is no mainstream way to attach a voice note, a video, or a dated memory to a physical object that outlives the wrapping paper.
2. **The QR behavior barrier is gone.** Post-pandemic, scanning is a reflex — menus, payments, boarding passes. The hardware (every phone camera) and the habit now exist; what's missing is a *meaningful* thing to scan.
3. **Small makers have the same problem as gift-givers.** A boutique's product hangs on a rack with a price tag and nothing else. The maker's story, the material, the care instructions — none of it travels with the object. The same "attach a story to a thing" mechanic serves both.

Duyên began as the consumer gifting experience and grew its business side organically: businesses that gave Duyên Note cards to customers wanted their own profiles, then wanted QR codes on their products. The roadmap follows that pull.

---

## 3. The product today

Shipped and live (single-page PWA, Supabase backend, Stripe payments):

| Capability | Description |
|---|---|
| Moments | Photos, video, voice notes, and messages, dated to when they happened |
| Give / receive | Author a moment onto a QR note; the receiver scans and keeps it forever. Optional secret phrase to lock a message |
| Tapestry | A life timeline woven month by month from received and added moments |
| Link vault | Scan/save any external QR or link — never lose it |
| Business profiles | Claimed via a physical card or a $20 unlock; QR generator included |
| Modulars | Product / menu QR codes: scanning shows the business profile + the product's own content |
| Product keepsakes | A customer who saves a scanned product keeps *the item* in their tapestry — the product becomes a memory |
| Print runs | Physical QR card batches, tracked and activated per-card |
| Analytics & promotions | "Insights" subscription: scan analytics + push promotions |
| Multi-QR minting | "Boutique" subscription: bulk QR generation at $0.10/code |

---

## 4. The gaps Duyên serves

1. **The gifting gap** — no mainstream product attaches rich, permanent, personal media to a physical gift. Greeting cards are a ~$20B/yr market built on 20 words and a signature; personalization is the fastest-growing segment of gifting, and 58% of consumers now say they prefer personalized gifts.
2. **The memory gap** — photos pile up in camera rolls with no narrative. Journaling apps (a $5.7B market growing ~11%/yr) capture text but aren't anchored to physical objects, givers, or places.
3. **The small-maker gap** — enterprise connected-packaging platforms (Scantrust, EVRYTHNG-class) serve global CPG brands; a boutique with 40 SKUs has nothing at its price point. Duyên's $20-in, $0.10-per-code model is priced for them.
4. **The looming compliance gap (textiles)** — every garment sold in the EU will need a QR-accessible Digital Product Passport (fiber composition, origin, care, chemicals, repair/resale data). Millions of small fashion brands and tailors will need a cheap, simple way to comply. See §6.

---

## 5. Monetization (all mechanisms live in production)

### Consumer — duyen.io
- **Moment tokens:** first 10 moments free, then **$5 for a 5-pack** (1 token = 1 sent moment). Effectively $1 per moment sent.
- Free forever to *receive*, view your tapestry, and save links — the paid act is authoring, keeping the viral loop (receiving) frictionless.

### Business — duyen.tech (entitlement ladder, from `business_accounts`)
| Rung | Price | What it unlocks |
|---|---|---|
| Card claim | Free (via a physical Duyên Note card) | QR generator, origin `card` |
| Direct unlock | **$20 one-time** | QR generator + first modular credit |
| Extra modulars | **$10 one-time each** | +1 product/menu QR |
| Insights plan | **$9.99/mo** | Scan analytics + push promotions |
| Boutique plan | **$19.99/mo** | Multi-QR minting at **$0.10/QR** (prepaid mint credits) |

### Physical goods
- **Duyên Note cards & print runs** — printed QR cards sold at retail/wholesale; each card is both a product (margin) and an acquisition channel (every card claimed creates a business or consumer account).

### Future revenue lines (roadmap, not yet built)
1. **DPP Compliance tier** (~$49/mo per brand + per-unit QR fees): textile-specific product passports — see §6.
2. **Marketplace take-rate:** product keepsakes already link scans to products; add "buy again / gift this" checkout and take 5–10%.
3. **Premium tapestry** ($3–5/mo): expanded storage, printed yearbooks of a year's tapestry, family sharing.
4. **White-label print partnerships:** revenue share with card/tag printers for pre-minted Duyên QR stock.

---

## 6. Textile compliance — the regulatory tailwind

The EU **Ecodesign for Sustainable Products Regulation (ESPR)** entered into force in July 2024. Its centerpiece is the **Digital Product Passport (DPP)**: product data made accessible through a data carrier on the product itself — in practice, **a QR code on the label, hangtag, or garment tag**.

**Timeline for textiles/apparel:**
- 2025–2026 — preparatory studies and stakeholder consultation for the textile delegated act
- **2027** — textile delegated act expected to be adopted (per the ESPR Working Plan 2025–2030)
- **~2028 at the earliest** — mandatory DPP compliance for textiles sold in the EU (delegated acts apply no earlier than 18 months after adoption)

**Required data (expected):** fiber composition, country of manufacture, care instructions, chemical use, durability, repair/resale options, environmental impact.

**Why this matters for Duyên:**
- Duyên's product modular *is already* the right shape: a per-product QR resolving to structured product data plus the maker's profile. Extending the modular schema with DPP fields (fiber %, origin, care, chemicals) is an incremental build, not a new product.
- The compliance market will bifurcate: enterprise platforms will fight over Inditex and H&M; **millions of SMEs — boutiques, tailors, small labels, Etsy-class sellers exporting to the EU — will need a sub-$50/month answer.** That is exactly Duyên's existing customer and price point.
- Compliance QRs are permanent, per-unit, and mandatory — recurring, non-discretionary revenue layered on the $0.10/QR minting engine that already exists.
- Emotional differentiation: a Duyên DPP tag is not just a data sheet — the same scan can carry the maker's story and let the buyer keep the garment in their tapestry. Compliance becomes marketing.

Market context: the digital product passport market is projected to grow from ~$275M (2025) to ~$3.0B by 2033 (~35% CAGR); on-pack QR + DPP combined from $3.3B (2026) to $13.9B by 2036.

### 6b. California SB 707 — the US front (Responsible Textile Recovery Act of 2024)

The EU is not the only regulator moving. In September 2024 California enacted **SB 707**, the **first extended producer responsibility (EPR) law for textiles in the United States**. It makes producers financially responsible for the collection, repair, reuse, and recycling of textiles they sell into California.

**What the law requires:**
- **Covered products:** most apparel and household textiles — clothing, footwear, handbags, towels, bedding, pillows, curtains.
- **Who must comply:** producers with **more than $1M in annual global sales** selling covered products into California. Smaller and secondhand sellers are exempt.
- **July 1, 2026** — deadline to register with the state-approved producer responsibility organization (PRO, Landbell USA). Penalties for non-registration run up to **$10,000/day** (up to $50,000/day for knowing violations). *This deadline has already passed — late registrants are in the penalty window now.*
- **By 2030** (or earlier if CalRecycle approves the PRO plan sooner) — participation in the full stewardship program; producer fees begin at full implementation.
- **Eco-modulated fees:** the fee methodology (being developed now) charges producers less for design and programs that facilitate **reuse, repair, and recycling** — and the PRO must credit **existing producer collection, repair, and reuse programs** in the fee structure.
- **Data obligations:** annual transparency reporting; the PRO and recyclers need **granular, SKU-level material data** to assess fees.

**How Duyên is a solution:**

1. **The SKU-level data registry already exists.** A Duyên modular is a per-product record behind a QR. Extending its schema with fiber composition, material, and repairability fields gives a producer one dataset that serves *both* SB 707 fee reporting and the EU DPP — entered once, at boutique prices.
2. **Eco-modulation evidence = lower fees.** A scannable care/repair/resale layer on every garment is a *documentable, producer-run reuse and repair program* — exactly what the eco-modulated fee structure is required to credit. Duyên can give a small brand auditable scan logs proving the program is real and used.
3. **The QR is the consumer end-of-life touchpoint.** The law's whole machinery depends on garments actually reaching repair, resale, or collection instead of landfill. The tag on the garment is the natural interface: scan → care instructions, repair options, resale guidance, nearest PRO collection point.
4. **Provenance extends garment life.** Duyên keepsakes attach the garment's story to the garment. Items with stories are kept longer and resell better with provenance — directly serving the law's reuse-over-disposal hierarchy.
5. **The wedge customer is acute and underserved:** California boutiques and DTC labels just over the $1M threshold now carry enterprise-grade compliance obligations with no enterprise budget — plus under-threshold brands who want the reuse/repair story voluntarily as brand value.

**Timing implication for the plan:** SB 707 pulls compliance-adjacent revenue *forward* of the EU's ~2028 date — the PRO registration deadline has already passed (mid-2026) and the fee-design phase runs now through ~2030, which is precisely when producers should be standing up the repair/reuse programs that reduce their fees.

---

## 7. Market size & QR adoption research

### QR behavior is mainstream and still growing
- ~**100M US smartphone users** scanned a QR code in 2025 (projected 102.6M in 2026) — roughly 1 in 3 Americans with a smartphone.
- **Over 1 trillion QR scans** projected worldwide in 2025 — a first; ~2.9B people worldwide use QR codes.
- Usage grew **323% from 2021 to 2025**; scans among adults 45–64 grew 38% between 2023 and 2026 — adoption is cross-generational, not a youth fad.

### Addressable markets (TAM → SAM view)
| Market | Size | Growth |
|---|---|---|
| Global QR codes market | $15.2B (2026) → $33.1B (2031) | ~16.8% CAGR |
| QR code labels | ~$2.6–2.8B (2025) → $4–5B (2030–32) | 7–11% CAGR |
| Personalized gifts | $26.1B (2024) → ~$50B (2033) | ~7.5% CAGR |
| Greeting cards | $19.8B (2025) → $23.0B (2033) | 1.9% CAGR (ripe for disruption) |
| Digital journal apps | $5.7B (2025) → $15.2B (2034) | ~11.5% CAGR |
| Digital business cards | ~$220M (2026) → ~$330–580M (2031–33) | 9–12% CAGR |
| Connected packaging | → $65.3B by 2036 | 7.9% CAGR |
| Digital product passports | $275M (2025) → $3.0B (2033) | ~35% CAGR |

**Framing:** Duyên's serviceable market is the intersection — people who give personalized gifts (58% of consumers now prefer them) and the long tail of small product businesses priced out of enterprise connected-packaging platforms, with textile DPP compliance as a forced-adoption catalyst from 2028.

---

## 8. Illustrative revenue projections

*Bottom-up, base-case scenario. All prices are the live production prices; adoption numbers are assumptions to be validated, not forecasts of record.*

**Unit economics assumed:** paying consumer ≈ $10/yr (2 token packs); new business ≈ $35 first year ($20 unlock + 1.5 extra modulars); Insights ≈ $120/yr; Boutique ≈ $440/yr ($240 subscription + ~2,000 minted QRs); DPP tier (future) ≈ $600/yr per brand.

| | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Registered consumers | 10,000 | 60,000 | 250,000 |
| — paying (4→6%) | 400 | 3,000 | 15,000 |
| Consumer revenue | $4,000 | $30,000 | $150,000 |
| Active businesses | 150 | 800 | 3,000 |
| Unlocks + modulars | $5,250 | $28,000 | $77,000 |
| Insights subs (20%→30%) | $3,600 | $24,000 | $108,000 |
| Boutique subs (10%→15%) | $6,600 | $44,000 | $198,000 |
| DPP compliance tier | — | — | $30,000 (50 pilot brands) |
| **Total** | **~$19.5K** | **~$126K** | **~$563K** |

Beyond Year 3, the textile DPP mandate (~2028) is the step-change: if Duyên converts even 2,000 EU-exporting small textile brands at ~$600/yr plus per-unit minting, the compliance line alone exceeds $1.2M/yr — before marketplace take-rate or premium consumer tiers.

**Structural advantages of the model:**
- Near-zero marginal cost: static PWA + Supabase; no build step, no app-store tax on web payments.
- Physical cards are self-liquidating customer acquisition (the CAC item is itself sold at a margin).
- Every gifted moment recruits its receiver; every product keepsake exposes a consumer to the business side.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Textile delegated act slips past 2027/28 | DPP is upside layered on an already-monetizing core, not the core bet |
| Platform gifting features (Apple/Google) | Duyên's moat is the physical-digital bridge + tapestry permanence, not messaging |
| QR fatigue / spam association | Duyên codes resolve to *owned, personal* content, not ads; secret-phrase locking builds trust |
| Small-business churn | One-time unlocks monetize even churned accounts; print runs create physical lock-in |
| Solo-founder execution | Small, frequently-shipped increments (already the working practice); revenue-funded growth |

---

## 10. Sources

- QR usage & market: [Scanova QR statistics](https://scanova.io/blog/qr-code-statistics/), [QR Tiger statistics report](https://www.qrcode-tiger.com/qr-code-statistics), [QRCodeChimp statistics](https://www.qrcodechimp.com/qr-code-statistics/), [Mordor Intelligence QR codes market](https://www.mordorintelligence.com/industry-reports/qr-codes-market)
- QR labels: [Future Market Insights](https://www.futuremarketinsights.com/reports/qr-code-labels-market), [360iResearch](https://www.360iresearch.com/library/intelligence/qr-code-labels), [Strategic Market Research](https://www.strategicmarketresearch.com/market-report/qr-code-labels-market)
- Gifting & cards: [MRFR personalized gifts](https://www.marketresearchfuture.com/reports/personalized-gifts-market-10348), [Verified Market Research](https://www.verifiedmarketresearch.com/product/personalized-gifts-market/), [Grand View Research greeting cards](https://www.grandviewresearch.com/industry-analysis/greeting-cards-market-report)
- Journaling & business cards: [Straits Research digital journal apps](https://straitsresearch.com/report/digital-journal-apps-market), [IMARC digital business card](https://www.imarcgroup.com/digital-business-card-market), [Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/qr-codes-market)
- Textile DPP / ESPR: [COSH! ESPR explainer](https://cosh.eco/en/articles/eu-digital-product-passport-espr-explained-fashion-textiles), [Carbonfact DPP for fashion](https://www.carbonfact.com/blog/policy/digital-product-passport-fashion), [Cycle Intelligence timeline](https://www.cycle-platform.com/knowledge/eu-digital-product-passport-textiles/), [Wave PLM ESPR requirements](https://blog.waveplm.com/eu-digital-product-passport-dpp/)
- California SB 707: [Bill text (CA Legislature)](https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240SB707), [K&L Gates deadline analysis](https://www.klgates.com/thought-leadership/Californias-Landmark-Textile-Recycling-Law-With-Looming-1-July-2026-Deadline-6-26-2026), [Anthesis SB 707 explainer](https://www.anthesisgroup.com/insights/sb-707-californias-textile-epr-law-explained/), [DLA Piper implementation notes](https://www.dlapiper.com/en-us/insights/publications/2025/10/california-sb-707-key-takeaways), [RRS compliance overview](https://www.recycle.com/latest/california-sb707-textile-epr-compliance), [CalRecycle textile PRO](https://calrecycle.ca.gov/epr/textiles/textileproapp)
- DPP / connected packaging market: [Grand View Research DPP market](https://www.grandviewresearch.com/industry-analysis/digital-product-passport-market-report), [FMI on-pack QR & DPP](https://www.openpr.com/news/4595542/on-pack-qr-codes-digital-product-passport-market-size-to-reach), [Connected packaging](https://www.openpr.com/news/4535478/connected-packaging-market-to-reach-usd-65-3-billion-by-2036-as)
