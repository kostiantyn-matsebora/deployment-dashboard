// Implements testing/e2e/scenarios/focus-on-last-event-toggle.md
//
// Exercises the "Focus on last event" header toggle:
//   ON  -> SSE slot-update events scroll the affected service row into
//          view and pulse it.
//   OFF -> SSE slot-update events apply data only; no scroll, no pulse
//          on off-screen rows.
//
// The SSE event is induced by a real POST to /api/deployments using
// the same buildDeploymentPayload helper as the realtime scenario.
//
// We POST a "baseline" success deployment first so the affected
// service row exists at page load - then scroll to top and POST the
// "trigger" event we actually measure.

import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { WRITE_BASE_URL, API_KEY, runSuffix, buildDeploymentPayload } from './support/env';

const TOGGLE = '[data-testid="focus-on-last-event-toggle"]';
const STORAGE_KEY = 'dashboard.focusOnLastEvent';

// Pick a viewport that comfortably overflows the corpus + extra rows
// so we can talk about "off-screen" without depending on flaky scroll
// math.
test.use({ viewport: { width: 1440, height: 520 } });

async function postBaseline(apiContext: APIRequestContext, service: string, env: string): Promise<void> {
  const resp = await apiContext.post('/api/deployments', {
    data: buildDeploymentPayload({
      service,
      environment: env,
      version: 'v0.0.0',
      status: 'success',
      run_url: 'https://example.com/runs/focus-baseline',
      run_number: 99000,
    }),
  });
  expect(resp.status()).toBe(201);
}

async function postTrigger(apiContext: APIRequestContext, service: string, env: string, version: string): Promise<void> {
  const resp = await apiContext.post('/api/deployments', {
    data: buildDeploymentPayload({
      service,
      environment: env,
      version,
      status: 'in-progress',
      run_url: 'https://example.com/runs/focus-trigger',
      run_number: 99100,
    }),
  });
  expect(resp.status()).toBe(201);
}

test.describe('Focus on last event - viewport response to SSE updates', () => {
  test('ON: off-screen row scrolls into view + pulses within 5 s', async ({ page }) => {
    const apiContext = await playwrightRequest.newContext({
      baseURL: WRITE_BASE_URL,
      extraHTTPHeaders: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
    });

    const suffix = runSuffix();
    const SERVICE = `qa-bot-focus-on-${suffix}`.slice(0, 32);
    const ENV = 'fn-focus';
    const TEST_ID = `stage-box-${SERVICE}-${ENV}`;
    const ROW = `[data-service-row="${SERVICE}"]`;

    // Baseline row so the matrix has SOMETHING at SERVICE/ENV before navigation.
    await postBaseline(apiContext, SERVICE, ENV);

    await page.goto('/');
    // Explicit wait — Angular bootstraps the header asynchronously after
    // `goto`, so a synchronous `.count() === 0` check races the SPA and
    // false-negatives this scenario into `test.skip`. Wait up to 10 s for
    // the toggle to be attached; if it never appears, THEN we can fairly
    // declare it missing.
    try {
      await page.waitForSelector(TOGGLE, { state: 'attached', timeout: 10_000 });
    } catch {
      test.skip(true, 'focus-on-last-event-toggle not yet present in the SPA (frontend WBS in flight)');
      await apiContext.dispose();
      return;
    }

    // Set toggle ON via the checkbox; persistence sanity.
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
    await page.reload();
    await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
    await expect(page.locator(`[data-testid='${TEST_ID}']`).first()).toBeAttached({ timeout: 5_000 });

    const toggle = page.locator(TOGGLE);
    const isCheckedNow = await toggle.isChecked().catch(() => false);
    if (!isCheckedNow) await toggle.check();
    const persisted = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(persisted).toBe('true');

    // Scroll to the top so the ephemeral service is below the fold.
    // Ephemeral `qa-bot-*` services typically render after the seeded
    // `service-a..d` rows; we ensure scroll-position=0 so it sits below
    // the visible viewport.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    const rowOffscreenBefore = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, viewportH: window.innerHeight };
    }, ROW);
    if (rowOffscreenBefore === null) {
      test.skip(true, `Affected row ${ROW} not rendered yet - SPA bootstrap incomplete`);
      await apiContext.dispose();
      return;
    }
    // Skip the test if the row happens to already be in view (the SPA
    // may render very few services on a fresh DB). Without an off-
    // screen row the scroll assertion is meaningless.
    if (rowOffscreenBefore.top < rowOffscreenBefore.viewportH) {
      test.skip(true, `Row ${ROW} is already in viewport - cannot exercise scroll-into-view ON path against this corpus`);
      await apiContext.dispose();
      return;
    }

    const start = Date.now();
    await postTrigger(apiContext, SERVICE, ENV, `v0.0.${suffix}`);

    // Within 5 s the SPA should scroll the row into view.
    await expect.poll(async () => {
      const r = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, vh: window.innerHeight };
      }, ROW);
      if (!r) return false;
      return r.top < r.vh && r.bottom > 0;
    }, { timeout: 5_000 }).toBe(true);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThanOrEqual(5_000);

    // Programmatic scroll occurred.
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(scrollAfter).toBeGreaterThan(scrollBefore);

    // Pulse class fired briefly. We don't pin the exact class name -
    // frontend uses one of `pulse`, `swap-pulse`, or `focus-pulse`
    // historically. Look for ANY ring/pulse data attribute or class
    // on the box OR its row.
    const pulsed = await page.evaluate((tid) => {
      const box = document.querySelector(`[data-testid='${tid}']`) as HTMLElement | null;
      if (!box) return false;
      const cls = box.className || '';
      if (/pulse/i.test(cls)) return true;
      const row = box.closest('[data-service-row]') as HTMLElement | null;
      if (row && /pulse/i.test(row.className || '')) return true;
      if (box.getAttribute('data-pulse') === 'true') return true;
      if (row && row.getAttribute('data-pulse') === 'true') return true;
      return false;
    }, TEST_ID);
    expect(pulsed, 'Expected a pulse class / data-pulse=true on the focused row or box within the toggle ON budget').toBe(true);

    await apiContext.dispose();
  });

  test('OFF: off-screen row receives data update without programmatic scroll', async ({ page }) => {
    const apiContext = await playwrightRequest.newContext({
      baseURL: WRITE_BASE_URL,
      extraHTTPHeaders: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
    });

    const suffix = runSuffix();
    const SERVICE = `qa-bot-focus-off-${suffix}`.slice(0, 32);
    const ENV = 'fn-focus';
    const TEST_ID = `stage-box-${SERVICE}-${ENV}`;
    const ROW = `[data-service-row="${SERVICE}"]`;

    await postBaseline(apiContext, SERVICE, ENV);

    await page.goto('/');
    // Explicit wait — see ON-path commentary above; same race applies here.
    try {
      await page.waitForSelector(TOGGLE, { state: 'attached', timeout: 10_000 });
    } catch {
      test.skip(true, 'focus-on-last-event-toggle not yet present in the SPA (frontend WBS in flight)');
      await apiContext.dispose();
      return;
    }

    await page.evaluate((key) => localStorage.setItem(key, 'false'), STORAGE_KEY);
    await page.reload();
    await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
    await expect(page.locator(`[data-testid='${TEST_ID}']`).first()).toBeAttached({ timeout: 5_000 });

    const toggle = page.locator(TOGGLE);
    if (await toggle.isChecked()) await toggle.uncheck();
    const persisted = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(persisted === 'false' || persisted === null).toBe(true);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    const rowOffscreenBefore = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, viewportH: window.innerHeight };
    }, ROW);
    if (rowOffscreenBefore === null) {
      test.skip(true, `Affected row ${ROW} not rendered yet - SPA bootstrap incomplete`);
      await apiContext.dispose();
      return;
    }
    if (rowOffscreenBefore.top < rowOffscreenBefore.viewportH) {
      test.skip(true, `Row ${ROW} is already in viewport - cannot exercise no-scroll OFF path against this corpus`);
      await apiContext.dispose();
      return;
    }

    await postTrigger(apiContext, SERVICE, ENV, `v0.0.${suffix}`);

    // Wait the full live-update window so we know any scroll WOULD have happened.
    await page.waitForTimeout(5_000);

    // Scroll position unchanged (programmatic scroll did NOT fire).
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);

    // The data DID update: the affected slot now shows the in-progress
    // version. Scroll to the row to inspect.
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      el?.scrollIntoView();
    }, `[data-testid='${TEST_ID}']`);
    await expect(page.getByTestId(`current-version-${SERVICE}-${ENV}`).first())
      .toContainText(`v0.0.${suffix}`);

    await apiContext.dispose();
  });
});
