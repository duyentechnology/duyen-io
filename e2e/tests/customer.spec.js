import { test, expect } from '@playwright/test';
import { CUSTOMER_URL } from '../playwright.config.js';
import { loginCustomer, hasCustomerCreds } from './helpers.js';

// Customer journey (Phases E–G). Needs a seeded customer account.
test.describe('customer: tapestry & notifications', () => {
  test.skip(!hasCustomerCreds(), 'set E2E_CUSTOMER_EMAIL / E2E_CUSTOMER_PASSWORD');

  test('login and open the tapestry', async ({ page }) => {
    await loginCustomer(page);
    await page.goto(`${CUSTOMER_URL}/#/tapestry`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#tapestryContainer')).toBeVisible({ timeout: 25_000 });
    // Bell is part of the tapestry chrome.
    await expect(page.locator('#notifBell')).toBeAttached();
  });

  test('notification panel opens', async ({ page }) => {
    await loginCustomer(page);
    await page.goto(`${CUSTOMER_URL}/#/tapestry`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#tapestryContainer')).toBeVisible({ timeout: 25_000 });
    await page.locator('#notifBell').click();
    await expect(page.locator('#notifPanel')).toBeVisible();
  });
});

// Scan → role screen (Phase E), no login required to view.
test.describe('customer: scan entry', () => {
  const code = process.env.E2E_TEST_QR;
  test.skip(!code, 'set E2E_TEST_QR to the seeded test code');

  test('receiver role opens the content view', async ({ page }) => {
    await page.goto(`${CUSTOMER_URL}/q/${code}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#qrRoleCards')).toBeVisible({ timeout: 20_000 });
    await page.locator('#roleReceiverCard').click();
    // selectRole('receiver') navigates to the content screen (view-first, no gate).
    await expect(page.locator('#qrContentScreen')).toBeVisible({ timeout: 15_000 });
  });
});
