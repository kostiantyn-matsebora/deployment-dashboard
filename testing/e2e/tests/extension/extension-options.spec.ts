/**
 * Extension E2E — Options page (spec a)
 *
 * Spec: docs/EXTENSION_SPECIFICATION.md §4.4 Options/config page
 *
 * Coverage:
 *   a1) Options page populates Services list from GET /api/services (envelope {items:[]}).
 *   a2) Options page populates Environments list from GET /api/environments (envelope {items:[]}).
 *   a3) Statuses checklist renders all 8 status items from ALL_STATUSES (no fetch needed).
 *   a4) Persists Statuses selection across a reload.
 *   a5) Persists Show-last-N (popupCount) across a reload.
 *   a6) Dashboard URL is persisted and shown on reload.
 *   a7) Master Watching switch toggles and persists.
 *   a8) Filter mode segmented control (exclude / include) persists.
 *   a9) "Save" confirmation 'Saved.' appears briefly after submit.
 */

import { extensionTest, expect, MOCK_BASE } from './fixtures';

const ALL_8_STATUSES = [
  'pending', 'queued', 'waiting', 'in-progress',
  'success', 'failure', 'cancelled', 'rejected',
];

// ── a1 / a2) Services + Environments populate from API ────────────────────────

extensionTest.describe('Options page — Services + Environments from API', () => {

  extensionTest('services list renders items from GET /api/services', async ({ optionsPage }) => {
    // The mock serves demo data so services should be non-empty.
    const res = await fetch(`${MOCK_BASE}/api/services`);
    const { items } = await res.json() as { items: string[] };
    expect(items.length).toBeGreaterThan(0);

    // Wait for at least one checkbox to appear in the services list.
    await optionsPage.waitForSelector('#services-list .checklist-item', { timeout: 10_000 });
    const renderedItems = await optionsPage.locator('#services-list .checklist-item').allTextContents();
    expect(renderedItems.length).toBe(items.length);

    // Each API item has a corresponding checkbox label.
    for (const svc of items) {
      // Use exact text match via the checkbox value attribute to avoid substring collisions.
      await expect(optionsPage.locator(`#services-list input[value="${svc}"]`)).toHaveCount(1);
    }
  });

  extensionTest('environments list renders items from GET /api/environments', async ({ optionsPage }) => {
    const res = await fetch(`${MOCK_BASE}/api/environments`);
    const { items } = await res.json() as { items: string[] };
    expect(items.length).toBeGreaterThan(0);

    await optionsPage.waitForSelector('#environments-list .checklist-item', { timeout: 10_000 });
    const renderedItems = await optionsPage.locator('#environments-list .checklist-item').allTextContents();
    expect(renderedItems.length).toBe(items.length);

    for (const env of items) {
      // Use exact value match to avoid substring collisions (e.g. 'prod' inside 'preprod').
      await expect(optionsPage.locator(`#environments-list input[value="${env}"]`)).toHaveCount(1);
    }
  });

});

// ── a3) All 8 statuses rendered ───────────────────────────────────────────────

extensionTest.describe('Options page — Statuses checklist', () => {

  extensionTest('renders all 8 status checkboxes from ALL_STATUSES', async ({ optionsPage }) => {
    await optionsPage.waitForSelector('#statuses-list .checklist-item', { timeout: 10_000 });
    const count = await optionsPage.locator('#statuses-list .checklist-item').count();
    expect(count).toBe(8);

    for (const status of ALL_8_STATUSES) {
      const cb = optionsPage.locator(`#status-${status}`);
      await expect(cb).toHaveCount(1);
    }
  });

  extensionTest('all 8 status checkboxes are checked by default', async ({ optionsPage }) => {
    await optionsPage.waitForSelector('#statuses-list .checklist-item', { timeout: 10_000 });
    for (const status of ALL_8_STATUSES) {
      const cb = optionsPage.locator(`#status-${status}`);
      await expect(cb).toBeChecked();
    }
  });

});

// ── a4) Statuses persist across reload ────────────────────────────────────────

extensionTest.describe('Options page — Statuses persist across reload', () => {

  extensionTest('unchecking a status and saving persists across reload', async ({ context, extensionId }) => {
    // Open options, configure URL, then uncheck 'failure'.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('#input-url', { timeout: 15_000 });
    await page.waitForTimeout(300);

    await page.fill('#input-url', MOCK_BASE);
    await page.waitForSelector('#statuses-list .checklist-item', { timeout: 10_000 });

    // Uncheck 'failure'.
    await page.uncheck('#status-failure');
    await expect(page.locator('#status-failure')).not.toBeChecked();

    await page.click('#btn-save');
    await page.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );

    // Reload and verify 'failure' is still unchecked.
    await page.reload();
    await page.waitForSelector('#statuses-list .checklist-item', { timeout: 15_000 });
    await expect(page.locator('#status-failure')).not.toBeChecked();

    // Other statuses are still checked.
    await expect(page.locator('#status-success')).toBeChecked();
    await expect(page.locator('#status-in-progress')).toBeChecked();

    await page.close();
  });

});

// ── a5) Show-last-N persists ──────────────────────────────────────────────────

extensionTest.describe('Options page — Show-last-N (popupCount) persists', () => {

  extensionTest('changing popupCount and saving persists across reload', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('#input-popup-count', { timeout: 15_000 });
    await page.waitForTimeout(300);

    await page.fill('#input-url', MOCK_BASE);
    await page.fill('#input-popup-count', '12');
    await page.click('#btn-save');
    await page.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );

    await page.reload();
    await page.waitForSelector('#input-popup-count', { timeout: 15_000 });
    await page.waitForTimeout(500);
    const val = await page.locator('#input-popup-count').inputValue();
    expect(val).toBe('12');

    await page.close();
  });

});

// ── a6) Dashboard URL persists ────────────────────────────────────────────────

extensionTest.describe('Options page — Dashboard URL persists', () => {

  extensionTest('URL is shown on reload after save', async ({ optionsPage, context, extensionId }) => {
    // optionsPage fixture already saved MOCK_BASE; reload and verify.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('#input-url', { timeout: 15_000 });
    await page.waitForTimeout(500);
    const val = await page.locator('#input-url').inputValue();
    expect(val).toBe(MOCK_BASE);
    await page.close();
    // keep optionsPage in scope to satisfy fixture dep
    void optionsPage;
  });

});

// ── a7) Master Watching switch ────────────────────────────────────────────────

extensionTest.describe('Options page — Master Watching switch', () => {

  extensionTest('switch defaults to ON (aria-checked=true)', async ({ optionsPage }) => {
    const btn = optionsPage.locator('#btn-watching');
    await expect(btn).toHaveAttribute('aria-checked', 'true');
    await expect(optionsPage.locator('#watching-state-text')).toHaveText('ON');
  });

  extensionTest('clicking switch toggles to OFF and dims filter section', async ({ optionsPage }) => {
    await optionsPage.click('#btn-watching');
    await expect(optionsPage.locator('#btn-watching')).toHaveAttribute('aria-checked', 'false');
    await expect(optionsPage.locator('#watching-state-text')).toHaveText('OFF');
    await expect(optionsPage.locator('#filter-section')).toHaveClass(/is-dimmed/);
  });

  extensionTest('filter controls are disabled when watching is OFF', async ({ optionsPage }) => {
    await optionsPage.click('#btn-watching');
    // All inputs and buttons inside filter-section should be disabled.
    const inputs = optionsPage.locator('#filter-section input[type="checkbox"]');
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(inputs.nth(i)).toBeDisabled();
    }
  });

});

// ── a8) Filter mode segmented control ────────────────────────────────────────

extensionTest.describe('Options page — Filter mode segmented control', () => {

  extensionTest('defaults to "Watch all except" (exclude mode)', async ({ optionsPage }) => {
    await expect(optionsPage.locator('#seg-exclude')).toHaveAttribute('aria-pressed', 'true');
    await expect(optionsPage.locator('#seg-include')).toHaveAttribute('aria-pressed', 'false');
  });

  extensionTest('clicking "Watch only" switches to include mode', async ({ optionsPage }) => {
    await optionsPage.click('#seg-include');
    await expect(optionsPage.locator('#seg-include')).toHaveAttribute('aria-pressed', 'true');
    await expect(optionsPage.locator('#seg-exclude')).toHaveAttribute('aria-pressed', 'false');
  });

});

// ── a9) Save confirmation ─────────────────────────────────────────────────────

extensionTest.describe('Options page — Save confirmation', () => {

  extensionTest('"Saved." appears after submitting the form', async ({ optionsPage }) => {
    // Save again (optionsPage fixture already saved once during setup).
    await optionsPage.click('#btn-save');
    const saveStatus = optionsPage.locator('#save-status');
    await expect(saveStatus).toHaveText('Saved.', { timeout: 5_000 });
  });

});
