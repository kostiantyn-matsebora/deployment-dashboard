/**
 * Mockup — Swimlanes (vis) View tests.
 *
 * Verifies: view activation, SVG lane labels, vis card rendering,
 * pre-selection, inspector content, node click → inspector update,
 * correlation picker, time-window enable/disable, fields picker in vis mode.
 *
 * Swimlane fixture: SWIM_SERVICES = ['payments-api', 'auth-bff', 'order-svc', 'catalog-edge']
 * Total VIS_NODES = 21 (5+6+5+5).
 * Pre-selected node: p4d5e6f7a8b9 (payments-api · preprod · in-progress · v2.14.3).
 */

import { test, expect } from '@playwright/test';
import { openMockup, switchToSwimlanes } from './helpers';

const SWIM_SERVICES = ['payments-api', 'auth-bff', 'order-svc', 'catalog-edge'] as const;
const PRESELECTED_NODE_ID = 'p4d5e6f7a8b9';
const VIS_NODE_COUNT = 21; // 5 payments-api + 6 auth-bff + 5 order-svc + 5 catalog-edge

test.describe('Mockup — Swimlanes View', () => {
  test.beforeEach(async ({ page }) => {
    await openMockup(page);
    await switchToSwimlanes(page);
  });

  // ── View activation ───────────────────────────────────────────────────────

  test('vis view section is active', async ({ page }) => {
    await expect(page.locator('#view-vis')).toHaveClass(/is-active/);
  });

  test('matrix view section is inactive', async ({ page }) => {
    await expect(page.locator('#view-matrix')).not.toHaveClass(/is-active/);
  });

  // ── SVG swim stage ────────────────────────────────────────────────────────

  test('#swim container is visible', async ({ page }) => {
    await expect(page.locator('#swim')).toBeVisible();
  });

  test('#vis-stage is rendered inside #swim', async ({ page }) => {
    await expect(page.locator('#vis-stage')).toBeVisible();
  });

  test('swim SVG edges element is present', async ({ page }) => {
    await expect(page.locator('#swim svg')).toBeVisible();
  });

  // ── Lane labels ───────────────────────────────────────────────────────────

  for (const svc of SWIM_SERVICES) {
    test(`lane label rendered: ${svc}`, async ({ page }) => {
      // Lane labels are SVG <text> elements directly inside #swim svg
      await expect(page.locator(`#swim text:text-is("${svc}")`)).toBeVisible();
    });
  }

  test('exactly 4 distinct service lane labels', async ({ page }) => {
    const counts = await Promise.all(
      SWIM_SERVICES.map((svc) => page.locator(`#swim text:text-is("${svc}")`).count()),
    );
    // Every service has exactly 1 lane label
    expect(counts.every((c) => c === 1)).toBe(true);
  });

  // ── Vis cards ─────────────────────────────────────────────────────────────

  test(`${VIS_NODE_COUNT} vis cards rendered in cards-layer`, async ({ page }) => {
    await expect(page.locator('#cards-layer .vis-card')).toHaveCount(VIS_NODE_COUNT);
  });

  test('each vis card has a data-node-id attribute', async ({ page }) => {
    const ids = await page
      .locator('#cards-layer .vis-card')
      .evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.nodeId));
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  // ── Pre-selection ─────────────────────────────────────────────────────────

  test('pre-selected node has is-selected class', async ({ page }) => {
    await expect(
      page.locator(`#cards-layer .vis-card[data-node-id="${PRESELECTED_NODE_ID}"]`),
    ).toHaveClass(/is-selected/);
  });

  test('pre-selected node has s-progress class (in-progress status)', async ({ page }) => {
    await expect(
      page.locator(`#cards-layer .vis-card[data-node-id="${PRESELECTED_NODE_ID}"]`),
    ).toHaveClass(/s-progress/);
  });

  test('only the pre-selected node has is-selected on load', async ({ page }) => {
    const selectedCount = await page.locator('#cards-layer .vis-card.is-selected').count();
    expect(selectedCount).toBe(1);
  });

  // ── Inspector panel ───────────────────────────────────────────────────────

  test('inspector crumbs show "payments-api · preprod" (pre-selected node)', async ({ page }) => {
    await expect(page.locator('#insp-crumbs')).toHaveText('payments-api · preprod');
  });

  test('inspector status chip shows in-progress', async ({ page }) => {
    await expect(page.locator('#insp-status-row .status-chip')).toContainText('in-progress');
  });

  test('inspector status chip has s-progress class', async ({ page }) => {
    await expect(page.locator('#insp-status-row .status-chip')).toHaveClass(/s-progress/);
  });

  test('inspector shows version v2.14.3 for pre-selected node', async ({ page }) => {
    await expect(page.locator('#insp-status-row')).toContainText('v2.14.3');
  });

  test('inspector grid renders all 11 domain-model field keys', async ({ page }) => {
    const KEYS = [
      'component', 'environment', 'version', 'status',
      'run_url', 'sha', 'run_number', 'ref', 'actor',
      'happened_at', 'parrent_deployments',
    ];
    for (const key of KEYS) {
      await expect(page.locator(`#insp-grid .k:text-is("${key}")`)).toBeVisible();
    }
  });

  test('inspector grid shows sha value for pre-selected node', async ({ page }) => {
    // p4d5e6f7a8b9: sha = '7d3e2a1'
    await expect(page.locator('#insp-grid')).toContainText('7d3e2a1');
  });

  test('inspector grid shows run number for pre-selected node', async ({ page }) => {
    // p4d5e6f7a8b9: run_number = 4821
    await expect(page.locator('#insp-grid')).toContainText('4821');
  });

  // ── Node click → inspector update ─────────────────────────────────────────

  test('clicking a vis card updates the inspector crumbs', async ({ page }) => {
    // a1f7c2b8e1d2 = auth-bff · dev · success
    await page.locator('.vis-card[data-node-id="a1f7c2b8e1d2"]').click();
    await expect(page.locator('#insp-crumbs')).toHaveText('auth-bff · dev');
  });

  test('clicking a vis card moves is-selected to the clicked card', async ({ page }) => {
    await page.locator('.vis-card[data-node-id="a1f7c2b8e1d2"]').click();
    await expect(page.locator('.vis-card[data-node-id="a1f7c2b8e1d2"]')).toHaveClass(
      /is-selected/,
    );
    await expect(
      page.locator(`.vis-card[data-node-id="${PRESELECTED_NODE_ID}"]`),
    ).not.toHaveClass(/is-selected/);
  });

  test('clicking a success node shows s-success chip in inspector', async ({ page }) => {
    // a1f7c2b8e1d2 = auth-bff · dev · success
    await page.locator('.vis-card[data-node-id="a1f7c2b8e1d2"]').click();
    await expect(page.locator('#insp-status-row .status-chip')).toHaveClass(/s-success/);
    await expect(page.locator('#insp-status-row .status-chip')).toContainText('success');
  });

  test('clicking a failure node shows s-failure chip in inspector', async ({ page }) => {
    // p3c4d5e6f7a8 = payments-api · qa · failure
    await page.locator('.vis-card[data-node-id="p3c4d5e6f7a8"]').click();
    await expect(page.locator('#insp-status-row .status-chip')).toHaveClass(/s-failure/);
    await expect(page.locator('#insp-status-row .status-chip')).toContainText('failure');
  });

  // ── Correlation picker ────────────────────────────────────────────────────

  test('correlation popover opens on button click', async ({ page }) => {
    await page.click('#btn-correlation');
    await expect(page.locator('#pop-correlation')).toHaveClass(/is-open/);
  });

  test('"explicit parent" predicate is active by default', async ({ page }) => {
    await page.click('#btn-correlation');
    await expect(page.locator('.predicate[data-p="parent"]')).toHaveClass(/is-on/);
  });

  test('other predicates are not active by default', async ({ page }) => {
    await page.click('#btn-correlation');
    for (const p of ['sha', 'run_number', 'actor', 'version']) {
      await expect(page.locator(`.predicate[data-p="${p}"]`)).not.toHaveClass(/is-on/);
    }
  });

  test('time window select is disabled when "explicit parent" is active', async ({ page }) => {
    await page.click('#btn-correlation');
    await expect(page.locator('#timewin-select')).toBeDisabled();
  });

  test('selecting "same sha" enables the time window select', async ({ page }) => {
    await page.click('#btn-correlation');
    await page.locator('.predicate[data-p="sha"]').click();
    await expect(page.locator('#timewin-select')).toBeEnabled();
  });

  test('selecting a non-parent predicate deactivates "explicit parent"', async ({ page }) => {
    await page.click('#btn-correlation');
    await page.locator('.predicate[data-p="actor"]').click();
    await expect(page.locator('.predicate[data-p="parent"]')).not.toHaveClass(/is-on/);
    await expect(page.locator('.predicate[data-p="actor"]')).toHaveClass(/is-on/);
  });

  test('correlation popover closes on Escape', async ({ page }) => {
    await page.click('#btn-correlation');
    await page.keyboard.press('Escape');
    await expect(page.locator('#pop-correlation')).not.toHaveClass(/is-open/);
  });

  // ── Fields picker in vis mode ─────────────────────────────────────────────

  test('fields picker opens and shows Swimlanes title', async ({ page }) => {
    await page.click('#btn-fields');
    await expect(page.locator('#pop-fields-title')).toHaveText('Visible fields — Swimlanes');
  });

  test('vis fields grid has 8 toggles (VIS_FIELDS)', async ({ page }) => {
    await page.click('#btn-fields');
    await expect(page.locator('#fields-grid-vis .field-toggle')).toHaveCount(8);
  });

  test('all vis field toggles are on by default (have is-on class)', async ({ page }) => {
    await page.click('#btn-fields');
    const count = await page.locator('#fields-grid-vis .field-toggle').count();
    const onCount = await page.locator('#fields-grid-vis .field-toggle.is-on').count();
    expect(onCount).toBe(count);
  });

  test('toggling off "version" removes .vc-ver from all vis cards', async ({ page }) => {
    await page.click('#btn-fields');
    await page.locator('#fields-grid-vis .field-toggle').filter({ hasText: /^version$/ }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.vis-card .vc-ver')).toHaveCount(0);
  });

  test('toggling "version" back on restores .vc-ver elements', async ({ page }) => {
    await page.click('#btn-fields');
    await page.locator('#fields-grid-vis .field-toggle').filter({ hasText: /^version$/ }).click();
    // toggle it back on
    await page.locator('#fields-grid-vis .field-toggle').filter({ hasText: /^version$/ }).click();
    await page.keyboard.press('Escape');
    const count = await page.locator('.vis-card .vc-ver').count();
    expect(count).toBeGreaterThan(0);
  });
});
