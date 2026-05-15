// Implements testing/e2e/scenarios/topology-picker-ref-sha-query-param.md
//
// Pins the FR-13 contract for the Topology correlation picker against
// `ref` and `sha`: both options are present; selecting either writes
// the attribute to localStorage AND appends it as ?correlationAttribute=
// on the next GET /api/deployments. No PATCH is ever issued; no
// X-Api-Key header ever leaves the SPA. Companion to the existing
// correlation-picker-localstorage-and-no-api-key.spec.ts which covers
// actor + sha; this spec is the explicit ref path + the negative-auth
// assertions for both new values.

import { test, expect, type Request } from '@playwright/test';

const PICKER = '[data-testid="topology-picker-button"]';
const OPTION = (attr: string) => `[data-testid="topology-option-${attr}"]`;
const OPTION_LABEL = (attr: string) => `label:has([data-testid="topology-option-${attr}"])`;
const STORAGE_KEY = 'dashboard.correlationAttribute';

test('Topology picker exposes ref + sha options; both round-trip to ?correlationAttribute= without PATCH or X-Api-Key', async ({ page }) => {
  const allRequests: Request[] = [];
  const matrixRequests: Request[] = [];
  const patchRequests: Request[] = [];
  const apiKeyOffenders: { url: string; headers: Record<string, string> }[] = [];

  page.on('request', (req) => {
    allRequests.push(req);
    const url = req.url();
    const method = req.method().toUpperCase();
    const headers = req.headers();
    if (headers['x-api-key'] !== undefined) {
      apiKeyOffenders.push({ url, headers });
    }
    if (method === 'PATCH') patchRequests.push(req);
    if (method === 'GET' && url.includes('/api/deployments') && !url.includes('/history')) {
      matrixRequests.push(req);
    }
  });

  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();

  const picker = page.locator(PICKER);
  if ((await picker.count()) === 0) {
    test.skip(true, 'topology-picker not yet present in the SPA — frontend WBS 3.2.5');
    return;
  }

  // ---------- Part 1: both ref + sha options are present in the picker ----------
  await picker.click();
  for (const attr of ['version', 'ref', 'sha', 'actor', 'run', 'ago']) {
    await expect(
      page.locator(OPTION(attr)),
      `topology picker must expose ?correlationAttribute=${attr} option (SAD §7 allowed set)`,
    ).toBeAttached();
  }
  // Close the popover.
  await picker.click();

  // ---------- Part 2: selecting ref writes localStorage + matrix GET carries the param ----------
  const matrixBeforeRef = matrixRequests.length;
  await picker.click();
  await page.locator(OPTION_LABEL('ref')).click();

  const persistedRef = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(persistedRef).toBe('ref');

  await expect.poll(() => matrixRequests.length, { timeout: 5_000 }).toBeGreaterThan(matrixBeforeRef);
  const lastAfterRef = matrixRequests[matrixRequests.length - 1];
  expect(lastAfterRef.url()).toMatch(/[?&]correlationAttribute=ref(?:&|$)/);
  expect(lastAfterRef.headers()['x-api-key']).toBeUndefined();

  // ---------- Part 3: selecting sha overrides + matrix GET carries the new param ----------
  const matrixBeforeSha = matrixRequests.length;
  await picker.click();
  await page.locator(OPTION_LABEL('sha')).click();

  const persistedSha = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(persistedSha).toBe('sha');

  await expect.poll(() => matrixRequests.length, { timeout: 5_000 }).toBeGreaterThan(matrixBeforeSha);
  expect(matrixRequests[matrixRequests.length - 1].url())
    .toMatch(/[?&]correlationAttribute=sha(?:&|$)/);

  // ---------- Part 4: reload picks up the persisted value ----------
  matrixRequests.length = 0;
  await page.reload();
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
  expect(matrixRequests.length).toBeGreaterThanOrEqual(1);
  expect(matrixRequests[0].url()).toMatch(/[?&]correlationAttribute=sha(?:&|$)/);

  // ---------- Final invariants ----------
  // Per SAD §10 Decision #7: NO PATCH from the SPA.
  expect(
    patchRequests,
    'SPA must not PATCH /api/config/topology when ref/sha is selected (SAD §10 Decision #7)',
  ).toEqual([]);
  // Per SAD §5 NFR-04: NO X-Api-Key on any SPA request.
  expect(
    apiKeyOffenders,
    `SPA must not send X-Api-Key on any request (SAD §5 NFR-04). Offenders: ${
      apiKeyOffenders.map((o) => o.url).join(', ')
    }`,
  ).toEqual([]);
});
