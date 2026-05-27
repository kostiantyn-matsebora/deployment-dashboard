// Permanent overlap-invariants regression gate (issue #95 / parent #83).
//
// CLASS-OF-BUG DEFENSE: node-overlap defects in ngx-graph swim-lane surfaces
// have recurred across multiple iterations without a permanent gate. This spec
// is the structural defense — it asserts three invariant classes against every
// (layout × viewMode) cell that has been ngx-graph-migrated, and is structured
// for inheritance by future iterations.
//
// INHERITANCE PATTERN — to extend for a future iteration:
//   1. Uncomment (or add) the relevant row in COMBOS_UNDER_TEST.
//   2. No other structural change needed — all three OV assertions fire for
//      every active combo automatically.
//   Example: when swim-lane × Compact lands its ngx-graph port (iteration 2),
//   add: { layout: 'swim-lane', viewMode: 'compact' }
//
// THREE INVARIANT CLASSES:
//   OV1 — node-vs-node intra-row: no two g.node rects intersect within a
//          single swim-lane row. Source: ADR-0012 rev 3 §1 (dagre LR;
//          deterministic placement; overlap = defect).
//   OV2 — vertical row-boundary leakage: each g.node bottom edge must not
//          extend past its parent swim-lane-row container bottom edge (within
//          tolerances.rowLeakPx). Source: NFR-09 reflow invariant.
//   OV3 — horizontal service-name-column leakage: each g.node left edge must
//          not extend past the right edge of the service-name column element
//          (within tolerances.columnLeakPx). Source: NFR-09 reflow invariant.
//
// DATA SHAPES: each combo runs against BOTH topo-explicit seed AND demo-gha
// live data. If a defect surfaces on one shape but not the other, the verdict
// records which shape exposed it.
//
// SCOPE: swim-lane × Detailed only for iteration 1. Do NOT uncomment
// swim-lane × Compact or other combos until those surfaces are ngx-graph-
// migrated (bespoke chrome has different geometry semantics).
//
// Citations:
//   ADR-0012 rev 3 §1 — source contract for OV1
//   NFR-09 reflow invariant — source contract for OV2 + OV3
//   CLAUDE.md § Configuration vs. data — tolerances declarative, no magic numbers
//   sub-issue #95 dispatch contract
//   local/bindings.md § Project role boundaries (qa-engineer)

import {
  test,
  expect,
  type Page,
} from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Configuration (per CLAUDE.md § Configuration vs. data — no inline magic)
// ---------------------------------------------------------------------------

interface LocalConfig {
  readBaseUrl?: string;
  tolerances?: {
    nodeOverlapPx?: number;
    rowLeakPx?: number;
    columnLeakPx?: number;
  };
  viewport?: { width: number; height: number };
}

function loadConfig(): LocalConfig {
  const configPath = path.join(__dirname, '..', '..', 'config', 'local.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

const cfg = loadConfig();

// Overlap tolerances — sourced from config; contract defaults as fallback.
const NODE_OVERLAP_PX: number = cfg.tolerances?.nodeOverlapPx ?? 0;
const ROW_LEAK_PX: number = cfg.tolerances?.rowLeakPx ?? 2;
const COLUMN_LEAK_PX: number = cfg.tolerances?.columnLeakPx ?? 2;

// Viewport.
const VIEWPORT_W: number = cfg.viewport?.width ?? 1440;
const VIEWPORT_H: number = cfg.viewport?.height ?? 900;

// Base URL — falls back to the SPA dev port when env var absent.
const SPA_BASE_URL: string =
  (process.env.DASHBOARD_READ_BASE_URL ?? '').replace(/\/$/, '') ||
  (cfg.readBaseUrl ?? '').replace(/\/$/, '') ||
  'http://localhost:8080';

// ---------------------------------------------------------------------------
// Combo matrix — parameterised by (layout × viewMode)
// Iteration 1: swim-lane × Detailed only.
// Add rows here as each surface completes its ngx-graph migration.
//
// Each active combo runs SIX tests:
//   OV1 [topo-explicit] + OV2 [topo-explicit] + OV3 [topo-explicit]
//   OV1 [demo-gha]      + OV2 [demo-gha]      + OV3 [demo-gha]
//
// demo-gha coverage is built into every combo: the three [demo-gha] tests
// execute for every active COMBOS_UNDER_TEST row. The swim-lane × Detailed
// combo therefore satisfies the "swim-lane × Detailed × demo-gha" regression
// gate requirement (sub-issue #95 + memory [overlap-is-recurring-bug-class]
// + acceptance amendment on sub-issue #102) — no separate combo row is
// needed because each row already exercises both data shapes.
// ---------------------------------------------------------------------------

interface Combo {
  layout: string;
  viewMode: string;
}

const COMBOS_UNDER_TEST: Combo[] = [
  // swim-lane × Detailed — active since iteration 1.
  // Covers BOTH topo-explicit seed AND demo-gha live data (6 tests per combo).
  // Satisfies: OV1/OV2/OV3 × topo-explicit + OV1/OV2/OV3 × demo-gha.
  // Per memory [overlap-is-recurring-bug-class]: this row is the permanent
  // regression gate for swim-lane × Detailed × demo-gha (issue #95 / #102).
  { layout: 'swim-lane', viewMode: 'detailed' },
  // { layout: 'swim-lane', viewMode: 'compact'  }, // iteration 2 — uncomment when surface is ngx-graph
  // { layout: 'swim-lane', viewMode: 'glance'   }, // iteration 3 — uncomment when surface is ngx-graph
];

// ---------------------------------------------------------------------------
// Data shapes — each combo runs against both
// ---------------------------------------------------------------------------

// The topo-explicit service is guaranteed present after seed.ps1.
const TOPO_EXPLICIT_SERVICE = 'topo-explicit';

// Demo-gha shape: use whatever services are live in the running SPA.
// We do NOT re-seed for demo-gha — the test navigates and reads whatever rows exist.

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

async function navigateToCombo(page: Page, combo: Combo): Promise<void> {
  await page.goto(SPA_BASE_URL + '/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByTestId(`layout-option-${combo.layout}`).click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute(
    'data-layout',
    combo.layout,
    { timeout: 8_000 },
  );

  await page.getByTestId(`view-option-${combo.viewMode}`).click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute(
    'data-view',
    combo.viewMode,
    { timeout: 8_000 },
  );
}

// Wait for swim-lane-detailed-container + at least one row with an ngx-graph SVG.
async function waitForSwimLaneDetailedReady(
  page: Page,
  anchorService: string,
): Promise<void> {
  // Use waitFor({ state: 'attached' }) rather than toBeVisible: the container
  // may be below the fold (scrollable) on tall service lists (demo-gha 15 svc),
  // making toBeVisible() fail even when the element is present in the DOM.
  await page
    .locator('[data-testid="swim-lane-detailed-container"]')
    .waitFor({ state: 'attached', timeout: 15_000 });

  await page.waitForSelector(
    `[data-testid="swim-lane-row-${anchorService}"]`,
    { timeout: 10_000 },
  );

  await page.waitForFunction(
    (svc: string) => {
      const row = document.querySelector(`[data-testid="swim-lane-row-${svc}"]`);
      if (!row) return false;
      return row.querySelector('svg.ngx-graph') !== null;
    },
    anchorService,
    { timeout: 12_000 },
  );

  // Extra rAF tick for dagre layout settle.
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
}

// Wait for any swim-lane row with ngx-graph (demo-gha shape — service unknown).
async function waitForAnySwimLaneDetailedReady(page: Page): Promise<void> {
  // Use waitFor({ state: 'attached' }) — container may be below the fold on tall service lists.
  await page
    .locator('[data-testid="swim-lane-detailed-container"]')
    .waitFor({ state: 'attached', timeout: 15_000 });

  // Wait for at least one swim-lane row to appear.
  await page.waitForSelector('[data-testid^="swim-lane-row-"]', { timeout: 10_000 });

  // Wait for ngx-graph inside any row.
  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll('[data-testid^="swim-lane-row-"]');
      for (const row of Array.from(rows)) {
        if (row.querySelector('svg.ngx-graph')) return true;
      }
      return false;
    },
    undefined,
    { timeout: 12_000 },
  );

  // Extra rAF tick for layout settle.
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers — all work runs inside page.evaluate() to access live rects
// ---------------------------------------------------------------------------

interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface OV1Result {
  overlappingPairs: Array<{ rowTestId: string; i: number; j: number; overlapPx: number }>;
  rowsChecked: number;
  nodeCountPerRow: number[];
}

interface OV2Result {
  leakingNodes: Array<{ rowTestId: string; nodeIndex: number; nodeBottom: number; rowBottom: number; leakPx: number }>;
  rowsChecked: number;
}

interface OV3Result {
  leakingNodes: Array<{ rowTestId: string; serviceNameTestId: string; nodeIndex: number; nodeLeft: number; serviceNameRight: number; leakPx: number }>;
  rowsChecked: number;
}

// OV1: intra-row node-vs-node overlap check.
//
// dagreCluster note: ngx-graph DagreClusterLayout renders the per-service cluster
// boundary as a `g.node.cluster` element (class list: ["node","cluster"]). This
// element spans the entire cluster area by design and its bounding rect contains
// all deployment tiles — it is NOT a tile-overlap defect. OV1 therefore filters
// out `g.node.cluster` elements (cluster boundary backgrounds) and checks only
// "leaf" g.node elements (deployment tiles + env-anchor phantoms).
// Similarly, env-anchor phantom nodes (0×0) are excluded by the positive-dimension
// filter (xOverlap > tol && yOverlap > tol) because zero-size rects produce no
// positive overlap against any rect, so no explicit exclusion is needed for them.
async function checkOV1(page: Page, tolerance: number): Promise<OV1Result> {
  return page.evaluate(
    ({ tol }: { tol: number }) => {
      const containerEl = document.querySelector('[data-testid="swim-lane-detailed-container"]');
      if (!containerEl) return { overlappingPairs: [], rowsChecked: 0, nodeCountPerRow: [] };

      const rows = Array.from(containerEl.querySelectorAll('[data-testid^="swim-lane-row-"]'));
      const overlappingPairs: OV1Result['overlappingPairs'] = [];
      const nodeCountPerRow: number[] = [];

      for (const row of rows) {
        const rowTestId = row.getAttribute('data-testid') ?? '(unknown)';
        const svg = row.querySelector('svg.ngx-graph');
        if (!svg) {
          nodeCountPerRow.push(0);
          continue;
        }

        // Exclude cluster boundary nodes (g.node.cluster — dagreCluster adds these
        // as SVG background rects spanning the entire cluster area, not as deployment tiles).
        const nodes = Array.from(svg.querySelectorAll('g.node')).filter(
          (n) => !(n as Element).classList.contains('cluster'),
        );
        nodeCountPerRow.push(nodes.length);

        const rects = nodes.map((n) => {
          const r = (n as Element).getBoundingClientRect();
          return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
        });

        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            // Axis-aligned intersection: overlap exists when the rects' projections
            // overlap on BOTH axes simultaneously. We measure the overlap on each axis;
            // positive means overlap; negative means gap. The tolerance absorbs sub-pixel
            // anti-aliasing rounding.
            const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (xOverlap > tol && yOverlap > tol) {
              overlappingPairs.push({
                rowTestId,
                i,
                j,
                overlapPx: Math.max(xOverlap, yOverlap),
              });
            }
          }
        }
      }

      return { overlappingPairs, rowsChecked: rows.length, nodeCountPerRow };
    },
    { tol: tolerance },
  );
}

// OV2: vertical row-boundary leakage check.
//
// dagreCluster note: the cluster boundary node (g.node.cluster) spans the full
// cluster width/height and its bounding rect may intentionally extend past the
// row container when the row container height is CSS-driven and the SVG content
// grows dynamically. OV2 excludes cluster boundary nodes (g.node.cluster) and
// checks only deployment tile nodes (leaf g.node elements without the 'cluster'
// class). The row-boundary leakage for deployment tiles is the NFR-09 concern.
async function checkOV2(page: Page, tolerance: number): Promise<OV2Result> {
  return page.evaluate(
    ({ tol }: { tol: number }) => {
      const containerEl = document.querySelector('[data-testid="swim-lane-detailed-container"]');
      if (!containerEl) return { leakingNodes: [], rowsChecked: 0 };

      const rows = Array.from(containerEl.querySelectorAll('[data-testid^="swim-lane-row-"]'));
      const leakingNodes: OV2Result['leakingNodes'] = [];

      for (const row of rows) {
        const rowTestId = row.getAttribute('data-testid') ?? '(unknown)';
        const rowRect = (row as Element).getBoundingClientRect();
        const svg = row.querySelector('svg.ngx-graph');
        if (!svg) continue;

        // Exclude cluster boundary nodes — they span the cluster area and their
        // bottom naturally exceeds the CSS row container when content grows.
        const nodes = Array.from(svg.querySelectorAll('g.node')).filter(
          (n) => !(n as Element).classList.contains('cluster'),
        );
        nodes.forEach((n, idx) => {
          const nodeRect = (n as Element).getBoundingClientRect();
          // Node must not extend below the row container's bottom edge.
          const leakPx = nodeRect.bottom - rowRect.bottom;
          if (leakPx > tol) {
            leakingNodes.push({
              rowTestId,
              nodeIndex: idx,
              nodeBottom: nodeRect.bottom,
              rowBottom: rowRect.bottom,
              leakPx,
            });
          }
        });
      }

      return { leakingNodes, rowsChecked: rows.length };
    },
    { tol: tolerance },
  );
}

// OV3: horizontal service-name-column leakage check.
//
// dagreCluster note: the cluster boundary node (g.node.cluster) has its left
// edge at the cluster boundary, which may extend into the service-name column
// area depending on SVG positioning. OV3 excludes cluster boundary nodes to
// check only deployment tile positioning relative to the service-name column.
async function checkOV3(page: Page, tolerance: number): Promise<OV3Result> {
  return page.evaluate(
    ({ tol }: { tol: number }) => {
      const containerEl = document.querySelector('[data-testid="swim-lane-detailed-container"]');
      if (!containerEl) return { leakingNodes: [], rowsChecked: 0 };

      const rows = Array.from(containerEl.querySelectorAll('[data-testid^="swim-lane-row-"]'));
      const leakingNodes: OV3Result['leakingNodes'] = [];

      for (const row of rows) {
        const rowTestId = row.getAttribute('data-testid') ?? '(unknown)';
        // Derive service id from testid: 'swim-lane-row-{id}' -> '{id}'
        const serviceId = rowTestId.replace('swim-lane-row-', '');
        // Service-name column element: [data-testid="service-name-{id}"]
        const serviceNameEl = document.querySelector(`[data-testid="service-name-${serviceId}"]`);
        if (!serviceNameEl) continue;

        const serviceNameRight = (serviceNameEl as Element).getBoundingClientRect().right;
        const serviceNameTestId = `service-name-${serviceId}`;

        const svg = row.querySelector('svg.ngx-graph');
        if (!svg) continue;

        // Exclude cluster boundary nodes — their left edge is at the cluster boundary
        // which may differ from deployment tile positioning.
        const nodes = Array.from(svg.querySelectorAll('g.node')).filter(
          (n) => !(n as Element).classList.contains('cluster'),
        );
        nodes.forEach((n, idx) => {
          const nodeRect = (n as Element).getBoundingClientRect();
          // Node left edge must not extend left of the service-name column right edge.
          // Positive leakPx means the node encroaches into the service-name column.
          const leakPx = serviceNameRight - nodeRect.left;
          if (leakPx > tol) {
            leakingNodes.push({
              rowTestId,
              serviceNameTestId,
              nodeIndex: idx,
              nodeLeft: nodeRect.left,
              serviceNameRight,
              leakPx,
            });
          }
        });
      }

      return { leakingNodes, rowsChecked: rows.length };
    },
    { tol: tolerance },
  );
}

// ---------------------------------------------------------------------------
// Spec — parameterised by COMBOS_UNDER_TEST
// ---------------------------------------------------------------------------

for (const combo of COMBOS_UNDER_TEST) {
  test.describe(
    `overlap invariants — ${combo.layout} × ${combo.viewMode}`,
    () => {
      test.use({
        viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      });

      // -----------------------------------------------------------------------
      // OV1 — topo-explicit seed: node-vs-node intra-row no overlap
      // -----------------------------------------------------------------------
      test(
        `OV1 — node-vs-node intra-row no overlap [topo-explicit]`,
        async ({ page }) => {
          await navigateToCombo(page, combo);
          await waitForSwimLaneDetailedReady(page, TOPO_EXPLICIT_SERVICE);

          const result = await checkOV1(page, NODE_OVERLAP_PX);

          expect(
            result.rowsChecked,
            'OV1 [topo-explicit]: at least one swim-lane row must be present',
          ).toBeGreaterThan(0);

          const overlapSummary = result.overlappingPairs
            .map(
              (p) =>
                `row=${p.rowTestId} nodes[${p.i}]+[${p.j}] overlap=${p.overlapPx.toFixed(1)}px`,
            )
            .join('\n');

          expect(
            result.overlappingPairs.length,
            `OV1 [topo-explicit]: ${result.overlappingPairs.length} overlapping node pair(s) found ` +
              `(tolerance=${NODE_OVERLAP_PX}px). ADR-0012 rev 3 §1 dagre placement must be overlap-free.\n` +
              overlapSummary,
          ).toBe(0);
        },
      );

      // -----------------------------------------------------------------------
      // OV2 — topo-explicit seed: vertical row-boundary leakage
      // -----------------------------------------------------------------------
      test(
        `OV2 — node-vs-row-boundary vertical leakage [topo-explicit]`,
        async ({ page }) => {
          await navigateToCombo(page, combo);
          await waitForSwimLaneDetailedReady(page, TOPO_EXPLICIT_SERVICE);

          const result = await checkOV2(page, ROW_LEAK_PX);

          expect(
            result.rowsChecked,
            'OV2 [topo-explicit]: at least one swim-lane row must be present',
          ).toBeGreaterThan(0);

          const leakSummary = result.leakingNodes
            .map(
              (n) =>
                `row=${n.rowTestId} node[${n.nodeIndex}] bottom=${n.nodeBottom.toFixed(1)}px rowBottom=${n.rowBottom.toFixed(1)}px leak=${n.leakPx.toFixed(1)}px`,
            )
            .join('\n');

          expect(
            result.leakingNodes.length,
            `OV2 [topo-explicit]: ${result.leakingNodes.length} node(s) leak past their row boundary ` +
              `(tolerance=${ROW_LEAK_PX}px). NFR-09 reflow invariant violation.\n` +
              leakSummary,
          ).toBe(0);
        },
      );

      // -----------------------------------------------------------------------
      // OV3 — topo-explicit seed: horizontal service-name-column leakage
      // -----------------------------------------------------------------------
      test(
        `OV3 — node-vs-service-name-column horizontal leakage [topo-explicit]`,
        async ({ page }) => {
          await navigateToCombo(page, combo);
          await waitForSwimLaneDetailedReady(page, TOPO_EXPLICIT_SERVICE);

          const result = await checkOV3(page, COLUMN_LEAK_PX);

          expect(
            result.rowsChecked,
            'OV3 [topo-explicit]: at least one swim-lane row must be present',
          ).toBeGreaterThan(0);

          const leakSummary = result.leakingNodes
            .map(
              (n) =>
                `row=${n.rowTestId} node[${n.nodeIndex}] left=${n.nodeLeft.toFixed(1)}px serviceNameRight=${n.serviceNameRight.toFixed(1)}px leak=${n.leakPx.toFixed(1)}px`,
            )
            .join('\n');

          expect(
            result.leakingNodes.length,
            `OV3 [topo-explicit]: ${result.leakingNodes.length} node(s) extend into the service-name column ` +
              `(tolerance=${COLUMN_LEAK_PX}px). NFR-09 reflow invariant violation.\n` +
              leakSummary,
          ).toBe(0);
        },
      );

      // -----------------------------------------------------------------------
      // OV1 — demo-gha live data: node-vs-node intra-row no overlap
      // -----------------------------------------------------------------------
      test(
        `OV1 — node-vs-node intra-row no overlap [demo-gha]`,
        async ({ page }) => {
          await navigateToCombo(page, combo);
          await waitForAnySwimLaneDetailedReady(page);

          const result = await checkOV1(page, NODE_OVERLAP_PX);

          if (result.rowsChecked === 0) {
            test.skip(true, 'OV1 [demo-gha]: no swim-lane rows rendered — SPA may have no data. Skipping.');
            return;
          }

          const overlapSummary = result.overlappingPairs
            .map(
              (p) =>
                `row=${p.rowTestId} nodes[${p.i}]+[${p.j}] overlap=${p.overlapPx.toFixed(1)}px`,
            )
            .join('\n');

          expect(
            result.overlappingPairs.length,
            `OV1 [demo-gha]: ${result.overlappingPairs.length} overlapping node pair(s) found ` +
              `(tolerance=${NODE_OVERLAP_PX}px). ADR-0012 rev 3 §1 dagre placement must be overlap-free.\n` +
              overlapSummary,
          ).toBe(0);
        },
      );

      // -----------------------------------------------------------------------
      // OV2 — demo-gha live data: vertical row-boundary leakage
      // -----------------------------------------------------------------------
      test(
        `OV2 — node-vs-row-boundary vertical leakage [demo-gha]`,
        async ({ page }) => {
          await navigateToCombo(page, combo);
          await waitForAnySwimLaneDetailedReady(page);

          const result = await checkOV2(page, ROW_LEAK_PX);

          if (result.rowsChecked === 0) {
            test.skip(true, 'OV2 [demo-gha]: no swim-lane rows rendered — SPA may have no data. Skipping.');
            return;
          }

          const leakSummary = result.leakingNodes
            .map(
              (n) =>
                `row=${n.rowTestId} node[${n.nodeIndex}] bottom=${n.nodeBottom.toFixed(1)}px rowBottom=${n.rowBottom.toFixed(1)}px leak=${n.leakPx.toFixed(1)}px`,
            )
            .join('\n');

          expect(
            result.leakingNodes.length,
            `OV2 [demo-gha]: ${result.leakingNodes.length} node(s) leak past their row boundary ` +
              `(tolerance=${ROW_LEAK_PX}px). NFR-09 reflow invariant violation.\n` +
              leakSummary,
          ).toBe(0);
        },
      );

      // -----------------------------------------------------------------------
      // OV3 — demo-gha live data: horizontal service-name-column leakage
      // -----------------------------------------------------------------------
      test(
        `OV3 — node-vs-service-name-column horizontal leakage [demo-gha]`,
        async ({ page }) => {
          await navigateToCombo(page, combo);
          await waitForAnySwimLaneDetailedReady(page);

          const result = await checkOV3(page, COLUMN_LEAK_PX);

          if (result.rowsChecked === 0) {
            test.skip(true, 'OV3 [demo-gha]: no swim-lane rows rendered — SPA may have no data. Skipping.');
            return;
          }

          const leakSummary = result.leakingNodes
            .map(
              (n) =>
                `row=${n.rowTestId} node[${n.nodeIndex}] left=${n.nodeLeft.toFixed(1)}px serviceNameRight=${n.serviceNameRight.toFixed(1)}px leak=${n.leakPx.toFixed(1)}px`,
            )
            .join('\n');

          expect(
            result.leakingNodes.length,
            `OV3 [demo-gha]: ${result.leakingNodes.length} node(s) extend into the service-name column ` +
              `(tolerance=${COLUMN_LEAK_PX}px). NFR-09 reflow invariant violation.\n` +
              leakSummary,
          ).toBe(0);
        },
      );
    },
  );
}
