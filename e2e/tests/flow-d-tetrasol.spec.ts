import { expect, test } from '@playwright/test';
import { byId, shot, signInMobile } from './helpers';

/**
 * Flow D — TetraSol: Patient Home → TetraSol Care → Catalog → Product Details → Cart/Checkout
 * preview. The checkout must be unmistakably simulated: no order, no charge.
 */
test('Flow D — TetraSol-only store with simulated checkout', async ({ page }) => {
  await signInMobile(page, 'patient.demo@demo.ghayarly.test');
  await expect(byId(page, 'patient-home')).toBeVisible();
  // The official TetraSol logo marks every TetraSol surface.
  await expect(byId(page, 'home-tetrasol-logo')).toHaveAccessibleName('TetraSol');
  await byId(page, 'home-tetrasol').click();

  await expect(byId(page, 'tetrasol-store')).toBeVisible();
  await expect(byId(page, 'store-demo-notice')).toBeVisible();
  await expect(byId(page, 'tetrasol-logo')).toBeVisible();
  await expect(page.getByTestId('product-visual-logo').filter({ visible: true }).first()).toBeVisible();
  await expect(byId(page, 'product-grid')).toContainText('TetraSol');
  await shot(page, 'D01-catalog');

  await byId(page, 'product-demo-tetrasol-placeholder-a').click();
  await expect(byId(page, 'product-detail')).toBeVisible();
  await expect(byId(page, 'product-demo-notice')).toContainText('Not a real product');
  await expect(byId(page, 'product-visual-logo')).toBeVisible();
  await shot(page, 'D02-product-detail');
  await byId(page, 'add-to-cart').click();
  await expect(byId(page, 'toast')).toContainText('Added to cart');

  await page.goto('/patient/cart');
  await expect(byId(page, 'cart-screen')).toBeVisible();
  await expect(byId(page, 'cart-line-demo-tetrasol-placeholder-a')).toBeVisible();
  await shot(page, 'D03-cart');
  await byId(page, 'go-checkout').click();

  await expect(byId(page, 'checkout-screen')).toBeVisible();
  await expect(byId(page, 'simulated-notice')).toContainText('no payment will be taken');
  await expect(byId(page, 'payment-status')).toHaveText('Not configured');
  await expect(byId(page, 'place-order')).toHaveAttribute('aria-disabled', 'true');
  await shot(page, 'D04-checkout-preview');
});
