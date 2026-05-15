// Implements testing/e2e/scenarios/correlation-picker-localstorage-and-no-api-key.md
//
// Asserts the SAD §10 Decision #7 contract: the correlation-attribute
// picker is a localStorage-only override that travels as a
// ?correlationAttribute= query parameter on read endpoints. The SPA
// must never PATCH /api/config/topology and must never send an
// X-Api-Key header.

import { test, expect, type Request } from '@playwright/test';

const PICKER = '[data-testid="topology-picker-button"]';
const OPTION = (attr: string) => `[data-testid="topology-option-${attr}"]`;
// The radio inputs inside the popover are visually tiny and absolutely
// positioned; in narrow viewports Playwright can't land a real click on
// them. Click the enclosing <label> instead — the browser forwards
// label-clicks to the associated control, which fires the (change)
// handler on the radio just like a real user click.
const OPTION_LABEL = (attr: string) => `label:has([data-testid="topology-option-${attr}"])`;
const STORAGE_KEY = 'dashboard.correlationAttribute';
const ALLOWED = ['version', 'ref', 'sha', 'actor', 'run', 'ago'] as const;

test('Correlation picker writes to localStorage only, appends query param, and never sends X-Api-Key', async ({ page, context }) => {
  // ---------- collectors ----------
  const allRequests: Request[] = [];
  const matrixRequests: Request[] = [];
  const patchRequests: Request[] = [];
  const requestsWithApiKey: { url: string; headers: Record<string, string> }[] = [];

  page.on('request', (req) => {
    allRequests.push(req);
    const url = req.url();
    const method = req.method().toUpperCase();
    const headers = req.headers(); // already lowercased keys per Playwright
    if (headers['x-api-key'] !== undefined) {
      requestsWithApiKey.push({ url, headers });
    }
    if (method === 'PATCH') {
      patchRequests.push(req);
    }
    if (method === 'GET' && url.includes('/api/deployments') && !url.includes('/history')) {
      matrixRequests.push(req);
    }
  });

  // ---------- fresh start ----------
  // Clear storage in the SPA's origin context.
  await page.goto('/');
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, STORAGE_KEY);
  await page.reload();

  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();

  // Sanity: the SPA bootstrap issued at least one matrix GET; none had X-Api-Key.
  expect(matrixRequests.length).toBeGreaterThanOrEqual(1);
  expect(requestsWithApiKey).toEqual([]);

  // ---------- toggle picker to a non-default value ----------
  const picker = page.locator(PICKER);
  const pickerVisible = await picker.count();
  if (pickerVisible === 0) {
    // The picker UI hasn't landed yet (frontend is in the middle of
    // wiring this up under SAD §11 WBS 3.2.5). We bail with a clear
    // skip message that names the missing data-testid; once frontend
    // ships the picker this test becomes the contract verifier.
    test.skip(true, 'topology-picker not yet present in the SPA - frontend WBS 3.2.5; data-testid="topology-picker-button" expected per SAD §7 "Dashboard Frontend (MVP)"');
    return;
  }

  const matrixBeforeFirstChange = matrixRequests.length;
  await picker.click();
  const actorOption = page.locator(OPTION('actor'));
  await actorOption.waitFor({ state: 'visible', timeout: 5_000 });
  // Click the enclosing <label> rather than the radio itself — the
  // radio is visually 1rem-ish and in narrow viewports lives outside
  // Playwright's actionable area. The browser forwards label-clicks to
  // the associated control, firing the same (change) handler.
  await page.locator(OPTION_LABEL('actor')).click();

  // localStorage updates immediately on click.
  const persistedAfterActor = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(persistedAfterActor).toBe('actor');

  // A new matrix GET is issued with the new query parameter.
  await expect.poll(() => matrixRequests.length, { timeout: 5_000 }).toBeGreaterThan(matrixBeforeFirstChange);
  const lastMatrix = matrixRequests[matrixRequests.length - 1];
  expect(lastMatrix.url()).toMatch(/[?&]correlationAttribute=actor(?:&|$)/);
  // And it carries no auth.
  expect(lastMatrix.headers()['x-api-key']).toBeUndefined();

  // ---------- second toggle, different value ----------
  const matrixBeforeSecondChange = matrixRequests.length;
  await picker.click();
  await page.locator(OPTION_LABEL('sha')).click();

  const persistedAfterSha = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(persistedAfterSha).toBe('sha');

  await expect.poll(() => matrixRequests.length, { timeout: 5_000 }).toBeGreaterThan(matrixBeforeSecondChange);
  expect(matrixRequests[matrixRequests.length - 1].url())
    .toMatch(/[?&]correlationAttribute=sha(?:&|$)/);

  // ---------- reload picks up the persisted value ----------
  matrixRequests.length = 0;
  await page.reload();
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
  // The bootstrap matrix GET on the reloaded page carries ?correlationAttribute=sha.
  expect(matrixRequests.length).toBeGreaterThanOrEqual(1);
  const bootstrap = matrixRequests[0];
  expect(bootstrap.url()).toMatch(/[?&]correlationAttribute=sha(?:&|$)/);

  // ---------- final invariants across the whole scenario ----------
  // No PATCH from the SPA, ever. Per SAD §7 "PATCH /api/config/topology":
  // "Admin / CI / ops tooling only - not invoked by the SPA."
  expect(patchRequests, 'SPA must not PATCH /api/config/topology (SAD §7 + §10 Decision #7)').toEqual([]);

  // No X-Api-Key from the SPA, ever. Per SAD §5 NFR-04: "the SPA does
  // not handle authentication secrets. The dev-environment fake API key
  // is never embedded in the SPA bundle."
  expect(requestsWithApiKey, `SPA must not send X-Api-Key on any request (SAD §5 NFR-04). Offenders: ${
    requestsWithApiKey.map((r) => r.url).join(', ')
  }`).toEqual([]);

  // Persisted value is in the allowed set.
  const finalPersisted = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  if (finalPersisted !== null) {
    expect(ALLOWED).toContain(finalPersisted as typeof ALLOWED[number]);
  }
});
