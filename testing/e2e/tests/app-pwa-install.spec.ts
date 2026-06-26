/**
 * Live-app E2E — PWA installability (issue #314).
 *
 * Runs against the Angular SPA at http://localhost:4200
 * (proxied through the NestJS mock on :3002).
 *
 * Assertions:
 *
 *   A) <link rel="manifest"> is present in the served HTML.
 *
 *   MANIFEST FIELDS (fetched from /manifest.webmanifest):
 *   B) name = "Deployment Dashboard"
 *   C) short_name = "Dashboard"
 *   D) display = "standalone"
 *   E) scope = "/"
 *   F) start_url = "/"
 *   G) theme_color = "#0b0d14"
 *
 *   ICON COVERAGE:
 *   H) A 192×192 icon is listed (any purpose).
 *   I) A 512×512 icon is listed (any purpose).
 *   J) At least one icon has purpose "maskable".
 *
 *   ICON REACHABILITY:
 *   K) Every icon src listed in the manifest returns HTTP 200.
 *
 * Contract source: .team-process/sessions/feat-314/contract-manifest.md
 */

import { test, expect, Page, APIRequestContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the root route and wait for app-root to appear so the full
 * document (including <head> meta) is served.
 */
async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('app-root', { timeout: 20_000 });
}

/**
 * Fetch /manifest.webmanifest via the Playwright API context (which uses the
 * live-app baseURL = http://localhost:4200) and return the parsed JSON.
 */
async function fetchManifest(request: APIRequestContext): Promise<Record<string, unknown>> {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  return res.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// A) <link rel="manifest"> present in HTML
// ---------------------------------------------------------------------------

test.describe('PWA — manifest link in HTML', () => {

  test('A) <link rel="manifest"> is present in the served document', async ({ page }) => {
    await openApp(page);

    // Query via JS so we assert on the live DOM, not a selector guess.
    const href = await page.evaluate(() => {
      const el = document.head.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
      return el?.getAttribute('href') ?? null;
    });

    expect(href).not.toBeNull();
    expect(href).toBe('manifest.webmanifest');
  });

});

// ---------------------------------------------------------------------------
// B–G) Manifest field assertions
// ---------------------------------------------------------------------------

test.describe('PWA — manifest fields', () => {

  test('B) name = "Deployment Dashboard"', async ({ request }) => {
    const manifest = await fetchManifest(request);
    expect(manifest['name']).toBe('Deployment Dashboard');
  });

  test('C) short_name = "Dashboard"', async ({ request }) => {
    const manifest = await fetchManifest(request);
    expect(manifest['short_name']).toBe('Dashboard');
  });

  test('D) display = "standalone"', async ({ request }) => {
    const manifest = await fetchManifest(request);
    expect(manifest['display']).toBe('standalone');
  });

  test('E) scope = "/"', async ({ request }) => {
    const manifest = await fetchManifest(request);
    expect(manifest['scope']).toBe('/');
  });

  test('F) start_url = "/"', async ({ request }) => {
    const manifest = await fetchManifest(request);
    expect(manifest['start_url']).toBe('/');
  });

  test('G) theme_color = "#0b0d14"', async ({ request }) => {
    const manifest = await fetchManifest(request);
    expect(manifest['theme_color']).toBe('#0b0d14');
  });

});

// ---------------------------------------------------------------------------
// H–J) Icon coverage assertions
// ---------------------------------------------------------------------------

test.describe('PWA — icon coverage', () => {

  type ManifestIcon = { src: string; sizes: string; type?: string; purpose?: string };

  async function icons(request: APIRequestContext): Promise<ManifestIcon[]> {
    const manifest = await fetchManifest(request);
    return (manifest['icons'] as ManifestIcon[]) ?? [];
  }

  test('H) a 192×192 icon is listed in the manifest', async ({ request }) => {
    const list = await icons(request);
    const has192 = list.some((ic) => ic.sizes === '192x192');
    expect(has192).toBe(true);
  });

  test('I) a 512×512 icon is listed in the manifest', async ({ request }) => {
    const list = await icons(request);
    const has512 = list.some((ic) => ic.sizes === '512x512');
    expect(has512).toBe(true);
  });

  test('J) at least one icon has purpose "maskable"', async ({ request }) => {
    const list = await icons(request);
    const hasMaskable = list.some((ic) => ic.purpose === 'maskable');
    expect(hasMaskable).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// K) Icon reachability — every listed src returns 200
// ---------------------------------------------------------------------------

test.describe('PWA — icon reachability', () => {

  test('K) every icon src in the manifest returns HTTP 200', async ({ request }) => {
    const manifest = await fetchManifest(request);
    type ManifestIcon = { src: string; sizes: string; type?: string; purpose?: string };
    const iconList = (manifest['icons'] as ManifestIcon[]) ?? [];

    expect(iconList.length).toBeGreaterThan(0);

    for (const icon of iconList) {
      // Icon src values are relative to the manifest location (SPA root).
      const res = await request.get(`/${icon.src}`);
      expect(
        res.status(),
        `icon ${icon.src} (${icon.sizes}, purpose=${icon.purpose ?? 'any'}) expected 200 but got ${res.status()}`,
      ).toBe(200);
    }
  });

});
