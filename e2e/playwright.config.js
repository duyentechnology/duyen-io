import { defineConfig, devices } from '@playwright/test';

// Tests run against PRODUCTION (there is no staging Supabase project). They use
// clearly-labelled test accounts and a stable test QR (see docs/E2E-FLOW.md §2).
// Service workers are blocked so a stale app shell never masks a real regression.

export const CUSTOMER_URL = process.env.E2E_CUSTOMER_URL || 'https://duyen.io';
export const BUSINESS_URL = process.env.E2E_BUSINESS_URL || 'https://dayduyen.tech';

// Use a pre-installed Chromium when PW_CHROMIUM_PATH is set (e.g. sandboxes that
// ship a browser). CI leaves it unset and uses `playwright install chromium`.
const chromiumOverride = process.env.PW_CHROMIUM_PATH
  ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
  : {};

// Sandboxes route all egress through an agent proxy; pass it to the browser.
// CI has direct internet, so PW_PROXY_SERVER is left unset there.
const proxyServer = process.env.PW_PROXY_SERVER || '';
const proxyOverride = proxyServer ? { proxy: { server: proxyServer } } : {};

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block',
    ...proxyOverride,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromiumOverride } },
    // Pixel 5 is a Chromium device, so CI only needs the chromium browser.
    { name: 'mobile', use: { ...devices['Pixel 5'], ...chromiumOverride } },
  ],
});
