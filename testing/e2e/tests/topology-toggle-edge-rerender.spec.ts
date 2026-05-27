// Implements testing/e2e/scenarios/topology-toggle-edge-rerender.md
//
// Regression gate for issue #83 P1 regression: the ngx-graph port of
// swim-lane-detailed copied the mockup's static DAG-builder call and
// stopped using DeploymentMatrixStore.topologyFor() reactively. Changing
// the topology-picker (correlationAttribute) would re-fetch the matrix
// but the layout component would not re-derive the DAG from the new
// topology payload, leaving stale edges in the DOM.
//
// This spec asserts the DOM-level consequence: the swim-lane layout
// re-derives and re-renders edges when the topology changes. We verify
// this by:
//   1. Confirming edge paths exist for the seeded `topo-explicit` service
//      in the default correlationAttribute.
//   2. Switching the topology picker to a different correlationAttribute.
//   3. Asserting a new matrix GET fires (existing topology-picker spec
//      contract) AND that the swim-lane still renders edge paths for
//      the `topo-explicit` service after the GET completes (no stale /
//      cleared edge state).
//
// We do NOT assert the exact count or geometry of edges changes (that
// depends on backend topology derivation which differs per correlationAttr
// and per fixture seed). What we DO assert is that the swim-lane layout
// component survived the topology refresh without losing all its edges —
// the regression left the SVG empty.
//
// The spec also guards workflow-rows: the CSS arrow-line connectors must
// still be present after a correlationAttribute switch.
//
// Citations:
//   - docs/architecture.md §4 FR-13 — topology derivation + edge rendering
//   - docs/architecture.md §7 "SSE topology semantics" — matrix GET refresh
//     on every event (and on correlationAttribute change).
//   - testing/e2e/scenarios/swim-lane-connectors.md — geometry oracle for
//     the `topo-explicit` service used as the fixture anchor here.
//   - testing/e2e/scenarios/topology-picker-ref-sha-query-param.md —
//     companion spec for the localStorage + network layer; this spec is the
//     DOM-rendering companion.

import { test, expect, type Page, type Request } from '@playwright/test';

const TOPO_SERVICE = 'topo-explicit';
const STORAGE_KEY = 'dashboard.correlationAttribute';

const PICKER = '[data-testid="topology-picker-button"]';
const OPTION_LABEL = (attr: string) => `label:has([data-testid="topology-option-${attr}"])`;

async function countSvgEdgePaths(page: Page, serviceId: string): Promise<number> {
  return page.evaluate((svc: string) => {
    const row = document.querySelector(`[data-service-row="${svc}"]`);
    if (!row) return 0;
    return row.querySelectorAll('svg.edge-overlay path.edge').length;
  }, serviceId);
}

async function countCssArrowLines(page: Page, serviceId: string): Promise<number> {
  return page.evaluate((svc: string) => {
    // workflow-rows: arrow-line elements nested inside rows for this service.
    const rows = Array.from(document.querySelectorAll(`[data-testid^="workflow-row-${svc}-"]`));
    return rows.reduce((n, row) => n + row.querySelectorAll('.arrow-line').length, 0);
  }, serviceId);
}

test.describe('Topology toggle — edge DOM survives correlationAttribute switch', () => {
  test('Swim-lane: SVG edge paths remain after topology-picker switch', async ({ page }) => {
    const matrixRequests: Request[] = [];
    page.on('request', req => {
      if (
        req.method().toUpperCase() === 'GET' &&
        req.url().includes('/api/deployments') &&
        !req.url().includes('/history')
      ) {
        matrixRequests.push(req);
      }
    });

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
    await page.reload();

    // Select swim-lane layout.
    await page.getByTestId('layout-option-swim-lane').click();
    await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', 'swim-lane');

    // Wait for topo-explicit row to be present and SVG edges to materialise.
    await page.waitForSelector(`[data-service-row="${TOPO_SERVICE}"]`, { timeout: 10_000 });
    // Poll for at least one edge path in the SVG overlay — the layout
    // component computes edges asynchronously via afterEveryRender.
    await expect.poll(
      async () => {
        const n = await page.evaluate((svc: string) => {
          const row = document.querySelector(`[data-service-row="${svc}"]`);
          if (!row) return 0;
          return row.querySelectorAll('svg.edge-overlay path.edge').length;
        }, TOPO_SERVICE);
        return n;
      },
      { timeout: 8_000, message: `Expected SVG edge paths for '${TOPO_SERVICE}' in swim-lane layout before topology-picker switch` },
    ).toBeGreaterThan(0);

    const edgesBefore = await countSvgEdgePaths(page, TOPO_SERVICE);
    expect(
      edgesBefore,
      `Pre-condition: topo-explicit must have at least one SVG edge path in swim-lane`,
    ).toBeGreaterThan(0);

    // Check topology-picker exists. Skip gracefully if not yet in the SPA.
    const picker = page.locator(PICKER);
    if ((await picker.count()) === 0) {
      test.skip(true, 'topology-picker-button not present in SPA — topology-toggle-edge-rerender spec skipped (frontend WBS 3.2.5)');
      return;
    }

    const matrixCountBefore = matrixRequests.length;

    // Switch correlationAttribute to 'ref'.
    await picker.click();
    await page.locator(OPTION_LABEL('ref')).click();

    // Wait for a new matrix GET (the picker triggers a fresh fetch).
    await expect.poll(() => matrixRequests.length, { timeout: 5_000 }).toBeGreaterThan(matrixCountBefore);
    const lastReq = matrixRequests[matrixRequests.length - 1];
    expect(lastReq.url()).toMatch(/[?&]correlationAttribute=ref(?:&|$)/);

    // Allow the layout to re-settle (afterEveryRender + rAF cycle).
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    // Core assertion: edge paths must still exist after the topology refresh.
    // The regression (commit 284461e) cleared all edges when the component
    // re-mounted with static data from the mockup instead of consuming the
    // store reactively.
    const edgesAfter = await countSvgEdgePaths(page, TOPO_SERVICE);
    expect(
      edgesAfter,
      `Swim-lane edge paths for '${TOPO_SERVICE}' must persist (> 0) after correlationAttribute switch. ` +
        `Before: ${edgesBefore}, After: ${edgesAfter}. ` +
        `If this is 0 the layout component is NOT consuming store.topologyFor() reactively.`,
    ).toBeGreaterThan(0);
  });

  test('Workflow-rows: CSS arrow-line connectors remain after topology-picker switch', async ({ page }) => {
    const matrixRequests: Request[] = [];
    page.on('request', req => {
      if (
        req.method().toUpperCase() === 'GET' &&
        req.url().includes('/api/deployments') &&
        !req.url().includes('/history')
      ) {
        matrixRequests.push(req);
      }
    });

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
    await page.reload();

    // Select workflow-rows layout.
    await page.getByTestId('layout-option-workflow-rows').click();
    await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', 'workflow-rows');

    // Wait for topo-explicit rows to be present.
    await page.waitForSelector(`[data-testid^="workflow-row-${TOPO_SERVICE}-"]`, { timeout: 10_000 });

    // Wait for CSS arrow lines to appear. topo-explicit has a multi-env path
    // so at least one arrow-line must be rendered.
    await expect.poll(
      () => countCssArrowLines(page, TOPO_SERVICE),
      { timeout: 8_000, message: `Expected CSS arrow-line elements for '${TOPO_SERVICE}' in workflow-rows` },
    ).toBeGreaterThan(0);

    const linesBefore = await countCssArrowLines(page, TOPO_SERVICE);
    expect(
      linesBefore,
      `Pre-condition: topo-explicit must have at least one CSS arrow-line in workflow-rows`,
    ).toBeGreaterThan(0);

    // Skip if topology-picker not present.
    const picker = page.locator(PICKER);
    if ((await picker.count()) === 0) {
      test.skip(true, 'topology-picker-button not present in SPA — topology-toggle-edge-rerender spec skipped (frontend WBS 3.2.5)');
      return;
    }

    const matrixCountBefore = matrixRequests.length;

    await picker.click();
    await page.locator(OPTION_LABEL('sha')).click();

    await expect.poll(() => matrixRequests.length, { timeout: 5_000 }).toBeGreaterThan(matrixCountBefore);

    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    const linesAfter = await countCssArrowLines(page, TOPO_SERVICE);
    expect(
      linesAfter,
      `Workflow-rows arrow-lines for '${TOPO_SERVICE}' must persist (> 0) after correlationAttribute switch. ` +
        `Before: ${linesBefore}, After: ${linesAfter}. ` +
        `If this is 0 the layout component lost its topology-driven path structure.`,
    ).toBeGreaterThan(0);
  });
});
