// Implements testing/e2e/scenarios/rate-limit-cluster-reflow.md
//
// CR-0011 § 3d (NFR-09 strict) + docs/ui/rate-limit-cluster.md §
// Collapse threshold. Iterates the viewport matrix [1024, 1280, 1440]
// per Decision D10 and asserts:
//   - non-overlap with the left cluster (>= 24 px gutter)
//   - collapse at viewport < 1280 px
//   - full layout at viewport >= 1280 px

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { WRITE_BASE_URL, API_KEY, runSuffix, buildFetcherUsagePayload } from './support/env';
import spaInvariantsConfig from '../spa-invariants.config.json';

const PROGRESS_REPORTER = 'dashboard-fetcher/e2e-reflow';
const cfg = (spaInvariantsConfig as unknown as {
  rateLimitCluster?: {
    selectors: { rightCluster: string; leftCluster: string; pill: string; pillCollapsed: string };
    gutterPx: number;
    collapseViewportPx: number;
    viewportMatrix: { width: number; height: number }[];
  };
}).rateLimitCluster;

test.describe('Rate-limit cluster honours NFR-09 across the viewport matrix', () => {
  test.beforeAll(() => {
    if (!cfg) {
      throw new Error(
        'spa-invariants.config.json#rateLimitCluster missing — CR-0011 expects the viewport matrix + selectors config block.',
      );
    }
  });

  test('non-overlap + collapse threshold across [1024, 1280, 1440]', async ({ page }) => {
    if (!cfg) return;

    const suffix = runSuffix();
    // Seed a single snapshot so the cluster renders.
    const api = await playwrightRequest.newContext({
      baseURL: WRITE_BASE_URL,
      extraHTTPHeaders: {
        'X-Api-Key': API_KEY,
        'X-Progress-Reporter': PROGRESS_REPORTER,
        'Content-Type': 'application/json',
      },
    });
    const seedResp = await api.post('/api/fetcher/usage', {
      data: buildFetcherUsagePayload({
        adapter_id: 'github-actions',
        source_id: `qa-bot/e2e-reflow-${suffix}`,
        upstream_limit: 5000,
        upstream_remaining: 3600, // 28% — green
      }),
    });
    expect(seedResp.status()).toBe(200);

    await page.goto('/');
    await expect(page.getByTestId('rate-limit-cluster'))
      .toBeAttached({ timeout: 35_000 });

    for (const vp of cfg.viewportMatrix) {
      // Apply viewport and let the SPA's ResizeObserver settle.
      await page.setViewportSize(vp);
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

      // I12.a — non-overlap with >= gutter px gap.
      const overlap = await page.evaluate(({ rightSel, leftSel, gutterPx }) => {
        const r = document.querySelector(rightSel);
        const l = document.querySelector(leftSel);
        if (!r || !l) return { violation: `Missing cluster element(s): right=${!!r} left=${!!l}` };
        const rr = r.getBoundingClientRect();
        const lr = l.getBoundingClientRect();
        const overlap = rr.left < lr.right && rr.right > lr.left
                      && rr.top < lr.bottom && rr.bottom > lr.top;
        if (overlap) {
          return { violation: `Overlap: left=(L=${lr.left.toFixed(1)},R=${lr.right.toFixed(1)}) right=(L=${rr.left.toFixed(1)},R=${rr.right.toFixed(1)})` };
        }
        const gap = rr.left - lr.right;
        if (gap < gutterPx) {
          return { violation: `Gap ${gap.toFixed(1)} px < required gutter ${gutterPx} px` };
        }
        return { violation: null };
      }, { rightSel: cfg.selectors.rightCluster, leftSel: cfg.selectors.leftCluster, gutterPx: cfg.gutterPx });

      expect(overlap.violation, `viewport ${vp.width}x${vp.height}`).toBeNull();

      // I12.d — collapse at viewport < 1280; full layout at >= 1280.
      const fullVisible = await page.locator(cfg.selectors.pill).first().isVisible().catch(() => false);
      const collapsedVisible = await page.locator(cfg.selectors.pillCollapsed).first().isVisible().catch(() => false);

      if (vp.width < cfg.collapseViewportPx) {
        // At sub-collapse viewports we expect collapsed mode OR (defensive)
        // that the full pill is hidden — implementations may render only
        // one of the two testids.
        expect.soft(collapsedVisible || !fullVisible,
          `At viewport ${vp.width} px (< ${cfg.collapseViewportPx}) collapsed pill expected; got full=${fullVisible} collapsed=${collapsedVisible}`)
          .toBe(true);
      } else {
        expect.soft(fullVisible,
          `At viewport ${vp.width} px (>= ${cfg.collapseViewportPx}) full pill must be visible; got full=${fullVisible} collapsed=${collapsedVisible}`)
          .toBe(true);
      }
    }

    await api.dispose();
  });
});
