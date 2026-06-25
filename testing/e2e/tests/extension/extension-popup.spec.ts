/**
 * Extension E2E — Popup panel (spec b)
 *
 * Spec: docs/EXTENSION_SPECIFICATION.md §4.2 Deployment list popup
 *
 * Coverage:
 *   b1) Popup renders the last-N in-scope event list from GET /api/deployments.
 *   b2) State panels are MUTUALLY EXCLUSIVE — exactly one of #state-loading /
 *       #state-unconfigured / #state-paused / #state-empty / #state-list is
 *       visible at any time (the real bug: no pile-up).
 *   b3) #state-unconfigured shown when no dashboardUrl is set.
 *   b4) #state-paused shown when watching is OFF.
 *   b5) #state-empty shown when no events match filters.
 *   b6) #state-list shown when ≥1 matching event exists; rows include service,
 *       environment, status chip, and run link.
 *   b7) "Open dashboard" footer link is shown when a URL is configured.
 *   b8) Events are filtered by status setting (disabled status excluded from list).
 *   b9) popupCount limits the number of rows shown.
 */

import { extensionTest, expect, resetMock, postDeployment, MOCK_BASE } from './fixtures';

const ALL_STATE_PANELS = [
  '#state-loading',
  '#state-unconfigured',
  '#state-paused',
  '#state-empty',
  '#state-list',
];

/**
 * Assert that exactly one state panel is visible (CSS visibility) and all others are
 * hidden.  Uses Playwright's toBeVisible() / toBeHidden() which check computed style
 * (display, visibility, opacity, etc.) rather than the HTML `hidden` attribute.
 * This catches attribute-based hiding, class-based hiding, AND CSS-based hiding,
 * so it would have caught the original pile-up bug regardless of implementation.
 */
async function assertExactlyOneStatePanel(
  page: import('@playwright/test').Page,
  expectedVisible: string,
): Promise<void> {
  for (const panelId of ALL_STATE_PANELS) {
    const el = page.locator(panelId);
    if (panelId === expectedVisible) {
      // Active panel must be visible in the CSS/computed-style sense.
      await expect(el).toBeVisible({ timeout: 5_000 });
    } else {
      // Inactive panels must be hidden (display:none / visibility:hidden / etc.)
      // OR absent from the DOM altogether.
      const count = await el.count();
      if (count > 0) {
        await expect(el).toBeHidden({ timeout: 5_000 });
      }
    }
  }
}

// ── b2/b3) Unconfigured state ─────────────────────────────────────────────────

extensionTest.describe('Popup — Unconfigured state (#state-unconfigured)', () => {

  extensionTest('shows #state-unconfigured when no dashboardUrl is set', async ({ context, extensionId }) => {
    // Open popup WITHOUT going through the options-page fixture (so no URL is set).
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForTimeout(800);

    await assertExactlyOneStatePanel(page, '#state-unconfigured');
    await expect(page.locator('#state-unconfigured')).not.toHaveAttribute('hidden');
    await page.close();
  });

});

// ── b2/b4) Paused state ────────────────────────────────────────────────────────

extensionTest.describe('Popup — Paused state (#state-paused)', () => {

  extensionTest('shows #state-paused when watching is OFF', async ({ context, extensionId }) => {
    // Configure URL via options page, then turn off watching.
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForTimeout(300);
    await opts.fill('#input-url', MOCK_BASE);
    // Turn off watching.
    await opts.click('#btn-watching');
    await expect(opts.locator('#btn-watching')).toHaveAttribute('aria-checked', 'false');
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    // Open popup.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(800);

    await assertExactlyOneStatePanel(popup, '#state-paused');
    await popup.close();
  });

});

// ── b2/b5) Empty state ────────────────────────────────────────────────────────

extensionTest.describe('Popup — Empty state (#state-empty)', () => {

  extensionTest('shows #state-empty when no events match filters', async ({ context, extensionId }) => {
    // Reset the mock store so there are no events, then configure URL.
    await resetMock();

    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForTimeout(300);
    await opts.fill('#input-url', MOCK_BASE);
    // Disable all statuses so no event can match.
    // First wait for statuses list to render.
    await opts.waitForSelector('#statuses-list .checklist-item', { timeout: 10_000 });
    // Uncheck all status checkboxes.
    const cbs = opts.locator('#statuses-list input[type="checkbox"]');
    const count = await cbs.count();
    for (let i = 0; i < count; i++) {
      const cb = cbs.nth(i);
      if (await cb.isChecked()) await cb.uncheck();
    }
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(1_000);

    await assertExactlyOneStatePanel(popup, '#state-empty');
    await popup.close();
  });

});

// ── b2/b6) List state + row content ───────────────────────────────────────────

extensionTest.describe('Popup — List state (#state-list)', () => {

  extensionTest('shows #state-list when events exist and match filters', async ({ context, extensionId }) => {
    // Explicitly enable demo data so this test does not depend on the mock's default
    // state (which may have been mutated by a prior test file in the serial run).
    await fetch(`${MOCK_BASE}/_mock/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForTimeout(300);
    await opts.fill('#input-url', MOCK_BASE);
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(1_000);

    // The mock serves demo data — at least one event should exist.
    await assertExactlyOneStatePanel(popup, '#state-list');
    await popup.close();
  });

  extensionTest('each event row has service name, environment, status chip, and time', async ({ context, extensionId }) => {
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForTimeout(300);
    await opts.fill('#input-url', MOCK_BASE);
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(1_000);

    const rows = popup.locator('#state-list .event-row');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Check the first row has expected sub-elements.
    const firstRow = rows.first();
    // Status chip
    await expect(firstRow.locator('.status-chip')).toHaveCount(1);
    const chipText = await firstRow.locator('.status-chip').textContent();
    expect(chipText?.trim().length).toBeGreaterThan(0);
    // Service name
    await expect(firstRow.locator('.service-name')).toHaveCount(1);
    // Meta row (environment · version)
    await expect(firstRow.locator('.row-meta')).toHaveCount(1);
    // Time row
    await expect(firstRow.locator('.row-time')).toHaveCount(1);

    await popup.close();
  });

  extensionTest('run link "Open run #NNN" appears when run_url is present', async ({ context, extensionId }) => {
    await resetMock();

    // Post an event with a run_url.
    await postDeployment({
      deployment_id: 'dep-run-link-test',
      service: 'run-link-svc',
      environment: 'staging',
      status: 'success',
      happened_at: new Date().toISOString(),
      version: '1.0.0',
      run_url: 'https://github.com/example/repo/actions/runs/999',
      run_number: '999',
    });

    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForTimeout(300);
    await opts.fill('#input-url', MOCK_BASE);
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(1_000);

    // Find the event row for our service and check the run link.
    const row = popup.locator('#state-list .event-row').filter({ hasText: 'run-link-svc' }).first();
    await expect(row).toHaveCount(1, { timeout: 5_000 });
    const link = row.locator('.hist-link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(/Open run #999/);

    await popup.close();
  });

});

// ── b7) "Open dashboard" link ─────────────────────────────────────────────────

extensionTest.describe('Popup — Open dashboard link', () => {

  extensionTest('"Open dashboard" footer link is shown when dashboardUrl is configured', async ({ popupPage }) => {
    // popupPage fixture already configured URL via optionsPage.
    const link = popupPage.locator('#footer-dashboard-link');
    await expect(link).not.toHaveAttribute('hidden');
    await expect(link).toHaveAttribute('href', MOCK_BASE);
  });

  extensionTest('"Open dashboard" link is NOT shown when no URL is configured', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(800);
    const link = popup.locator('#footer-dashboard-link');
    await expect(link).toHaveAttribute('hidden', '');
    await popup.close();
  });

});

// ── b8) Status filter gates popup list ────────────────────────────────────────

extensionTest.describe('Popup — Status filter gates list', () => {

  extensionTest('event with disabled status is excluded from popup list', async ({ context, extensionId }) => {
    await resetMock();

    // Disable demo data so only our posted events exist.
    await fetch(`${MOCK_BASE}/_mock/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    // Post only a 'failure' event.
    await postDeployment({
      deployment_id: 'dep-filter-test',
      service: 'filter-test-svc',
      environment: 'dev',
      status: 'failure',
      happened_at: new Date().toISOString(),
    });

    // Configure: URL set, disable 'failure' status (the only status present).
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForTimeout(300);
    await opts.fill('#input-url', MOCK_BASE);
    await opts.waitForSelector('#statuses-list .checklist-item', { timeout: 10_000 });
    await opts.uncheck('#status-failure');
    // Ensure at least 'success' is checked so not all statuses are disabled.
    await expect(opts.locator('#status-success')).toBeChecked();
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(1_000);

    // With only a 'failure' event posted (no demo data) and failure disabled → empty state.
    await assertExactlyOneStatePanel(popup, '#state-empty');
    await popup.close();
  });

});

// ── b9) popupCount limits rows ────────────────────────────────────────────────

extensionTest.describe('Popup — popupCount limits rows', () => {

  extensionTest('popup shows at most popupCount rows', async ({ context, extensionId }) => {
    await resetMock();

    // Explicitly enable demo data so this test does not depend on the mock's default
    // state (which may have been mutated by a prior test file in the serial run).
    await fetch(`${MOCK_BASE}/_mock/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    // Post 8 events.
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      await postDeployment({
        deployment_id: `dep-count-${i}`,
        service: `count-svc`,
        environment: 'staging',
        status: 'success',
        happened_at: new Date(now - i * 1000).toISOString(),
        version: `1.0.${i}`,
      });
    }

    // Set popupCount to 3.
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForTimeout(300);
    await opts.fill('#input-url', MOCK_BASE);
    await opts.fill('#input-popup-count', '3');
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForTimeout(1_000);

    await assertExactlyOneStatePanel(popup, '#state-list');
    const rows = popup.locator('#state-list .event-row');
    const rowCount = await rows.count();
    expect(rowCount).toBeLessThanOrEqual(3);

    await popup.close();
  });

});
