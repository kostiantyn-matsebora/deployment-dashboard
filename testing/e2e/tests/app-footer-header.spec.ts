/**
 * Live-app E2E — footer + header (issue #340).
 *
 * Runs against the Angular SPA at http://localhost:4200
 * (proxied through the NestJS mock on :3002).
 *
 * Assertions:
 *
 *   HEADER
 *     A) Brand text "Deployment Dashboard" is present.
 *     B) Old "Monitoring · Live" sub-line is ABSENT.
 *     C) No documentation icon/button in the topbar.
 *
 *   FOOTER
 *     D) Footer element is pinned to the viewport bottom (position: fixed).
 *     E) Version chip shows "v0.13.1" (the value served by the mock).
 *     F) Documentation link href = https://kostiantyn-matsebora.github.io/deployment-dashboard/
 *     G) @kostiantyn-matsebora href = https://github.com/kostiantyn-matsebora
 *     H) MIT License href = https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/LICENSE
 *
 * Screenshots:
 *   - header: <screenshots-dir>/header.png
 *   - footer:  <screenshots-dir>/footer.png
 *
 * The mock serves GET /api/version → { version: '0.13.1' } via app.controller.ts.
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';

// ---------------------------------------------------------------------------
// Screenshot directory — absolute path returned to the lead for visual gate.
// ---------------------------------------------------------------------------

const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'screenshots', 'footer-header');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the matrix view and wait for app-root + the footer to appear.
 * The footer mounts on every view — matrix is the default landing route.
 */
async function openApp(page: Page): Promise<void> {
  await page.goto('/matrix');
  await page.waitForSelector('app-root', { timeout: 20_000 });
  // Wait until the footer is attached to the DOM.
  // Use state:'attached' — position:fixed elements may not satisfy Playwright's
  // default 'visible' check until layout is fully settled.
  await page.waitForSelector('app-footer', { state: 'attached', timeout: 10_000 });
  // Allow the GET /api/version response to settle and the signal to update.
  await page.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// A–C) Header assertions
// ---------------------------------------------------------------------------

test.describe('Header', () => {

  test('A) brand text "Deployment Dashboard" is present in the topbar', async ({ page }) => {
    await openApp(page);

    // The brand text sits in the topbar regardless of view.
    const brand = page.locator('app-topbar').filter({ hasText: 'Deployment Dashboard' });
    await expect(brand).toBeVisible();
  });

  test('B) old "Monitoring · Live" sub-line is absent', async ({ page }) => {
    await openApp(page);

    // The sub-line was a separate element below the brand; it must not appear.
    const subline = page.locator('app-topbar').getByText(/monitoring\s*·\s*live/i);
    await expect(subline).toHaveCount(0);
  });

  test('C) no documentation icon/button in the topbar', async ({ page }) => {
    await openApp(page);

    // There must be no button/link with docs-related aria-labels or visible doc icon in topbar.
    const topbar = page.locator('app-topbar');
    const docsBtn = topbar.locator('a[href*="deployment-dashboard"], button[aria-label*="doc" i], a[aria-label*="doc" i]');
    await expect(docsBtn).toHaveCount(0);
  });

  test('screenshot: header', async ({ page }) => {
    await openApp(page);

    const topbar = page.locator('app-topbar');
    await expect(topbar).toBeVisible();

    const screenshotPath = path.join(SCREENSHOTS_DIR, 'header.png');
    await topbar.screenshot({ path: screenshotPath });

    // Emit for the lead's visual gate.
    console.log(`[SCREENSHOT] header: ${screenshotPath}`);
  });

});

// ---------------------------------------------------------------------------
// D–H) Footer assertions
// ---------------------------------------------------------------------------

test.describe('Footer', () => {

  test('D) footer is pinned to the viewport bottom (position: fixed)', async ({ page }) => {
    await openApp(page);

    const position = await page.locator('.site-footer').evaluate((el) => {
      return window.getComputedStyle(el).position;
    });
    expect(position).toBe('fixed');

    // The footer bottom edge should be at (or very close to) the viewport bottom.
    const footerBox  = await page.locator('.site-footer').boundingBox();
    const viewport   = page.viewportSize()!;
    expect(footerBox).not.toBeNull();
    // Allow up to 2px tolerance for sub-pixel rendering.
    expect(Math.abs((footerBox!.y + footerBox!.height) - viewport.height)).toBeLessThanOrEqual(2);
  });

  test('E) version chip shows "v0.13.1" — the value served by the mock', async ({ page }) => {
    await openApp(page);

    const chip = page.locator('.brand-ver-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('v0.13.1');
  });

  test('F) Documentation link href = docs site URL', async ({ page }) => {
    await openApp(page);

    const docsLink = page.locator('app-footer a').filter({ hasText: 'Documentation' });
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute(
      'href',
      'https://kostiantyn-matsebora.github.io/deployment-dashboard/',
    );
  });

  test('G) @kostiantyn-matsebora link href = GitHub profile URL', async ({ page }) => {
    await openApp(page);

    const authorLink = page.locator('app-footer a').filter({ hasText: '@kostiantyn-matsebora' });
    await expect(authorLink).toBeVisible();
    await expect(authorLink).toHaveAttribute('href', 'https://github.com/kostiantyn-matsebora');
  });

  test('H) MIT License link href = LICENSE file URL', async ({ page }) => {
    await openApp(page);

    const licenseLink = page.locator('app-footer a').filter({ hasText: 'MIT License' });
    await expect(licenseLink).toBeVisible();
    await expect(licenseLink).toHaveAttribute(
      'href',
      'https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/LICENSE',
    );
  });

  test('screenshot: footer', async ({ page }) => {
    await openApp(page);

    // Use the inner .site-footer element for the screenshot — the Angular host
    // element (app-footer) has no intrinsic dimensions and is considered hidden
    // by Playwright's visibility check even though the fixed bar is rendered.
    const footer = page.locator('.site-footer');
    await expect(footer).toBeVisible();

    const screenshotPath = path.join(SCREENSHOTS_DIR, 'footer.png');
    await footer.screenshot({ path: screenshotPath });

    console.log(`[SCREENSHOT] footer: ${screenshotPath}`);
  });

});
