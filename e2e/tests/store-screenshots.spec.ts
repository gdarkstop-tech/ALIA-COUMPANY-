import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { byId, signInMobile } from './helpers';

/**
 * DRAFT store screenshots (run explicitly: `STORE_SHOTS=1 pnpm --filter @ghayarly/e2e exec playwright test store-screenshots`).
 *
 * Captured from the react-native-web harness with synthetic demo data only — never real patients.
 * They are layout/copy drafts for the listing, NOT final store assets: before submission replace them
 * with captures from the native iOS / Android builds (status bar, native controls, fonts).
 *
 *   apple-6.3in    1206 × 2622  (402 × 874 @3x)  — App Store iPhone with Dynamic Island, medium display
 *   apple-6.9in    1320 × 2868  (440 × 956 @3x)  — App Store iPhone with Dynamic Island, large display
 *   google-phone   1080 × 1920  (360 × 640 @3x)  — Play phone screenshots (9:16, within the 2:1 limit)
 * Saved as JPEG: App Store screenshots must not contain an alpha channel; Play accepts JPEG too.
 */
const OUT = '../store/screenshots/draft-web-harness';
const SIZES = [
  { dir: 'apple-6.3in', viewport: { width: 402, height: 874 } },
  { dir: 'apple-6.9in', viewport: { width: 440, height: 956 } },
  { dir: 'google-phone', viewport: { width: 360, height: 640 } },
] as const;
const LOCALES = [
  { code: 'en', browserLocale: 'en-US' },
  { code: 'ar', browserLocale: 'ar-EG' },
] as const;

test.skip(!process.env.STORE_SHOTS, 'Store screenshots are generated on demand (STORE_SHOTS=1).');

for (const size of SIZES) {
  for (const loc of LOCALES) {
    test.describe(`${size.dir} ${loc.code}`, () => {
      test.use({ viewport: size.viewport, deviceScaleFactor: 3, locale: loc.browserLocale, contextOptions: { reducedMotion: 'reduce' } });

      test(`patient journey ${size.dir} ${loc.code}`, async ({ page }) => {
        const dir = `${OUT}/${size.dir}/${loc.code}`;
        mkdirSync(dir, { recursive: true });
        const capture = async (name: string) => {
          await page.waitForTimeout(1500);
          await page.screenshot({ path: `${dir}/${name}.jpg`, type: 'jpeg', quality: 90 });
        };

        await signInMobile(page, 'patient.demo@demo.ghayarly.test');
        await expect(byId(page, 'patient-home')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', loc.code);
        await capture('01-home');
        await byId(page, 'tab-health').click();
        await capture('02-health-records');
        await byId(page, 'tab-care').click();
        await capture('03-care');
        await byId(page, 'tab-store').click();
        await capture('04-tetrasol-store');
        await byId(page, 'tab-me').click();
        await byId(page, 'open-privacy').click();
        await expect(byId(page, 'privacy-center')).toBeVisible();
        await capture('05-privacy');
      });
    });
  }
}
