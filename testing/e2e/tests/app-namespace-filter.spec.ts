/**
 * Live-app E2E — Namespace/service composite filter (#353).
 *
 * Runs against the Angular SPA at http://localhost:4200 backed by the NestJS
 * mock on :3002.
 *
 * Mock data summary (demo/data/events.json):
 *   11 services with no namespace (auth-bff, billing-webhook, catalog-edge,
 *     data-pipeline, ledger-projector, metrics-exporter, notification-worker,
 *     order-svc, payments-api, platform-proxy, search-indexer)
 *   2 "gateway" entries under distinct namespaces (org-a, org-b)
 *   → 13 distinct (namespace, service) rows in total.
 *
 * The "gateway" service is the canonical collision example:
 *   - Both org-a/gateway AND org-b/gateway must appear as separate matrix rows.
 *   - When both are visible, each row-head shows "org-a/gateway" / "org-b/gateway"
 *     (render-on-collision rule).
 *   - When only one namespace is visible (the other filtered out) the label
 *     reverts to the bare "gateway" (no prefix needed — no collision).
 *
 * Filter semantics:
 *   - Slashed pattern (e.g. "org-a/gateway") matches only the org-a row.
 *   - Slashless pattern (e.g. "gateway") matches BOTH namespace rows across all
 *     namespaces — backward compatibility for existing saved patterns.
 *
 * localStorage keys:
 *   dd:svcPatterns  — JSON array of glob patterns
 *   dd:svcFilterMode — "exclude" | "include"
 *   dd:colOrder, dd:colHidden — cleared for clean state
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total distinct (namespace, service) rows in mock data. */
const TOTAL_ROWS = 13;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the matrix view with a clean slate.
 * Wipes all service-filter, column, and field state so each test starts
 * from the same baseline.
 */
async function openMatrixClean(page: Page): Promise<void> {
  await page.goto('/matrix');
  await page.waitForSelector('app-root', { timeout: 20_000 });

  await page.evaluate(() => {
    localStorage.removeItem('dd:svcPatterns');
    localStorage.removeItem('dd:svcFilterMode');
    localStorage.removeItem('dd:colOrder');
    localStorage.removeItem('dd:colHidden');
    localStorage.removeItem('dd:matFields');
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.row-head', { timeout: 20_000 });
  await page.waitForTimeout(400);
}

/**
 * Navigate to the swimlanes view with a clean slate.
 */
async function openSwimlanesClean(page: Page): Promise<void> {
  await page.goto('/swimlanes');
  await page.waitForSelector('app-root', { timeout: 20_000 });

  await page.evaluate(() => {
    localStorage.removeItem('dd:svcPatterns');
    localStorage.removeItem('dd:svcFilterMode');
    localStorage.removeItem('dd:swimCollapsed');
    localStorage.removeItem('dd:swimKnown');
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vis-card', { timeout: 30_000 });
  await page.waitForTimeout(2000);
}

/**
 * Apply a service filter via localStorage then reload.
 * Avoids interacting with the picker UI — keeps tests focused on rendering.
 */
async function applyFilter(
  page: Page,
  mode: 'include' | 'exclude',
  patterns: string[],
): Promise<void> {
  await page.evaluate(
    ({ m, p }: { m: string; p: string[] }) => {
      localStorage.setItem('dd:svcFilterMode', m);
      localStorage.setItem('dd:svcPatterns',   JSON.stringify(p));
    },
    { m: mode, p: patterns },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.row-head', { timeout: 20_000 });
  await page.waitForTimeout(400);
}

/** Return the text content of all `.row-head` elements. */
async function rowHeadTexts(page: Page): Promise<string[]> {
  return page
    .locator('.row-head')
    .allTextContents()
    .then((ts) => ts.map((t) => t.trim()).filter(Boolean));
}

// ---------------------------------------------------------------------------
// Tests: Matrix — row count & collision rendering
// ---------------------------------------------------------------------------

test.describe('Matrix — namespace collision rows', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('all 13 distinct (namespace, service) rows are rendered', async ({ page }) => {
    const heads = await rowHeadTexts(page);
    expect(heads.length).toBe(TOTAL_ROWS);
  });

  test('gateway appears as two separate row-heads with render-on-collision prefix', async ({ page }) => {
    const heads = await rowHeadTexts(page);
    expect(heads).toContain('org-a/gateway');
    expect(heads).toContain('org-b/gateway');
  });

  test('null-namespace rows render without a namespace prefix', async ({ page }) => {
    const heads = await rowHeadTexts(page);
    // All non-gateway rows have no namespace and must render as bare service names.
    const noNamespace = ['auth-bff', 'payments-api', 'order-svc'];
    for (const svc of noNamespace) {
      expect(heads).toContain(svc);
      expect(heads).not.toContain(`/${svc}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Matrix — slashed pattern filter (namespace/service)
// ---------------------------------------------------------------------------

test.describe('Matrix — slashed pattern filter (namespace/service)', () => {
  test('include org-a/gateway → only the org-a row is shown (not org-b)', async ({ page }) => {
    await openMatrixClean(page);
    await applyFilter(page, 'include', ['org-a/gateway']);

    const heads = await rowHeadTexts(page);
    // Only org-a/gateway visible; last-visible guard ensures at least 1 row.
    expect(heads.length).toBe(1);
    // With only 1 namespace visible the label reverts to bare service (no collision).
    expect(heads[0]).toBe('gateway');
  });

  test('include org-a/* → only org-a namespace rows shown', async ({ page }) => {
    await openMatrixClean(page);
    await applyFilter(page, 'include', ['org-a/*']);

    const heads = await rowHeadTexts(page);
    expect(heads.length).toBe(1);
    expect(heads[0]).toBe('gateway');
  });

  test('exclude org-a/gateway → org-b/gateway remains, no org-a', async ({ page }) => {
    await openMatrixClean(page);
    await applyFilter(page, 'exclude', ['org-a/gateway']);

    const heads = await rowHeadTexts(page);
    // org-a row excluded; org-b remains (and since only 1 namespace, label is bare).
    expect(heads).not.toContain('org-a/gateway');
    // org-b/gateway should still be present; with no collision the label is bare.
    expect(heads).toContain('gateway');
    // Total should be TOTAL_ROWS - 1 (org-a excluded).
    expect(heads.length).toBe(TOTAL_ROWS - 1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Matrix — slashless pattern filter (backward compat)
// ---------------------------------------------------------------------------

test.describe('Matrix — slashless pattern filter (backward compatibility)', () => {
  test('include gateway → both org-a and org-b rows shown (cross-namespace match)', async ({ page }) => {
    await openMatrixClean(page);
    await applyFilter(page, 'include', ['gateway']);

    const heads = await rowHeadTexts(page);
    // Both namespaced gateway rows should be visible.
    expect(heads.length).toBe(2);
    // With 2 distinct namespaces the labels use the namespace prefix.
    expect(heads).toContain('org-a/gateway');
    expect(heads).toContain('org-b/gateway');
  });

  test('exclude gateway → neither org-a nor org-b gateway row shown', async ({ page }) => {
    await openMatrixClean(page);
    await applyFilter(page, 'exclude', ['gateway']);

    const heads = await rowHeadTexts(page);
    expect(heads).not.toContain('org-a/gateway');
    expect(heads).not.toContain('org-b/gateway');
    expect(heads).not.toContain('gateway');
    // 11 null-namespace rows remain.
    expect(heads.length).toBe(11);
  });

  test('slashless pattern against null-namespace service still works', async ({ page }) => {
    await openMatrixClean(page);
    await applyFilter(page, 'include', ['payments-api']);

    const heads = await rowHeadTexts(page);
    expect(heads.length).toBe(1);
    expect(heads[0]).toBe('payments-api');
  });
});

// ---------------------------------------------------------------------------
// Tests: Matrix — render-on-collision label reverts when collision resolved
// ---------------------------------------------------------------------------

test.describe('Matrix — render-on-collision label revert', () => {
  test('single-namespace gateway: label is bare service (no prefix needed)', async ({ page }) => {
    await openMatrixClean(page);
    // Include only org-b to leave a single namespace — no collision.
    await applyFilter(page, 'include', ['org-b/gateway']);

    const heads = await rowHeadTexts(page);
    expect(heads.length).toBe(1);
    // No collision → label must be bare "gateway", NOT "org-b/gateway".
    expect(heads[0]).toBe('gateway');
  });
});

// ---------------------------------------------------------------------------
// Tests: Swimlanes — namespace lane labels
// ---------------------------------------------------------------------------

test.describe('Swimlanes — namespace collision lane labels', () => {
  test('gateway lanes render with namespace prefix when both namespaces visible', async ({ page }) => {
    await openSwimlanesClean(page);

    // There should be 2 lane elements for "gateway" (one per namespace).
    const gatewayLanes = page.locator('.lane[data-swim-service="gateway"]');
    await expect(gatewayLanes).toHaveCount(2);

    // Both lane labels should include the namespace prefix.
    const labels = await gatewayLanes
      .locator('.lane-svc')
      .allTextContents()
      .then((ts) => ts.map((t) => t.trim()));

    expect(labels).toContain('org-a/gateway');
    expect(labels).toContain('org-b/gateway');
  });

  test('null-namespace lanes render with bare service names', async ({ page }) => {
    await openSwimlanesClean(page);

    // Check a known null-namespace service.
    const payLane = page.locator('.lane[data-swim-service="payments-api"]');
    await expect(payLane).toHaveCount(1);

    const label = await payLane.locator('.lane-svc').textContent();
    expect(label?.trim()).toBe('payments-api');
  });
});
