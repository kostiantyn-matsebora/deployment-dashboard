// Implements testing/e2e/scenarios/theme-switcher-popover-open-and-select.md
//
// Gear button opens / closes the popover; clicking each of the three
// radio options flips <html data-theme> + <html data-theme-pref>
// live without a navigation.

import { test, expect, type Page } from '@playwright/test';

async function readDataset(page: Page): Promise<{ theme: string | null; pref: string | null }> {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.documentElement.getAttribute('data-theme-pref'),
  }));
}

async function installPersistenceMarker(page: Page): Promise<void> {
  // We use this to confirm that clicking a theme option does NOT cause
  // a navigation / full reload — the marker would be erased by one.
  await page.evaluate(() => {
    (window as unknown as { __THEME_NAV_MARKER__?: number }).__THEME_NAV_MARKER__ = Date.now();
  });
}

async function navigationMarkerStillPresent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return typeof (window as unknown as { __THEME_NAV_MARKER__?: number }).__THEME_NAV_MARKER__ === 'number';
  });
}

test.describe('Theme switcher — popover open + select', () => {
  test.beforeEach(async ({ page }) => {
    // Deterministic OS for the auto case.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('theme-switcher')).toBeVisible();
  });

  test('gear is visible, popover is closed by default', async ({ page }) => {
    const gear = page.getByTestId('theme-gear');
    await expect(gear).toBeVisible();
    await expect(gear).toHaveAttribute('aria-expanded', 'false');

    // Options not visible while popover is closed.
    await expect(page.getByTestId('theme-option-light')).toBeHidden();
    await expect(page.getByTestId('theme-option-dark')).toBeHidden();
    await expect(page.getByTestId('theme-option-auto')).toBeHidden();
  });

  test('clicking the gear opens the popover and exposes three options', async ({ page }) => {
    const gear = page.getByTestId('theme-gear');
    await gear.click();
    await expect(gear).toHaveAttribute('aria-expanded', 'true');

    await expect(page.getByTestId('theme-option-light')).toBeVisible();
    await expect(page.getByTestId('theme-option-dark')).toBeVisible();
    await expect(page.getByTestId('theme-option-auto')).toBeVisible();
  });

  test('selecting "Dark" flips data-theme + data-theme-pref live, no navigation', async ({ page }) => {
    await installPersistenceMarker(page);

    await page.getByTestId('theme-gear').click();
    await page.getByTestId('theme-option-dark').click();

    await expect.poll(async () => (await readDataset(page)).theme).toBe('dark');
    await expect.poll(async () => (await readDataset(page)).pref).toBe('dark');

    // No navigation has occurred — the marker we set on window is still
    // there.
    expect(await navigationMarkerStillPresent(page)).toBe(true);
  });

  test('selecting "Light" flips data-theme + data-theme-pref live, no navigation', async ({ page }) => {
    await installPersistenceMarker(page);

    await page.getByTestId('theme-gear').click();
    await page.getByTestId('theme-option-light').click();

    await expect.poll(async () => (await readDataset(page)).theme).toBe('light');
    await expect.poll(async () => (await readDataset(page)).pref).toBe('light');

    expect(await navigationMarkerStillPresent(page)).toBe(true);
  });

  test('selecting "Auto" sets pref=auto and effective follows OS (light here)', async ({ page }) => {
    await installPersistenceMarker(page);

    // Start by going to Dark so the click on Auto changes something.
    await page.getByTestId('theme-gear').click();
    await page.getByTestId('theme-option-dark').click();
    await expect.poll(async () => (await readDataset(page)).pref).toBe('dark');

    await page.getByTestId('theme-gear').click(); // re-open if needed
    await page.getByTestId('theme-option-auto').click();

    await expect.poll(async () => (await readDataset(page)).pref).toBe('auto');
    // We set OS=light in beforeEach.
    await expect.poll(async () => (await readDataset(page)).theme).toBe('light');

    expect(await navigationMarkerStillPresent(page)).toBe(true);
  });

  test('gear title contains both the persisted pref and the effective palette', async ({ page }) => {
    await page.getByTestId('theme-gear').click();
    await page.getByTestId('theme-option-dark').click();
    // Title format per the mockup: `Theme: ${themePref} · effective ${effectiveTheme}`
    const titleAfterDark = (await page.getByTestId('theme-gear').getAttribute('title')) ?? '';
    expect(titleAfterDark.toLowerCase()).toContain('dark');

    await page.getByTestId('theme-gear').click();
    await page.getByTestId('theme-option-light').click();
    const titleAfterLight = (await page.getByTestId('theme-gear').getAttribute('title')) ?? '';
    expect(titleAfterLight.toLowerCase()).toContain('light');
  });
});
