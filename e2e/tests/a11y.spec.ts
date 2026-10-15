import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { byId, signInMobile } from './helpers';

/**
 * Screen-level accessibility & layout checks on the app rendered by react-native-web.
 * This is a PROXY for native: it validates semantics (roles, names, states), colour contrast as
 * rendered, reflow at narrow widths and touch-target sizes. VoiceOver/TalkBack, Dynamic Type and
 * native gestures still require on-device testing (docs/release/RELEASE_STATUS.md).
 *
 * Gate: no "serious" or "critical" WCAG 2.2 A/AA violations; no horizontal scrolling and no control
 * pushed outside the viewport at 320 / 360 / 390 px; interactive targets ≥ 44×44 px (WCAG 2.5.8 needs
 * 24; Apple HIG 44 pt; Material 48 dp).
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page: Page, name: string) {
  // Let entrance animations (≤ 900 ms) settle so contrast is measured on final colours.
  await page.waitForTimeout(1500);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.nodes[0]?.target.join(' ')} — ${v.nodes[0]?.any[0]?.message ?? v.nodes[0]?.failureSummary ?? ''}`);
  expect(summary, `${name}: axe violations`).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${name}: horizontal overflow (px)`).toBeLessThanOrEqual(1);

  const small = await page.evaluate(() =>
    // Native Switch controls are OS-provided (UISwitch / SwitchCompat with platform hit areas); the
    // react-native-web stand-in is excluded from this size check.
    [...document.querySelectorAll<HTMLElement>('[role="button"],[role="checkbox"],[role="radio"],[role="tab"],button')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && (r.width < 44 || r.height < 44);
      })
      .map((el) => `${el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`),
  );
  expect(small, `${name}: touch targets under 44 px`).toEqual([]);

  // Page-level overflow misses controls pushed out of their card (e.g. a non-wrapping button row on a
  // 360 px phone, which clips in LTR and spills past the card edge in RTL): every control must sit
  // inside each of its containers, unless a container scrolls horizontally (profile switcher, carousels).
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="button"],[role="checkbox"],[role="switch"],[role="tab"],[role="link"],button,a,input')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') return null;
        const name = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30);
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if ((ox === 'auto' || ox === 'scroll') && a.scrollWidth > a.clientWidth) return null;
          const ar = a.getBoundingClientRect();
          if (ar.width > 0 && (r.left < ar.left - 1 || r.right > ar.right + 1)) return `${name} overflows its container by ${Math.round(Math.max(ar.left - r.left, r.right - ar.right))} px`;
        }
        return r.left < -1 || r.right > window.innerWidth + 1 ? `${name} outside the viewport` : null;
      })
      .filter(Boolean),
  );
  expect(clipped, `${name}: controls clipped or outside their container`).toEqual([]);
}

for (const width of [320, 360, 390]) {
  test.describe(`accessibility @ ${width}px`, () => {
    // Emulate "reduce motion". On iOS/Android the app honours it through Reanimated's
    // ReducedMotionConfig (verified on device only); the web harness may still animate, hence the
    // settle delay in audit().
    test.use({ viewport: { width, height: 760 }, contextOptions: { reducedMotion: 'reduce' } });

    test(`public screens (EN + AR) @${width}`, async ({ page }) => {
      await page.goto('/welcome');
      await expect(byId(page, 'welcome-screen')).toBeVisible();
      await audit(page, `welcome-en-${width}`);
      await byId(page, 'language-toggle').click();
      await expect(byId(page, 'welcome-get-started')).toContainText('إنشاء حساب');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await audit(page, `welcome-ar-${width}`);
      await byId(page, 'language-toggle').click();
      await page.goto('/sign-in');
      await audit(page, `sign-in-${width}`);
    });

    test(`patient screens @${width}`, async ({ page }) => {
      await signInMobile(page, 'patient.demo@demo.ghayarly.test');
      await expect(byId(page, 'tab-home')).toBeVisible();
      await audit(page, `patient-home-${width}`);
      for (const tab of ['tab-health', 'tab-care', 'tab-store', 'tab-me']) {
        await byId(page, tab).click();
        await audit(page, `${tab}-${width}`);
      }
      await byId(page, 'open-privacy').click();
      await expect(byId(page, 'privacy-center')).toBeVisible();
      await audit(page, `privacy-center-${width}`);
      await byId(page, 'open-delete-account').click();
      await expect(byId(page, 'delete-account')).toBeVisible();
      await audit(page, `delete-account-${width}`);
      await page.goBack();
      await page.goBack();
      await byId(page, 'open-subscription').click();
      await expect(byId(page, 'subscription-screen')).toBeVisible();
      await audit(page, `subscription-${width}`);
    });

    test(`clinician screens @${width}`, async ({ page }) => {
      await signInMobile(page, 'nurse.demo@demo.ghayarly.test');
      await expect(byId(page, 'clinician-dashboard')).toBeVisible();
      await audit(page, `clinician-dashboard-${width}`);
      await byId(page, 'tab-availability').click();
      await audit(page, `availability-${width}`);
    });
  });
}
