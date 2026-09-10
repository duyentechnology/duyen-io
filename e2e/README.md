# Duyên E2E tests

Playwright tests for **duyen.io** (customer) and **dayduyen.tech** (business),
driven by the flow in [`../docs/E2E-FLOW.md`](../docs/E2E-FLOW.md). They run
against **production** (there is no staging Supabase project) using seeded test
accounts — **never** real Stripe checkout.

## Layers

- **Smoke** (`tests/smoke.spec.js`) — no secrets. Both app shells load; the scan
  screen renders (when `E2E_TEST_QR` is set). Runs on every push.
- **Full** (`tests/customer.spec.js`, `tests/business.spec.js`) — need seeded
  accounts. Auto-skip when their env vars are absent, so the no-secret run is green.

## Setup

```bash
cd e2e
npm install
npx playwright install --with-deps chromium
```

## Seed test data (once, or after a reset)

Creates a customer account, a business account marked **Insights active**
(directly in `business_accounts`, no charge), and a stable test QR code.

```bash
SUPABASE_SERVICE_KEY=<service-role key> node seed.mjs
```

It prints the env vars to use. **The service key is never committed** — pass it
inline or via CI secrets.

## Run

```bash
# smoke only (no creds needed)
npm run test:smoke

# full suite (export the values seed.mjs printed first)
export E2E_CUSTOMER_EMAIL=... E2E_CUSTOMER_PASSWORD=...
export E2E_BIZ_EMAIL=... E2E_BIZ_PASSWORD=... E2E_TEST_QR=...
npm test

npm run report   # open the HTML report
```

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `E2E_CUSTOMER_URL` | `https://duyen.io` | customer app base |
| `E2E_BUSINESS_URL` | `https://dayduyen.tech` | business app base |
| `E2E_TEST_QR` | — | seeded scan-target slug |
| `E2E_CUSTOMER_EMAIL/_PASSWORD` | — | customer login |
| `E2E_BIZ_EMAIL/_PASSWORD` | — | business login (seeded subscriber) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | — | seeding only |

## CI

`.github/workflows/e2e.yml` runs smoke on every push to `main` and the full suite
daily (and on demand). Store the seeded creds + service key as **GitHub Actions
secrets** of the same names.
