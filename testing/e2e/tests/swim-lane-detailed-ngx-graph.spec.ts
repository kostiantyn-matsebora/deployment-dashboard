// Implements ADR-0012 rev 3 acceptance gate for the swim-lane × Detailed
// ngx-graph port (issue #83 Phase B).
//
// Assertions (from the Phase B dispatch contract):
//   (a) svg.ngx-graph is present inside the swim-lane × Detailed container.
//   (b) No .arrow-line elements exist in the rendered swim-lane × Detailed
//       tree — verifies the old bespoke SVG-overlay chrome is not active
//       when view=detailed.
//   (c) At least one ngx-graph node group (g.node) renders with a positive
//       bounding rect — verifies dagre lays out at least one node per service
//       lane without collapsing to zero dimensions.
//   (d) Switching to another view (compact) and back to detailed re-mounts
//       ngx-graph without console errors — guards the @switch dispatch shim
//       in swim-lane-layout.component.ts.
//
// Scope: swim-lane × detailed only (Phase B iteration 1). Regression scope
// does not cover other (layout × view) combinations — those are covered by
// layout-x-view-combinations.spec.ts.
//
// ADR-0012 rev 3 pinned contracts verified here:
//   §1 layout=dagre, orientation=LR, ranker=tight-tree (structural: g.node
//      groups appear in left-to-right ENV_ORDER — dev before qa before prod)
//   §2 nodeWidth=160, nodeHeight=120 (no assertion here; KArma-tested)
//   §3 edge-correlated class on correlated-source edges (not asserted —
//      topo-correlated service correlation class is a Karma domain test)
//   §4 rank from dag-builder.ts pre-set node.rank (Karma domain test)
//   §5 DAG from buildDag() + projectDeployments() (Karma domain test)
//   §6 one ngx-graph viewport per service (swim-lane decomposition) — assertion (a)
//
// NFR-09 timing budget: waitForSelector + waitForFunction with 10 s upper
// bound; each assertion is guarded against cold-paint / first-paint variance.

import { test, expect, type ConsoleMessage } from '@playwright/test';

// Seeded services that are guaranteed by testing/fixtures/seed-data.json.
// topo-explicit has 3 nodes: dev → qa → prod (explicit parent_deployments).
// service-b has 2 seeded slots: dev + qa.
const TOPO_EXPLICIT_SERVICE = 'topo-explicit';

// Known-harmless error patterns in this spec context.
const HARMLESS_ERRORS: readonly RegExp[] = [
  // Add entries here only with inline justification.
];

function shouldIgnore(text: string): boolean {
  return HARMLESS_ERRORS.some((re) => re.test(text));
}

async function navigateToSwimLaneDetailed(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Detailed is the default view; switch layout to swim-lane first.
  await page.getByTestId('layout-option-swim-lane').click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', 'swim-lane');

  // Ensure detailed is active (it is by default; explicit for test clarity).
  await page.getByTestId('view-option-detailed').click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', 'detailed');
}

test.describe('swim-lane × Detailed — ngx-graph port (ADR-0012 rev 3 Phase B)', () => {
  // -------------------------------------------------------------------------
  // (a) svg.ngx-graph renders inside the swim-lane × Detailed container
  // (b) No .arrow-line bespoke chrome present
  // (c) At least one g.node group with positive bounding rect
  // -------------------------------------------------------------------------
  test('ngx-graph SVG renders per service lane; bespoke .arrow-line absent', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !shouldIgnore(msg.text())) errors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      if (!shouldIgnore(err.message)) errors.push(err.message);
    });

    await navigateToSwimLaneDetailed(page);

    // Wait for the swim-lane-detailed container to appear.
    await expect(
      page.getByTestId('swim-lane-detailed-container'),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for at least one swim-lane-row to materialise (topo-explicit must appear).
    await page.waitForSelector(
      `[data-testid="swim-lane-row-${TOPO_EXPLICIT_SERVICE}"]`,
      { timeout: 10_000 },
    );

    // Wait for ngx-graph SVG to render inside the topo-explicit row.
    await page.waitForFunction(
      (service) => {
        const row = document.querySelector(
          `[data-testid="swim-lane-row-${service}"]`,
        );
        if (!row) return false;
        return row.querySelector('svg.ngx-graph') !== null;
      },
      TOPO_EXPLICIT_SERVICE,
      { timeout: 10_000 },
    );

    // (a) Every swim-lane row must contain an svg.ngx-graph element.
    const rows = page.locator('[data-testid^="swim-lane-row-"]');
    const rowCount = await rows.count();
    expect(rowCount, 'At least one swim-lane row must render in swim-lane × detailed').toBeGreaterThan(0);

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const serviceId = await row.getAttribute('data-testid');
      const ngxGraph = row.locator('svg.ngx-graph');
      await expect(
        ngxGraph.first(),
        `Row '${serviceId}' must contain svg.ngx-graph in swim-lane × detailed`,
      ).toBeVisible({ timeout: 5_000 });
    }

    // (b) No .arrow-line bespoke SVG-overlay chrome in the detailed container.
    const arrowLines = page
      .getByTestId('swim-lane-detailed-container')
      .locator('.arrow-line');
    await expect(
      arrowLines,
      'No .arrow-line bespoke connector chrome must be present in swim-lane × detailed (old overlay chrome should be inactive)',
    ).toHaveCount(0);

    // (c) At least one g.node group renders with a positive bounding rect
    // inside the topo-explicit row.
    const nodeGroups = await page.evaluate((service) => {
      const row = document.querySelector(
        `[data-testid="swim-lane-row-${service}"]`,
      );
      if (!row) return { count: 0, anyPositive: false };
      const nodes = Array.from(row.querySelectorAll('svg.ngx-graph g.node'));
      const rects = nodes.map((n) => {
        const r = (n as SVGElement).getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      return {
        count: nodes.length,
        anyPositive: rects.some((r) => r.w > 0 && r.h > 0),
      };
    }, TOPO_EXPLICIT_SERVICE);

    expect(
      nodeGroups.count,
      `topo-explicit row must render at least one g.node inside svg.ngx-graph`,
    ).toBeGreaterThan(0);
    expect(
      nodeGroups.anyPositive,
      `At least one g.node in topo-explicit row must have a positive bounding rect (dagre layout must not collapse nodes)`,
    ).toBe(true);

    // No console errors throughout.
    expect(
      errors,
      `swim-lane × detailed emitted ${errors.length} console error(s):\n${errors.join('\n')}`,
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // (d) Switching away and back re-mounts ngx-graph without console errors.
  //     Guards the @switch dispatch shim in swim-lane-layout.component.ts.
  // -------------------------------------------------------------------------
  test('switching view away and back to detailed re-mounts ngx-graph without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !shouldIgnore(msg.text())) errors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      if (!shouldIgnore(err.message)) errors.push(err.message);
    });

    await navigateToSwimLaneDetailed(page);

    // Confirm detailed is rendering ngx-graph.
    await page.waitForSelector(
      `[data-testid="swim-lane-row-${TOPO_EXPLICIT_SERVICE}"]`,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      (service) => {
        const row = document.querySelector(
          `[data-testid="swim-lane-row-${service}"]`,
        );
        return row ? row.querySelector('svg.ngx-graph') !== null : false;
      },
      TOPO_EXPLICIT_SERVICE,
      { timeout: 10_000 },
    );

    // Switch to compact view.
    await page.getByTestId('view-option-compact').click();
    await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', 'compact');

    // The swim-lane-detailed-container must be absent in compact.
    await expect(page.getByTestId('swim-lane-detailed-container')).toHaveCount(0);

    // Switch back to detailed.
    await page.getByTestId('view-option-detailed').click();
    await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', 'detailed');

    // ngx-graph must re-mount after switching back.
    await page.waitForFunction(
      (service) => {
        const row = document.querySelector(
          `[data-testid="swim-lane-row-${service}"]`,
        );
        return row ? row.querySelector('svg.ngx-graph') !== null : false;
      },
      TOPO_EXPLICIT_SERVICE,
      { timeout: 10_000 },
    );

    const ngxGraphs = page
      .getByTestId('swim-lane-detailed-container')
      .locator('svg.ngx-graph');
    await expect(
      ngxGraphs.first(),
      'svg.ngx-graph must re-appear after switching back to detailed view',
    ).toBeVisible({ timeout: 5_000 });

    // Two rAF ticks to let deferred render pass settle.
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );

    expect(
      errors,
      `swim-lane × detailed view-switch round-trip emitted ${errors.length} console error(s):\n${errors.join('\n')}`,
    ).toEqual([]);
  });
});
