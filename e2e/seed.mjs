#!/usr/bin/env node
// Seeds test data for the E2E suite WITHOUT touching Stripe:
//  - a customer account (email+password, confirmed)
//  - a business account marked Insights active directly in business_accounts
//  - a stable, active test QR code used as the scan target
//
// Requires (env):
//   SUPABASE_URL            default https://qnlaaieyipeglfuepmor.supabase.co
//   SUPABASE_SERVICE_KEY    service-role key (NEVER commit it)
// Optional (env), with defaults:
//   E2E_CUSTOMER_EMAIL / E2E_CUSTOMER_PASSWORD
//   E2E_BIZ_EMAIL      / E2E_BIZ_PASSWORD
//
// Run: SUPABASE_SERVICE_KEY=... node e2e/seed.mjs
// Idempotent: re-running updates the same accounts/code.

const URL = process.env.SUPABASE_URL || 'https://qnlaaieyipeglfuepmor.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('SUPABASE_SERVICE_KEY is required'); process.exit(1); }

const C = {
  email: process.env.E2E_CUSTOMER_EMAIL || 'e2e-customer@duyen.test',
  password: process.env.E2E_CUSTOMER_PASSWORD || 'E2e-Customer-Pass-2026!',
};
const B = {
  email: process.env.E2E_BIZ_EMAIL || 'e2e-biz@duyen.test',
  password: process.env.E2E_BIZ_PASSWORD || 'E2e-Business-Pass-2026!',
};

const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

async function findUserByEmail(email) {
  // GoTrue admin list is paginated; scan a few pages.
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: h });
    const d = await j(r);
    const users = d.users || d;
    if (!Array.isArray(users) || users.length === 0) break;
    const found = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (found) return found;
  }
  return null;
}

async function upsertUser({ email, password }) {
  let r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (r.ok) { const u = await j(r); console.log(`  created ${email}`); return u; }
  // Likely already exists — find and reset password so the test creds are valid.
  const existing = await findUserByEmail(email);
  if (!existing) { console.error(`  failed to create or find ${email}:`, await j(r)); process.exit(1); }
  const up = await fetch(`${URL}/auth/v1/admin/users/${existing.id}`, {
    method: 'PUT', headers: h,
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!up.ok) { console.error(`  failed to update ${email}:`, await j(up)); process.exit(1); }
  console.log(`  updated ${email}`);
  return existing;
}

async function main() {
  console.log('Seeding E2E test data (no Stripe)…');

  console.log('customer account:');
  const cust = await upsertUser(C);

  console.log('business account:');
  const biz = await upsertUser(B);

  // Mark the business account as an active Insights subscriber (no charge).
  console.log('business_accounts entitlement (insights/active):');
  const acctBody = {
    user_id: biz.id, plan: 'insights', plan_status: 'active',
    origin: 'e2e-seed', has_generator: true, updated_at: new Date().toISOString(),
  };
  let ar = await fetch(`${URL}/rest/v1/business_accounts?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...h, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(acctBody),
  });
  console.log('  ->', ar.status, (await j(ar))?.[0]?.plan_status || '');

  // Stable test QR code (idempotent by a fixed label).
  console.log('test QR code:');
  const label = 'E2E Test Code — do not delete';
  let qr = await j(await fetch(
    `${URL}/rest/v1/qr_codes?select=id,url&label=eq.${encodeURIComponent(label)}&limit=1`,
    { headers: h }));
  let code;
  if (Array.isArray(qr) && qr[0]) {
    code = qr[0].url.split('/q/').pop();
    console.log('  exists ->', qr[0].url);
  } else {
    const slug = 'e2etest' + Math.random().toString(36).slice(2, 8);
    const url = `https://duyen.io/q/${slug}`;
    const body = {
      user_id: biz.id, business_user_id: biz.id, label, url, source: 'business',
      status: 'active', include_logo: true, color: '#8B3A7F',
      business_data: { name: 'E2E Test Business', about: 'Automated test profile.' },
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const cr = await fetch(`${URL}/rest/v1/qr_codes`, {
      method: 'POST', headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    const created = await j(cr);
    code = slug;
    console.log('  created ->', created?.[0]?.url || cr.status);
  }

  console.log('\nDone. Set these for the test run:\n');
  console.log(`  E2E_CUSTOMER_EMAIL=${C.email}`);
  console.log(`  E2E_CUSTOMER_PASSWORD=${C.password}`);
  console.log(`  E2E_BIZ_EMAIL=${B.email}`);
  console.log(`  E2E_BIZ_PASSWORD=${B.password}`);
  console.log(`  E2E_TEST_QR=${code}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
