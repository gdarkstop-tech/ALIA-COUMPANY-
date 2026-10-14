import { defineConfig, devices } from '@playwright/test';

export const MOBILE_WEB = process.env.E2E_MOBILE_URL ?? 'http://localhost:8081';
export const ADMIN_WEB = process.env.E2E_ADMIN_URL ?? 'http://127.0.0.1:3001';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const reuse = !process.env.CI;

/**
 * End-to-end acceptance flows A–E (docs/PRODUCT_SPEC.md §33) against the running stack:
 * API (real PostgreSQL + Better Auth), the Expo app rendered for web, and the admin console.
 * Requires a database prepared with `pnpm db:reset` (synthetic demo data).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'mobile-web', testMatch: /flow-[a-d].*\.spec\.ts|rtl.*\.spec\.ts/, use: { ...devices['Pixel 7'], browserName: 'chromium', baseURL: MOBILE_WEB, locale: 'en-US' } },
    { name: 'admin', testMatch: /flow-e.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: ADMIN_WEB, locale: 'en-US' } },
  ],
  webServer: [
    { command: 'pnpm --filter @ghayarly/api start', url: `${API_URL}/health`, reuseExistingServer: reuse, timeout: 120_000 },
    { command: 'CI=1 pnpm --filter @ghayarly/mobile web', url: MOBILE_WEB, reuseExistingServer: reuse, timeout: 240_000 },
    { command: 'pnpm --filter @ghayarly/admin dev', url: `${ADMIN_WEB}/login`, reuseExistingServer: reuse, timeout: 180_000 },
  ],
});
