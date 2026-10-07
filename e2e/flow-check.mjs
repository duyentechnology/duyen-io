#!/usr/bin/env node
// flow-check.mjs — daily backend health check for the whole QR → tapestry flow.
//
// Exercises the real data layer end to end and asserts each step, so a
// regression (a broken RPC, a lost grant, an RLS change) turns the daily CI run
// red before a user ever hits it. Complements the Playwright UI specs.
//
// Two tiers:
//   • SMOKE (no secrets): edge-function health + scan resolution of a known code.
//     Runs anywhere, creates nothing.
//   • FULL (SUPABASE_SERVICE_KEY set): generate a business code → scan it →
//     save it to a customer's tapestry → confirm it becomes a "What's New"
//     digest candidate → clean everything up. Needs the service key to seed
//     and to delete the throwaway user/rows.
//
// Config (all optional; URL/anon are read from ../index.html if unset):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, DIGEST_SECRET, E2E_TEST_QR
//
// Exit code 0 = all checks passed, 1 = at least one failed.

import { readFileSync } from 'node:fs';

function fromIndex(re) {
  for (const rel of ['../index.html', './index.html']) {
    try { const m = readFileSync(new URL(rel, import.meta.url), 'utf8').match(re); if (m) return m[1]; } catch {}
  }
  return null;
}
const URL_ = process.env.SUPABASE_URL || fromIndex(/SB_URL\s*=\s*'([^']+)'/) || 'https://qnlaaieyipeglfuepmor.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY || fromIndex(/SB_ANON\s*=\s*'([^']+)'/);
const SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
const DIGEST_SECRET = process.env.DIGEST_SECRET || '';
const E2E_TEST_QR = process.env.E2E_TEST_QR || '';

if (!ANON) { console.error('No anon key (set SUPABASE_ANON_KEY or keep e2e/ next to index.html)'); process.exit(1); }

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : '  — ' + detail}`);
  return ok;
}

async function req(method, url, { body, token, key, prefer } = {}) {
  const headers = { apikey: key || ANON, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(url, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  let data = null; const text = await res.text(); try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const anonRpc = (fn, body, token) => req('POST', `${URL_}/rest/v1/rpc/${fn}`, { body: body || {}, token: token || ANON });
const svc = (method, path, body, prefer) =>
  req(method, `${URL_}/rest/v1/${path}`, { body, key: SERVICE, token: SERVICE, prefer });

async function smoke() {
  console.log('\nSMOKE (no secrets needed)');
  // Edge functions respond with their expected contract.
  const ve = await req('POST', `${URL_}/functions/v1/verify-email`, { body: { token: 'nope' }, token: ANON });
  check('verify-email rejects a bogus token', ve.status === 200 && ve.data && ve.data.ok === false, JSON.stringify(ve.data));
  const dg = await req('POST', `${URL_}/functions/v1/send-whatsnew-digest`, { body: { dryRun: true }, token: ANON });
  check('send-whatsnew-digest refuses without the secret', dg.status === 403, `status ${dg.status}`);

  if (E2E_TEST_QR) {
    const scan = await anonRpc('get_qr_for_scan', { p_code: E2E_TEST_QR });
    check('get_qr_for_scan resolves the seeded E2E_TEST_QR', scan.status === 200 && Array.isArray(scan.data) && scan.data.length === 1, JSON.stringify(scan.data).slice(0, 120));
  } else {
    console.log('  – (scan test skipped: set E2E_TEST_QR to a stable seeded code)');
  }
}

async function full() {
  console.log('\nFULL FLOW (service key present)');
  const ts = Date.now();
  const email = `delivered+flowcheck${ts}@resend.dev`;
  const code = `flowcheck${ts}`;
  let uid = null, qid = null;
  try {
    // 1) a throwaway customer
    const su = await req('POST', `${URL_}/auth/v1/signup`, { body: { email, password: 'FlowCheck-12345!' }, key: ANON });
    uid = su.data && su.data.user && su.data.user.id;
    const token = su.data && su.data.access_token;
    if (!check('customer signup returns a session', !!(uid && token), JSON.stringify(su.data).slice(0, 120))) return;

    // 2) entitlements + wallet RPCs work and are scoped to the caller
    const ent = await anonRpc('get_my_entitlements', {}, token);
    check('get_my_entitlements returns the entitlement shape', ent.status === 200 && ent.data && 'can_push' in ent.data && 'plan' in ent.data, JSON.stringify(ent.data).slice(0, 120));
    const wal = await anonRpc('get_or_create_wallet', {}, token);
    check('get_or_create_wallet returns a balance', wal.status === 200 && typeof wal.data === 'number', JSON.stringify(wal.data));

    // 3) seed a business code with a fresh promotion (service role = "generation")
    const nowIso = new Date().toISOString();
    const ins = await svc('POST', 'qr_codes?select=id', [{
      url: `https://duyen.io/q/${code}`, source: 'business', status: 'active',
      business_data: { name: 'Flowcheck Shop' },
      promotion: { text: 'Flow-check promo', photos: [], pushedAt: nowIso },
    }], 'return=representation');
    qid = Array.isArray(ins.data) && ins.data[0] && ins.data[0].id;
    if (!check('business QR code generated', !!qid, JSON.stringify(ins.data).slice(0, 120))) return;

    // 4) scan resolves it — by short code AND by id
    const byCode = await anonRpc('get_qr_for_scan', { p_code: code });
    check('scan resolves by short code', byCode.status === 200 && Array.isArray(byCode.data) && byCode.data[0] && byCode.data[0].business_data?.name === 'Flowcheck Shop', JSON.stringify(byCode.data).slice(0, 120));
    const byId = await anonRpc('get_qr_for_scan', { p_code: qid });
    check('scan resolves by id', byId.status === 200 && Array.isArray(byId.data) && byId.data.length === 1);

    // 5) customer saves the business to their tapestry (direct insert, RLS own-row)
    const save = await req('POST', `${URL_}/rest/v1/tapestry`, { body: { user_id: uid, qr_code_id: qid, role: 'business', title: 'Flowcheck Shop' }, token, key: ANON });
    check('customer saves the business to their tapestry', save.status === 201 || save.status === 200, `status ${save.status} ${JSON.stringify(save.data).slice(0,80)}`);

    // 6) the saved business's new promo makes the customer a digest candidate.
    //    Set a watermark an hour back so "new since last digest" is true.
    await svc('POST', 'digest_prefs?on_conflict=user_id', [{ user_id: uid, email_opt_in: true, last_digest_at: new Date(ts - 3600_000).toISOString() }]);
    const cand = await req('POST', `${URL_}/rest/v1/rpc/whatsnew_digest_candidates`, { body: {}, key: SERVICE, token: SERVICE });
    const hit = Array.isArray(cand.data) && cand.data.some((c) => c.email === email && Array.isArray(c.promos) && c.promos.length >= 1);
    check('customer is a What’s New digest candidate', hit, JSON.stringify(cand.data).slice(0, 140));
  } finally {
    // 7) clean up everything we created
    if (uid) { await svc('DELETE', `tapestry?user_id=eq.${uid}`); await svc('DELETE', `digest_prefs?user_id=eq.${uid}`); }
    if (qid) await svc('DELETE', `qr_codes?id=eq.${qid}`);
    if (uid) await req('DELETE', `${URL_}/auth/v1/admin/users/${uid}`, { key: SERVICE, token: SERVICE });
    console.log('  – cleaned up throwaway data');
  }
}

console.log(`flow-check · ${URL_}`);
await smoke();
if (SERVICE) { await full(); }
else { console.log('\nFULL FLOW skipped — set SUPABASE_SERVICE_KEY to run it (and enable cleanup).'); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? '✗ ' + failed.length + ' FAILED' : '✓ all ' + results.length + ' checks passed'}`);
process.exit(failed.length ? 1 : 0);
