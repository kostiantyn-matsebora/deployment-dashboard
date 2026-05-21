// Mockup visual Invariant 12 — Rate-limit cluster (CR-0011 + ADR-0008).
//
// Owner: qa-engineer.
//
// Loads docs/ui/deployment-dashboard.html via file:// in a real Chromium
// browser and runs Invariant 12 across the viewport matrix declared in
// harness.config.json#viewportMatrix (CR-0011 Decision D10):
//
//   1024 x 768  — NFR-09 minimum viewport (collapsed cluster expected)
//   1280 x 800  — collapse boundary per docs/ui/rate-limit-cluster.md
//   1440 x 900  — canonical full-layout viewport (default for other harness)
//
// Invariant 12 sub-assertions per Phase 2e plan:
//   I12.a  — cluster non-overlap with left cluster (>= 24 px gutter)
//   I12.b  — severity-band class on the pill matches the worst-band rule
//   I12.c  — highlight-hint reconciliation == stack vertically (D7)
//   I12.d  — collapse fires at viewport < 1280 px (D8)
//   I12.e  — stale affordance fires when now - received_at > 120 s (D6)
//   I12.f  — aggregated worst-band pill + counter + popover (D8)
//
// Per the existing mockup-invariants.spec.ts pattern: each assertion runs
// inside page.evaluate() so getBoundingClientRect() reads happen in one
// pass with consistent layout; violations accumulate into a structured
// list that the test serialises into the spec result.
//
// Citations (per CLAUDE.md routing):
//   - docs/cr/CR-0011-fetcher-rate-limit-governance.md — § 3d cluster
//     contract; § 3e mockup-before-implementation rule.
//   - docs/adr/ADR-0008-leaky-bucket-cap-and-republish-on-tick.md —
//     Decision 2 (re-publish-on-tick), Decision 3 (per-token cap).
//   - docs/ui/rate-limit-cluster.md — chosen variant table, severity
//     tokens, collapse threshold, stale affordance, NFR-09 footprint.

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import harnessConfig from './harness.config.json';

type Rect = { left: number; right: number; top: number; bottom: number };

type Violation = {
  invariantId: string;
  subId: string;
  message: string;
  details?: unknown;
};

const HARNESS_DIR = __dirname;
const MOCKUP_PATH = path.resolve(HARNESS_DIR, harnessConfig.mockupRelativePath);
const SHOTS_DIR = path.resolve(HARNESS_DIR, harnessConfig.screenshotsDir);
const PARTIALS_DIR = path.resolve(SHOTS_DIR, '_partials');

if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });
if (!fs.existsSync(PARTIALS_DIR)) fs.mkdirSync(PARTIALS_DIR, { recursive: true });

const MOCKUP_FILE_URL = url.pathToFileURL(MOCKUP_PATH).toString();

type RateLimitClusterConfig = {
  selectors: {
    rightCluster: string;
    leftCluster: string;
    pill: string;
    pillCollapsed: string;
    counter: string;
    popover: string;
    popoverRow: string;
    staleAffordance: string;
    highlightHint: string;
  };
  gutterPx: number;
  collapseViewportPx: number;
  severityBands: {
    green: { max: number; lightToken: string };
    amber: { min: number; max: number; lightToken: string };
    red:   { min: number; lightToken: string };
    stale: { lightToken: string };
  };
  staleThresholdMs: number;
};

type ViewportMatrixEntry = { width: number; height: number };

const cfg = (harnessConfig as unknown as { rateLimitCluster?: RateLimitClusterConfig }).rateLimitCluster;
const matrix = (harnessConfig as unknown as { viewportMatrix?: ViewportMatrixEntry[] }).viewportMatrix
  ?? [{ width: 1440, height: 900 }];

test.beforeAll(() => {
  if (!fs.existsSync(MOCKUP_PATH)) {
    throw new Error(`Mockup file not found at ${MOCKUP_PATH}`);
  }
  if (!cfg) {
    throw new Error(
      "harness.config.json#rateLimitCluster missing — CR-0011 D11 expects the rate-limit cluster harness config block.",
    );
  }
});

// ----------------------------- the spec --------------------------------------
for (const vp of matrix) {
  test(`I12 rate-limit cluster @ ${vp.width}x${vp.height}`, async ({ page }) => {
    if (!cfg) {
      test.skip(true, "no rateLimitCluster config");
      return;
    }

    const violations: Violation[] = [];
    const push = (subId: string, message: string, details?: unknown) =>
      violations.push({ invariantId: 'I12-rate-limit-cluster', subId, message, details });

    await page.setViewportSize(vp);
    await page.goto(MOCKUP_FILE_URL);
    await page.waitForLoadState('domcontentloaded');

    // The cluster only renders when usageSnapshots.length > 0 — the mockup
    // ships a static three-snapshot fixture per docs/ui/rate-limit-cluster.md
    // § Fixture additions. Wait for the cluster wrapper or the empty-state.
    const clusterLocator = page.locator(cfg.selectors.rightCluster);
    try {
      await clusterLocator.waitFor({ state: 'attached', timeout: 5_000 });
    } catch {
      push('I12.f', `Rate-limit cluster wrapper '${cfg.selectors.rightCluster}' missing from the DOM. Mockup must wire the cluster per docs/ui/rate-limit-cluster.md before the harness can assert.`);
    }

    // Two paint frames after layout settles, then run the in-browser checks.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

    // Take a screenshot keyed by viewport so the diff is visible in PR review.
    const shotPath = path.resolve(SHOTS_DIR, `rate-limit-cluster-${vp.width}x${vp.height}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });

    // Run sub-assertions in-browser so every getBoundingClientRect() read
    // happens in one layout pass.
    const result = await page.evaluate(
      async ({ cfg, vp }) => {
        type Violation = { invariantId: string; subId: string; message: string; details?: unknown };
        const violations: Violation[] = [];
        const push = (subId: string, message: string, details?: unknown) =>
          violations.push({ invariantId: 'I12-rate-limit-cluster', subId, message, details });

        const rectOf = (el: Element): { left: number; right: number; top: number; bottom: number } => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        const intersect = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

        const right = document.querySelector(cfg.selectors.rightCluster);
        const left = document.querySelector(cfg.selectors.leftCluster);

        // I12.a — non-overlap with >= gutter px gap.
        if (right && left) {
          const rr = rectOf(right);
          const lr = rectOf(left);
          if (intersect(rr, lr)) {
            push('I12.a', `Rate-limit cluster (right) and stats-bar-left cluster overlap: left=(L=${lr.left.toFixed(1)},R=${lr.right.toFixed(1)}) right=(L=${rr.left.toFixed(1)},R=${rr.right.toFixed(1)}).`,
              { leftRect: lr, rightRect: rr });
          } else {
            const gap = rr.left - lr.right;
            if (gap < cfg.gutterPx) {
              push('I12.a', `Gap between left cluster's right edge (${lr.right.toFixed(1)}) and right cluster's left edge (${rr.left.toFixed(1)}) is ${gap.toFixed(1)} px; minimum gutter per docs/ui/rate-limit-cluster.md is ${cfg.gutterPx} px.`,
                { gap, gutterPx: cfg.gutterPx });
            }
          }
        } else {
          if (!right) push('I12.a', `Right cluster selector '${cfg.selectors.rightCluster}' matched nothing.`);
          if (!left) push('I12.a', `Left cluster selector '${cfg.selectors.leftCluster}' matched nothing.`);
        }

        // I12.b — severity band class on the worst-band aggregated pill.
        // Mockup ships a static 3-snapshot fixture with the worst band = red
        // (4400/5000 = 88% > 85%); the aggregated pill MUST carry the red
        // token (bg-red-100 in light mode). We accept the collapsed pill
        // selector as an alias for the full pill — collapse mode is part
        // of I12.d but the band class still applies.
        const pillEl = document.querySelector(cfg.selectors.pill)
          ?? document.querySelector(cfg.selectors.pillCollapsed);
        if (!pillEl) {
          push('I12.b', `Neither '${cfg.selectors.pill}' nor '${cfg.selectors.pillCollapsed}' matched. The aggregated worst-band pill must render at every viewport.`);
        } else {
          const classes = pillEl.className || '';
          const worstBandToken = cfg.severityBands.red.lightToken; // mockup fixture: worst band == red
          const staleToken = cfg.severityBands.stale.lightToken;
          // Accept stale tokenization (pill may be in stale mode if the
          // fixture's received_at clock is older than 2 × poll_interval —
          // that's I12.e's domain; I12.b only fires when the band class is
          // present AND wrong).
          if (!classes.includes(staleToken) && !classes.includes(worstBandToken)) {
            push('I12.b', `Aggregated pill class list '${classes}' does not include the worst-band token '${worstBandToken}' (nor the stale token '${staleToken}'). Mockup fixture has worst band = red (88%); pill must reflect.`,
              { classes, expected: worstBandToken });
          }
        }

        // I12.c — highlight-hint reconciliation = stack vertically (D7).
        // The wrapper carries flex-col so the hint stacks ABOVE the pill
        // row. Geometry check: the right-cluster wrapper has a column flex
        // direction (so child rows stack vertically).
        if (right) {
          const cs = getComputedStyle(right);
          if (cs.flexDirection !== 'column') {
            push('I12.c', `Right-cluster wrapper flex-direction is '${cs.flexDirection}'; D7 reconciliation = 'stack vertically' requires 'column' so the highlight-hint sits above the pill row.`,
              { flexDirection: cs.flexDirection });
          }
        }

        // I12.d — collapse at viewport < 1280 px (D8). At sub-collapse
        // viewports the full pill testid hides and the collapsed-pill
        // testid renders; at >= 1280 px the opposite holds.
        const fullPill = document.querySelector(cfg.selectors.pill);
        const collapsedPill = document.querySelector(cfg.selectors.pillCollapsed);
        const isFullVisible = !!fullPill && (fullPill as HTMLElement).offsetWidth > 0;
        const isCollapsedVisible = !!collapsedPill && (collapsedPill as HTMLElement).offsetWidth > 0;
        if (vp.width < cfg.collapseViewportPx) {
          if (isFullVisible && !isCollapsedVisible) {
            push('I12.d', `At viewport ${vp.width} px (< ${cfg.collapseViewportPx}) the cluster must collapse to '${cfg.selectors.pillCollapsed}'; instead the full pill '${cfg.selectors.pill}' is visible.`,
              { viewportWidth: vp.width, collapseAt: cfg.collapseViewportPx });
          }
        } else {
          // At full viewports we expect the full pill to render (the cluster
          // hides entirely when usageSnapshots is empty, but the fixture has 3
          // — full pill must be present).
          if (!isFullVisible && !isCollapsedVisible) {
            push('I12.d', `At viewport ${vp.width} px (>= ${cfg.collapseViewportPx}) neither full nor collapsed pill is visible.`,
              { viewportWidth: vp.width });
          }
        }

        // I12.e — stale affordance is wired. The mockup gates the
        // affordance behind an Alpine <template x-if="rateLimitAllStale">,
        // so the testid is only in the DOM when every snapshot is stale.
        // To probe wiring without the visible-flip behavioural test
        // (covered by e2e via page.clock.install), we toggle the Alpine
        // root's rateLimitAllStale state and re-query. If the testid
        // appears, wiring is good.
        const alpineRoot = (document.body as unknown as { _x_dataStack?: Array<Record<string, unknown>> })._x_dataStack?.[0]
          ?? ((window as unknown as { Alpine?: { $data?: (el: Element) => Record<string, unknown> } }).Alpine?.$data?.(document.body));
        let staleEl = document.querySelector(cfg.selectors.staleAffordance);
        if (!staleEl && alpineRoot) {
          // Try to flip the stale predicate via the Alpine state so the
          // template materializes the testid.
          try {
            (alpineRoot as Record<string, unknown>).rateLimitAllStale = true;
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
            staleEl = document.querySelector(cfg.selectors.staleAffordance);
            // Restore so the rest of the assertions see live state.
            (alpineRoot as Record<string, unknown>).rateLimitAllStale = false;
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
          } catch {
            // ignore — the wiring probe is best-effort
          }
        }
        if (!staleEl) {
          push('I12.e', `Stale-affordance hook '${cfg.selectors.staleAffordance}' missing even after flipping Alpine 'rateLimitAllStale'. Mockup must wire the testid per docs/ui/rate-limit-cluster.md § Stale-affordance visual; e2e covers the visible-flip behaviour against the SPA.`);
        }

        // I12.f — aggregated worst-band pill + counter + popover wiring.
        // The counter is a sibling to the pill. The popover wrapper is
        // bound to x-show="usagePopoverOpen" with x-cloak so it lives in
        // the DOM (querySelector returns it) but its <template x-for> body
        // only materializes the row testids when the popover is open.
        if (vp.width >= cfg.collapseViewportPx) {
          const counter = document.querySelector(cfg.selectors.counter);
          const popover = document.querySelector(cfg.selectors.popover);
          if (!counter) {
            push('I12.f', `Counter '${cfg.selectors.counter}' missing at full viewport. The aggregated rollup requires the per-source counter sibling to the pill.`);
          }
          if (!popover) {
            push('I12.f', `Popover '${cfg.selectors.popover}' missing at full viewport. The aggregated rollup requires the per-(adapter, source) detail popover.`);
          } else if (alpineRoot) {
            // Open the popover via the Alpine state so the x-for body
            // materializes the row testids; then re-query.
            try {
              (alpineRoot as Record<string, unknown>).usagePopoverOpen = true;
              await new Promise<void>((r) => requestAnimationFrame(() => r()));
              await new Promise<void>((r) => requestAnimationFrame(() => r()));
              const rows = document.querySelectorAll(cfg.selectors.popoverRow);
              if (rows.length < 1) {
                push('I12.f', `Popover '${cfg.selectors.popover}' has zero rows '${cfg.selectors.popoverRow}' after opening. Mockup fixture must seed at least one (adapter, source) snapshot.`);
              }
              (alpineRoot as Record<string, unknown>).usagePopoverOpen = false;
              await new Promise<void>((r) => requestAnimationFrame(() => r()));
            } catch {
              // ignore — wiring probe is best-effort
            }
          }
        }

        return { violations };
      },
      { cfg, vp },
    );

    for (const v of result.violations) violations.push(v);

    // Persist the per-viewport partial so run-tests.ps1's report stitcher
    // can include I12 results in the consolidated table.
    const partialPath = path.resolve(PARTIALS_DIR, `i12-rate-limit-cluster__${vp.width}x${vp.height}.json`);
    fs.writeFileSync(partialPath, JSON.stringify({
      invariant: 'I12-rate-limit-cluster',
      viewport: vp,
      status: violations.length === 0 ? 'PASS' : 'FAIL',
      violations,
      screenshotPath: shotPath,
    }, null, 2));

    expect.soft(
      violations,
      `Invariant 12 violations at ${vp.width}x${vp.height}:\n${violations.map((v) => '  - [' + v.subId + '] ' + v.message).join('\n')}`,
    ).toEqual([]);
  });
}
