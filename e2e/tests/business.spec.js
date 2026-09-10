import { test, expect } from '@playwright/test';
import { loginBusiness, hasBizCreds } from './helpers.js';

// Business journey (Phases A–D, H, I). Needs a seeded business account that the
// seed script marks plan='insights', plan_status='active' (no Stripe charge).
test.describe('business: dashboard, generator, subscription', () => {
  test.skip(!hasBizCreds(), 'set E2E_BIZ_EMAIL / E2E_BIZ_PASSWORD');

  test('login lands on the dashboard', async ({ page }) => {
    await loginBusiness(page);
    await expect(page.locator('#dashProfilesList')).toBeAttached();
  });

  test('generator form renders (does not submit — avoids writing a code)', async ({ page }) => {
    await loginBusiness(page);
    // + New QR -> mode -> single
    await page.locator('#adminNewQR').click();
    await expect(page.locator('#modeView')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Single', { exact: false }).first().click();
    await expect(page.locator('#generatorView')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#baseUrl')).toBeVisible();
    await expect(page.getByRole('button', { name: /Generate QR Code/ })).toBeVisible();
  });

  test('subscriber sees the subscription card + analytics (Insights active)', async ({ page }) => {
    await loginBusiness(page);
    // Seeded account is an active Insights subscriber -> card + no paywall.
    await expect(page.locator('#dashSubCard')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('#subActionBtn')).toBeVisible();
    await expect(page.locator('#dashInsightsPaywall')).toHaveCount(0);
  });
});
