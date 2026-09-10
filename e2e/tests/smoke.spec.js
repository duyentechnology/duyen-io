import { test, expect } from '@playwright/test';
import { CUSTOMER_URL, BUSINESS_URL } from '../playwright.config.js';

// Smoke = no secrets, no login. Proves both app shells deploy and render.
// This subset runs on every push and catches the most common breakage
// (a bad deploy, a JS error that blanks the page, a missing root element).

test.describe('smoke: app shells load', () => {
  test('customer app (duyen.io) renders the home screen', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(CUSTOMER_URL, { waitUntil: 'domcontentloaded' });
    // Home maps to #welcomeScreen (navigate('home')). It exists in the shell.
    await expect(page.locator('#welcomeScreen')).toBeAttached();
    await expect(page.locator('#welcomeScreen')).toBeVisible({ timeout: 20_000 });
    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('business app (dayduyen.tech) renders the landing view', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BUSINESS_URL, { waitUntil: 'domcontentloaded' });
    // Logged-out state shows #landingView; the header CTA opens the auth modal.
    await expect(page.locator('#landingView')).toBeAttached();
    await expect(page.locator('#headerBtn')).toBeAttached();
    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});

// Scan-screen smoke needs a stable, resolvable code. Set E2E_TEST_QR to the
// seeded test slug (docs/E2E-FLOW.md §2); skipped when absent so the no-secret
// run stays green.
test.describe('smoke: scan screen', () => {
  const code = process.env.E2E_TEST_QR;
  test.skip(!code, 'set E2E_TEST_QR to the seeded test code');

  test('scanning a code shows the role-choice cards', async ({ page }) => {
    await page.goto(`${CUSTOMER_URL}/q/${code}`, { waitUntil: 'domcontentloaded' });
    // get_qr_for_scan retries ~3s; wait for the role cards, not a fixed timeout.
    await expect(page.locator('#qrRoleCards')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("I Received This")).toBeVisible();
    await expect(page.getByText("I'm Giving a Gift")).toBeVisible();
  });
});
