import { expect } from '@playwright/test';
import { CUSTOMER_URL, BUSINESS_URL } from '../playwright.config.js';

export const CUSTOMER = {
  email: process.env.E2E_CUSTOMER_EMAIL,
  password: process.env.E2E_CUSTOMER_PASSWORD,
};
export const BIZ = {
  email: process.env.E2E_BIZ_EMAIL,
  password: process.env.E2E_BIZ_PASSWORD,
};

export const hasCustomerCreds = () => !!(CUSTOMER.email && CUSTOMER.password);
export const hasBizCreds = () => !!(BIZ.email && BIZ.password);

// duyen.io — email+password. #/login hash routes to the login screen.
export async function loginCustomer(page) {
  await page.goto(`${CUSTOMER_URL}/#/login`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginScreen')).toBeVisible({ timeout: 20_000 });
  await page.fill('#loginEmail', CUSTOMER.email);
  await page.fill('#loginPassword', CUSTOMER.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  // handleLogin resolves the session; the app leaves the login screen.
  await expect(page.locator('#loginScreen')).toBeHidden({ timeout: 20_000 });
}

// dayduyen.tech — email+password via the header auth modal.
export async function loginBusiness(page) {
  await page.goto(BUSINESS_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#headerBtn').click();
  await expect(page.locator('#authModal')).toHaveClass(/active/, { timeout: 10_000 });
  await expect(page.locator('#loginForm')).toBeVisible();
  await page.fill('#loginEmail', BIZ.email);
  await page.fill('#loginPassword', BIZ.password);
  await page.getByRole('button', { name: 'Log In' }).click();
  // On session, the app routes a returning user to the dashboard.
  await expect(page.locator('#bizDashboardView')).toBeVisible({ timeout: 25_000 });
}
