/**
 * Extension E2E — Toolbar badge (spec c)
 *
 * Spec: docs/EXTENSION_SPECIFICATION.md §4.1 Toolbar badge + §6 Badge reducer
 *
 * Coverage:
 *   c1) Badge reflects per-(service×environment)-slot failure seeded from GET /api/matrix.
 *   c2) Badge reflects in-progress slots from GET /api/matrix.
 *   c3) failure takes precedence over in-progress when both are present.
 *   c4) Disabling 'failure' in status filter removes the failure badge state.
 *   c5) Idle badge (no overlay text) when there are no in-progress/failure slots.
 *   c6) Badge count equals the number of matching slots, not number of events.
 *
 * The badge is set via browser.action.setBadgeText / setBadgeBackgroundColor in the
 * background service worker.  To observe it from Playwright we read the badge state
 * by evaluating a serviceWorker script (chrome.action.getBadgeText is not exposed to
 * content scripts, so we call it via the background sw context using page.evaluate on
 * a background page or via chrome.action inspected through a worker page).
 *
 * Implementation note: Playwright's extension support exposes service workers via
 * context.serviceWorkers().  We evaluate the badge text via a background-page trick:
 * open a chrome-extension URL page and inject a script that calls chrome.action.getBadgeText.
 */

import { extensionTest, expect, resetMock, postDeployment, MOCK_BASE } from './fixtures';
import { BrowserContext } from '@playwright/test';

/**
 * Reset mock and disable demo data so tests have a clean slate.
 */
async function cleanSlate(): Promise<void> {
  await resetMock();
  // Disable demo data so badge only reflects what we explicitly post.
  await fetch(`${MOCK_BASE}/_mock/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
}

/**
 * Read badge text by opening popup.html (an inert extension page with no save
 * side-effects) and evaluating chrome.action.getBadgeText from that context.
 * Avoids re-triggering the options-page init path on every badge read.
 *
 * chrome.action.getBadgeText is available to any extension page — not content
 * scripts.  popup.html is the lightest available extension page.
 *
 * Polls until the badge text matches the expected value or the timeout expires.
 */
async function getBadgeText(context: BrowserContext, extensionId: string): Promise<string> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // Wait for popup to be ready (any element from the popup shell).
  await page.waitForSelector('body', { timeout: 10_000 });

  const badgeText = await page.evaluate((): Promise<string> =>
    new Promise((resolve) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).chrome.action.getBadgeText({}, (text: string) => resolve(text ?? '')),
    ),
  );
  await page.close();
  return badgeText;
}

/**
 * Configure the extension URL via options page.
 * Used to trigger background SW to call GET /api/matrix.
 */
async function configure(context: BrowserContext, extensionId: string, url: string = MOCK_BASE): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('#input-url', { timeout: 15_000 });
  // Wait for the options-page init() to finish reading stored settings before
  // filling in the URL (replaces the previous waitForTimeout(300) latency-pad).
  await page.waitForFunction(
    () => (document.getElementById('input-url') as HTMLInputElement | null)?.value !== undefined,
    { timeout: 5_000 },
  );
  await page.fill('#input-url', url);
  await page.click('#btn-save');
  await page.waitForFunction(
    () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
    { timeout: 5_000 },
  );
  await page.close();
}

/**
 * Poll getBadgeText until it returns `expected` or the timeout elapses.
 * Replaces fixed 2 s sleeps; deterministically waits for the SW badge update.
 */
async function pollBadgeText(
  context: BrowserContext,
  extensionId: string,
  expected: string,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await getBadgeText(context, extensionId);
    if (last === expected) return last;
    await new Promise<void>((r) => setTimeout(r, 300));
  }
  return last; // let the test assertion produce the failure message
}

/**
 * Re-enable all status checkboxes via the options page.
 * Called at the start of tests that follow c4 (which disables failure status),
 * preventing leaked settings from corrupting later tests in the shared context.
 */
async function resetStatusFilter(context: BrowserContext, extensionId: string): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('#input-url', { timeout: 15_000 });
  await page.waitForFunction(
    () => (document.getElementById('input-url') as HTMLInputElement | null)?.value !== undefined,
    { timeout: 5_000 },
  );
  await page.waitForSelector('#statuses-list .checklist-item', { timeout: 10_000 });
  // Re-check every status checkbox that is currently unchecked.
  const cbs = page.locator('#statuses-list input[type="checkbox"]');
  const count = await cbs.count();
  for (let i = 0; i < count; i++) {
    const cb = cbs.nth(i);
    if (!(await cb.isChecked())) await cb.check();
  }
  await page.click('#btn-save');
  await page.waitForFunction(
    () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
    { timeout: 5_000 },
  );
  await page.close();
}

// ── c1) Failure badge from matrix ─────────────────────────────────────────────

extensionTest.describe('Badge — failure slots seeded from /api/matrix', () => {

  extensionTest('badge text is "1" when exactly one failure slot exists in matrix', async ({ context, extensionId }) => {
    await cleanSlate();

    // Post a failure event so the matrix has exactly one failure slot.
    await postDeployment({
      deployment_id: 'dep-badge-fail',
      service: 'badge-svc',
      environment: 'prod',
      status: 'failure',
      happened_at: new Date().toISOString(),
    });

    await configure(context, extensionId);

    // Poll until the background SW fetches /api/matrix and sets the badge.
    const text = await pollBadgeText(context, extensionId, '1');
    // Badge text should be "1" (one failure slot).
    expect(text).toBe('1');
  });

});

// ── c2) In-progress badge from matrix ────────────────────────────────────────

extensionTest.describe('Badge — in-progress slots seeded from /api/matrix', () => {

  extensionTest('badge text is "1" when exactly one in-progress slot exists', async ({ context, extensionId }) => {
    await cleanSlate();

    await postDeployment({
      deployment_id: 'dep-badge-inprog',
      service: 'badge-inprog-svc',
      environment: 'staging',
      status: 'in-progress',
      happened_at: new Date().toISOString(),
    });

    await configure(context, extensionId);

    // Poll until the background SW processes the matrix and sets the badge.
    const text = await pollBadgeText(context, extensionId, '1');
    expect(text).toBe('1');
  });

});

// ── c3) Failure takes precedence over in-progress ────────────────────────────

extensionTest.describe('Badge — failure takes precedence over in-progress', () => {

  extensionTest('when both failure and in-progress slots exist, badge shows failure count', async ({ context, extensionId }) => {
    await cleanSlate();

    await postDeployment({
      deployment_id: 'dep-badge-fail2',
      service: 'badge-fail-svc',
      environment: 'prod',
      status: 'failure',
      happened_at: new Date().toISOString(),
    });
    await postDeployment({
      deployment_id: 'dep-badge-inprog2',
      service: 'badge-inprog-svc2',
      environment: 'staging',
      status: 'in-progress',
      happened_at: new Date().toISOString(),
    });

    await configure(context, extensionId);

    // Poll until the background SW processes the matrix; failure must win.
    const text = await pollBadgeText(context, extensionId, '1');
    // failure takes precedence — count = number of failure slots = 1
    expect(text).toBe('1');
  });

});

// ── c4) Status filter gates badge ────────────────────────────────────────────

extensionTest.describe('Badge — status filter gates badge state', () => {

  extensionTest('disabling failure status removes the badge when only failure slots exist', async ({ context, extensionId }) => {
    await cleanSlate();

    await postDeployment({
      deployment_id: 'dep-badge-filter',
      service: 'badge-filter-svc',
      environment: 'prod',
      status: 'failure',
      happened_at: new Date().toISOString(),
    });

    // Configure with failure status disabled.
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForFunction(
      () => (document.getElementById('input-url') as HTMLInputElement | null)?.value !== undefined,
      { timeout: 5_000 },
    );
    await opts.fill('#input-url', MOCK_BASE);
    await opts.waitForSelector('#statuses-list .checklist-item', { timeout: 10_000 });
    await opts.uncheck('#status-failure');
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    // Poll until the badge reflects the disabled-failure state (should be empty).
    const text = await pollBadgeText(context, extensionId, '');
    // With failure disabled, the badge should be empty (idle state).
    expect(text).toBe('');
  });

});

// ── c5) Idle badge when no failure/in-progress ───────────────────────────────

extensionTest.describe('Badge — idle when no in-progress/failure slots', () => {

  extensionTest('badge is empty when all slots are success', async ({ context, extensionId }) => {
    // c4 disabled failure status in the shared persistent context — reset it first
    // so prior-test stored settings cannot corrupt this test's badge expectations.
    await resetStatusFilter(context, extensionId);
    await cleanSlate();

    await postDeployment({
      deployment_id: 'dep-badge-success',
      service: 'badge-success-svc',
      environment: 'staging',
      status: 'success',
      happened_at: new Date().toISOString(),
    });

    await configure(context, extensionId);

    // Poll until the badge settles to empty (no failure/in-progress slots).
    const text = await pollBadgeText(context, extensionId, '');
    expect(text).toBe('');
  });

});

// ── c6) Badge count = number of matching slots ────────────────────────────────

extensionTest.describe('Badge — count equals number of matching slots', () => {

  extensionTest('badge count equals the number of failure slots across services', async ({ context, extensionId }) => {
    // c4 disabled failure status in the shared persistent context — reset it first
    // so the failure events we post are counted rather than filtered.
    await resetStatusFilter(context, extensionId);
    await cleanSlate();

    // Create 3 failure events across different service×environment slots.
    await postDeployment({
      deployment_id: 'dep-count-a',
      service: 'svc-a',
      environment: 'prod',
      status: 'failure',
      happened_at: new Date().toISOString(),
    });
    await postDeployment({
      deployment_id: 'dep-count-b',
      service: 'svc-b',
      environment: 'prod',
      status: 'failure',
      happened_at: new Date().toISOString(),
    });
    await postDeployment({
      deployment_id: 'dep-count-c',
      service: 'svc-c',
      environment: 'staging',
      status: 'failure',
      happened_at: new Date().toISOString(),
    });

    await configure(context, extensionId);

    // Poll until the badge reflects all three failure slots.
    const text = await pollBadgeText(context, extensionId, '3');
    // Three distinct service×environment failure slots.
    expect(text).toBe('3');
  });

});
