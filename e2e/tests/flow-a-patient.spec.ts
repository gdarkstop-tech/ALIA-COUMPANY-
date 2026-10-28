import { expect, test } from '@playwright/test';
import { byId, shot, signInMobile, unique } from './helpers';

/**
 * Flow A — Patient: Sign in → Patient Home → My Health → Add Family Member → Switch Profile →
 * Find Doctor → View Doctor Profile. A fresh account is created through the real sign-up and
 * progressive onboarding first, so the run is repeatable and also covers onboarding.
 */
test('Flow A — patient journey with family management and discovery', async ({ page }) => {
  const email = unique('flow-a');
  const password = 'E2e-Password-2026';

  await page.goto('/welcome');
  await shot(page, 'A01-welcome');
  await byId(page, 'welcome-get-started').click();
  await byId(page, 'sign-up-name').fill('Mona Test');
  await byId(page, 'sign-up-email').fill(email);
  await byId(page, 'sign-up-password').fill(password);
  await byId(page, 'sign-up-submit').click();

  // Consent gate: terms + privacy must be accepted explicitly (marketing stays optional, unticked).
  await expect(byId(page, 'consent-gate')).toBeVisible();
  await expect(byId(page, 'consent-accept')).toHaveAttribute('aria-disabled', 'true');
  await byId(page, 'consent-terms').click();
  await byId(page, 'consent-privacy').click();
  await shot(page, 'A01b-consent-gate');
  await byId(page, 'consent-accept').click();

  await expect(byId(page, 'role-screen')).toBeVisible();
  await shot(page, 'A02-role-selection');
  await byId(page, 'role-PATIENT').click();

  await expect(byId(page, 'patient-onboarding')).toBeVisible();
  await byId(page, 'onb-dob').fill('19900315');
  await expect(byId(page, 'onb-dob')).toHaveValue('1990-03-15');
  // Governorate, city / area and mobile number are required.
  await expect(byId(page, 'onboarding-next')).toHaveAttribute('aria-disabled', 'true');
  await byId(page, 'onb-governorate').click();
  await byId(page, 'onb-governorate-option-CAIRO').click();
  await byId(page, 'onb-city').fill('Nasr City');
  await byId(page, 'onb-phone').fill('01012345678');
  // Explicit, separate health-data consent before any health information is stored.
  await expect(byId(page, 'onboarding-next')).toHaveAttribute('aria-disabled', 'true');
  await byId(page, 'health-consent').click();
  await shot(page, 'A03-onboarding-step1');
  await byId(page, 'onboarding-next').click();
  await byId(page, 'onb-entry-ALLERGY').fill('Latex');
  await byId(page, 'onb-entry-ALLERGY').press('Enter');
  await expect(page.getByText('Latex')).toBeVisible();
  await shot(page, 'A04-onboarding-health');
  await byId(page, 'onboarding-next').click();
  await byId(page, 'onboarding-finish').click();
  await expect(byId(page, 'patient-home')).toBeVisible();

  // Sign out and sign back in through the sign-in screen.
  await byId(page, 'tab-me').click();
  await byId(page, 'sign-out').click();
  await expect(byId(page, 'welcome-screen')).toBeVisible();
  await signInMobile(page, email, password);

  // Patient Home
  await expect(byId(page, 'patient-home')).toBeVisible();
  await expect(byId(page, 'home-greeting')).toContainText('Mona');
  await shot(page, 'A05-patient-home');

  // My Health — the onboarding allergy is there, marked as patient-reported.
  await byId(page, 'tab-health').click();
  await expect(byId(page, 'my-health')).toBeVisible();
  await expect(byId(page, 'entry-Latex')).toContainText('Patient-reported');
  await shot(page, 'A06-my-health');

  // Add Family Member (adult → explicit consent attestation required).
  await byId(page, 'tab-home').click();
  await byId(page, 'profile-chip-add').click();
  await expect(byId(page, 'family-add-screen')).toBeVisible();
  await byId(page, 'family-name').fill('Nadia');
  await byId(page, 'family-relationship').click();
  await byId(page, 'family-relationship-option-MOTHER').click();
  await byId(page, 'family-dob').fill('19580912');
  await byId(page, 'family-add-submit').click();
  await expect(byId(page, 'family-add-error')).toBeVisible(); // consent not yet confirmed
  await byId(page, 'family-consent').click();
  await shot(page, 'A07-add-family-consent');
  await byId(page, 'family-add-submit').click();

  // The new profile becomes active.
  await expect(byId(page, 'patient-home')).toBeVisible();
  await expect(byId(page, 'viewing-profile')).toContainText('Nadia');
  await shot(page, 'A08-viewing-mother');

  // Switch Profile back to self.
  await byId(page, 'profile-chip-SELF').click();
  await expect(byId(page, 'viewing-profile')).toBeHidden();

  // Find Doctor → View Doctor Profile
  await byId(page, 'tab-care').click();
  await expect(byId(page, 'find-care')).toBeVisible();
  const results = byId(page, 'provider-results');
  await expect(results).toBeVisible();
  await shot(page, 'A09-find-care');
  await results.locator('[data-testid^="provider-card-"]').first().click();
  await expect(byId(page, 'provider-profile')).toBeVisible();
  await expect(byId(page, 'provider-name')).not.toBeEmpty();
  await shot(page, 'A10-doctor-profile');
  await byId(page, 'book-now').click();
  await expect(byId(page, 'booking-sheet')).toContainText('Nothing has been booked or charged');
});
