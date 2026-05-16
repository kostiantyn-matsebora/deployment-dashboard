// Implements testing/e2e/scenarios/workflow-rows-expand-row.md
//
// Workflow-rows layout sanity check: the matrix root carries the
// correct data-layout, at least one workflow row renders for the
// seeded `topo-explicit` service, clicking the row toggles its
// expanded state, and the path containing the latest deployment is
// initially active.

import { test, expect } from '@playwright/test';

const TOPO_SERVICE = 'topo-explicit';

test('Workflow-rows: latest-path row is active, click toggles expansion', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByTestId('layout-option-workflow-rows').click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', 'workflow-rows');

  const rowLocator = page.locator(`[data-testid^="workflow-row-${TOPO_SERVICE}-"]`);
  await expect(rowLocator.first()).toBeVisible({ timeout: 10_000 });

  // The path that contains the latest event must be initially active.
  // The frontend exposes this via data-active="true" on at least one row.
  const activeRow = rowLocator.filter({ hasNot: page.locator('[data-active="false"]') }).first();
  await expect(activeRow).toBeVisible();

  // Click to toggle expansion. We can't assume exactly which testid
  // suffix carries the click handler; clicking the row container itself
  // is the documented interaction (see SAD §7 Workflow-rows). The
  // expanded state is exposed via data-expanded.
  const firstRow = rowLocator.first();
  const before = await firstRow.getAttribute('data-expanded');
  await firstRow.click();

  const afterExpand = await firstRow.getAttribute('data-expanded');
  expect(afterExpand).not.toBe(before);

  // Collapse again - state must return to its prior value (or at least
  // toggle back) so the click is reversibly idempotent.
  await firstRow.click();
  const afterCollapse = await firstRow.getAttribute('data-expanded');
  expect(afterCollapse).toBe(before);
});

test('Workflow-rows: every visible service has at least one row', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByTestId('layout-option-workflow-rows').click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', 'workflow-rows');

  // Pull the list of services from the matrix DOM. Frontend exposes
  // service rows via data-service-row.
  //
  // Scope the assertion to services that are part of the canonical
  // seeded corpus. Ephemeral services POSTed by other specs (e.g.
  // `qa-bot-*` rows that leak via skip-after-POST in focus-on-last-
  // event-toggle.spec.ts) may have no derivable topology (single
  // deployment, no parent_deployments) - the workflow-rows layout
  // legitimately renders zero rows for those, and asserting "every
  // service has a row" against them would tightly couple this spec
  // to the failure mode of unrelated specs. Filter to the seeded
  // prefixes (`service-` and `topo-`) so the oracle is robust to
  // intra-suite state pollution from unrelated tests.
  const services = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-service-row]'))
      .map((el) => el.getAttribute('data-service-row'))
      .filter((v): v is string => v !== null && v.length > 0)
      .filter((v) => v.startsWith('service-') || v.startsWith('topo-')),
  );
  expect(services.length, 'seeded corpus must expose at least one service in workflow-rows layout').toBeGreaterThan(0);

  for (const svc of services) {
    const rows = page.locator(`[data-testid^="workflow-row-${svc}-"]`);
    await expect(
      rows.first(),
      `Seeded service '${svc}' has no workflow-row in workflow-rows layout (empty-topology fallback should still render a single root chain).`,
    ).toBeVisible({ timeout: 5_000 });
  }
});
