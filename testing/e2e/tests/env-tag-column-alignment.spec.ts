// Implements testing/e2e/scenarios/env-tag-column-alignment.md
//
// Issue #23 — workflow-rows per-position env-tag column alignment, SPA
// side. Mirrors testing/mockup-visual/env-tag-column-alignment.spec.ts
// (the mockup-side oracle) against the running Angular SPA.
//
// Strategy: POST an ephemeral multi-path service to the Write API so
// the SPA renders a `.svc-block` with two workflow rows whose env-tag
// text widths differ at position-1 (`QA-BOT-QA-*` vs
// `QA-BOT-QAHOTFIX-*`). Then drive the SPA to workflow-rows + expand-
// all and assert that for every (.svc-block, position) every
// `.leaf-pair[data-env-position="N"]` resolves the SAME computed
// column-1 (env-tag) grid track width.
//
// Why column-1-width, not `.leaf-pair.left`. See the mockup-visual
// twin's "IMPORTANT — why we don't assert .leaf-pair.left" header
// block. Each `.leaf-pair` is a CSS Grid with column-2 = max-content
// (sized to the deployment box's intrinsic content). Two rows with
// the same env-tag column-1 width can still resolve different
// downstream `.left` values when their preceding boxes' content
// widths differ — and that is intrinsic to the orthogonal
// max-content design decision, not part of issue #23. The Variant A
// directive guarantees column-1 width equality per position; that is
// the contract this spec asserts.
//
// Cleanup: handled by `testing/e2e/run-tests.ps1`'s auto-teardown pass
// (`seed.ps1 -CleanOnly`). No manual cleanup inside the spec.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { WRITE_BASE_URL, API_KEY, runSuffix, buildDeploymentPayload } from './support/env';

// Tolerance: ≤ 0.5 px sub-pixel browser-render slack. The Variant A
// directive writes `ceil(widest-text-content) + 1 px`, so the
// theoretical drift is 0 px; 0.5 px is the conservative ceiling for
// cross-Chromium sub-pixel rounding.
const TOLERANCE_PX = 0.5;

// MVP views that render the outside-the-box env-tag column.
// Glance is excluded — `.leaf-pair-glance` inlines the env-tag inside
// the deployment pill, so the per-position invariant does not apply
// (the directive deliberately skips those cells).
const VIEWS_WITH_ENV_TAG_COLUMN = ['detailed', 'compact', 'focus'] as const;

type PerPair = {
  text: string;
  tagW: number;
  col1Px: number;
  gridTpl: string;
  pairLeft: number;
  tagRight: number;
};
type AlignmentReport = {
  position: number;
  rowCount: number;
  hostVar: string;
  col1WidthsPx: number[];
  col1WidthSpreadPx: number;
  pairLefts: number[];
  pairLeftSpreadPx: number;
  tagRights: number[];
  tagRightSpreadPx: number;
  perPair: PerPair[];
};

// Helper — parse the computed `grid-template-columns` string into its
// constituent track widths. Browsers serialise it as e.g.
// "33px 334.547px" so a regex of `(\d+(?:\.\d+)?)px` is sufficient.
const PARSE_GRID_TPL_HELPER = `
  function parseGridCol1Px(tpl) {
    const m = tpl.match(/([0-9]+(?:\\.[0-9]+)?)px/);
    return m ? parseFloat(m[1]) : 0;
  }
`;

// In-page evaluator: walks every `.leaf-pair[data-env-position]` inside
// the named `.svc-block`, groups by position, captures the computed
// column-1 grid track width (the directive's contract), and reports
// the per-position spread. Skips `.leaf-pair-glance` cells (directive
// deliberately excludes them).
function buildAlignmentEvaluator(serviceId: string): string {
  return `(() => {
    ${PARSE_GRID_TPL_HELPER}
    const block = document.querySelector('.svc-block[data-service="${serviceId}"]')
      || document.querySelector('.svc-block[data-service-row="${serviceId}"]');
    if (!block) {
      return { error: "no .svc-block for service '${serviceId}'" };
    }
    const buckets = new Map();
    const pairs = Array.from(block.querySelectorAll('.leaf-pair[data-env-position]'));
    for (const pair of pairs) {
      if (pair.classList.contains('leaf-pair-glance')) continue;
      const raw = pair.getAttribute('data-env-position');
      const pos = raw === null ? NaN : Number(raw);
      if (!Number.isFinite(pos) || pos < 0) continue;
      const arr = buckets.get(pos) || [];
      arr.push(pair);
      buckets.set(pos, arr);
    }
    const reports = [];
    for (const [pos, group] of buckets) {
      const blockStyle = (block).style;
      const hostVar = blockStyle.getPropertyValue('--env-tag-col-' + pos + '-width') || '';
      const perPair = group.map((el) => {
        const tag = el.querySelector(':scope > .env-tag');
        const text = tag ? (tag.textContent || '').trim() : '';
        const tagRect = tag ? tag.getBoundingClientRect() : null;
        const pairRect = el.getBoundingClientRect();
        const gridTpl = getComputedStyle(el).gridTemplateColumns;
        return {
          text,
          tagW:     tagRect ? Number(tagRect.width.toFixed(2)) : 0,
          col1Px:   Number(parseGridCol1Px(gridTpl).toFixed(2)),
          gridTpl,
          pairLeft: Number(pairRect.left.toFixed(2)),
          tagRight: tagRect ? Number(tagRect.right.toFixed(2)) : 0,
        };
      });
      const col1Widths = perPair.map((p) => p.col1Px);
      const col1WidthSpread = Math.max(...col1Widths) - Math.min(...col1Widths);
      const pairLefts = perPair.map((p) => p.pairLeft);
      const pairLeftSpread = Math.max(...pairLefts) - Math.min(...pairLefts);
      const tagRights = perPair.map((p) => p.tagRight);
      const tagRightSpread = Math.max(...tagRights) - Math.min(...tagRights);
      reports.push({
        position: pos,
        rowCount: group.length,
        hostVar,
        col1WidthsPx: col1Widths,
        col1WidthSpreadPx: Number(col1WidthSpread.toFixed(2)),
        pairLefts,
        pairLeftSpreadPx: Number(pairLeftSpread.toFixed(2)),
        tagRights,
        tagRightSpreadPx: Number(tagRightSpread.toFixed(2)),
        perPair,
      });
    }
    return { reports };
  })()`;
}

test.describe('Issue #23 — workflow-rows per-position env-tag column alignment (SPA)', () => {
  for (const view of VIEWS_WITH_ENV_TAG_COLUMN) {
    test(`${view} x workflow-rows: nth deployment column aligns across all rows of a service`, async ({ page }) => {
      // ----- 1. Seed ephemeral multi-path service via Write API -----
      const suffix = runSuffix();
      const SERVICE = `qa-bot-issue23-${suffix}`;
      // Env ids: SHORT and uniqueness lives in the SERVICE id (not the
      // env id) so the uppercased env labels stay narrow. Swim-lane
      // layout in spa-visual-invariants.spec.ts asserts no env-tag
      // overlaps an unrelated box — long env labels (e.g. carrying the
      // suffix) trigger spurious swim-lane overlap failures in that
      // pre-existing suite. Per-service env ids are scoped to the
      // service in the wire contract, so two test runs sharing the
      // same env id never collide.
      //
      // Position-0/2 share equal-width labels (DEV / PROD) — the
      // assertion is non-vacuous because the env-tag column at every
      // position is still measured. Position-1 carries the width
      // variation that exercises the directive: QA (2 chars) vs
      // QAHOTFIX (8 chars).
      const ENV_DEV = `dev`;
      const ENV_QA = `qa`;
      const ENV_QAHOTFIX = `qahotfix`;
      const ENV_PROD = `prod`;

      const apiContext = await playwrightRequest.newContext({
        baseURL: WRITE_BASE_URL,
        extraHTTPHeaders: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
      });

      // POST events in chain order so parent_deployments references
      // resolve. Two paths share dev + prod, fork at position-1:
      //   dev → qa → prod
      //   dev → qahotfix → prod
      const devId = `e2e-issue23-${suffix}-dev`;
      const qaId = `e2e-issue23-${suffix}-qa`;
      const qahotfixId = `e2e-issue23-${suffix}-qahotfix`;
      const prodId = `e2e-issue23-${suffix}-prod`;

      const posts = [
        buildDeploymentPayload({
          deployment_id: devId,
          service: SERVICE,
          environment: ENV_DEV,
          version: 'v0.1.0',
          status: 'success',
          run_url: `https://example.com/runs/issue23-${suffix}-dev`,
          run_number: 100001,
        }),
        buildDeploymentPayload({
          deployment_id: qaId,
          service: SERVICE,
          environment: ENV_QA,
          version: 'v0.1.0',
          status: 'success',
          run_url: `https://example.com/runs/issue23-${suffix}-qa`,
          run_number: 100002,
          parent_deployments: [devId],
        }),
        buildDeploymentPayload({
          deployment_id: qahotfixId,
          service: SERVICE,
          environment: ENV_QAHOTFIX,
          version: 'v0.1.1',
          status: 'success',
          run_url: `https://example.com/runs/issue23-${suffix}-qahotfix`,
          run_number: 100003,
          parent_deployments: [devId],
        }),
        buildDeploymentPayload({
          deployment_id: prodId,
          service: SERVICE,
          environment: ENV_PROD,
          version: 'v0.1.0',
          status: 'success',
          run_url: `https://example.com/runs/issue23-${suffix}-prod`,
          run_number: 100004,
          parent_deployments: [qaId, qahotfixId],
        }),
      ];
      for (const body of posts) {
        const r = await apiContext.post('/api/deployments', { data: body });
        const status = r.status();
        if (status !== 201 && status !== 409) {
          throw new Error(`POST /api/deployments returned ${status} for ${JSON.stringify(body)}: ${await r.text()}`);
        }
      }
      await apiContext.dispose();

      // ----- 2. Drive SPA: workflow-rows + view + expand-all -----
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      await page.getByTestId('layout-option-workflow-rows').click();
      await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', 'workflow-rows');

      await page.getByTestId(`view-option-${view}`).click();
      await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', view);

      const blockLocator = page.locator(`.svc-block[data-service="${SERVICE}"], .svc-block[data-service-row="${SERVICE}"]`);
      await expect(blockLocator.first(), `Ephemeral service '${SERVICE}' must render a .svc-block in workflow-rows layout.`).toBeVisible({ timeout: 15_000 });

      const expandBtn = page.getByTestId('workflow-rows-expand-all');
      const txt = (await expandBtn.textContent()) || '';
      if (/expand all/i.test(txt)) {
        await expandBtn.click();
      }

      // Two paint frames for the directive's rAF-debounced writes +
      // Angular's afterEveryRender hook to settle.
      await page.evaluate(() =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
      );

      // Wait for ≥ 2 .wf-row inside the ephemeral block.
      await page.waitForFunction(
        (svc) => {
          const block = document.querySelector(`.svc-block[data-service="${svc}"]`)
            || document.querySelector(`.svc-block[data-service-row="${svc}"]`);
          if (!block) return false;
          return block.querySelectorAll('.wf-row').length >= 2;
        },
        SERVICE,
        { timeout: 10_000 },
      );

      // Wait for the directive's --env-tag-col-N-width custom
      // properties to land on the host. The Angular directive uses a
      // queueMicrotask -> rAF chain triggered by MutationObserver +
      // ResizeObserver; we poll for at least --env-tag-col-0-width.
      await page.waitForFunction(
        (svc) => {
          const block = document.querySelector(`.svc-block[data-service="${svc}"]`)
            || document.querySelector(`.svc-block[data-service-row="${svc}"]`);
          if (!block) return false;
          return (block as HTMLElement).style.getPropertyValue('--env-tag-col-0-width') !== '';
        },
        SERVICE,
        { timeout: 10_000 },
      );

      // A few extra paint frames to absorb the rAF-debounced tail.
      await page.evaluate(() =>
        new Promise<void>((r) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => r()),
              ),
            ),
          ),
        ),
      );

      // ----- 3. Measure per-position alignment -----
      const result = (await page.evaluate(buildAlignmentEvaluator(SERVICE))) as
        | { reports: AlignmentReport[] }
        | { error: string };

      if ('error' in result) {
        throw new Error(`Alignment evaluator failed: ${result.error}`);
      }
      const reports = result.reports;

      // Sanity: at least one multi-row position must exist (else we're
      // measuring a single-path service and the assertion is vacuous).
      const multiRowGroups = reports.filter((r) => r.rowCount >= 2);
      expect.soft(multiRowGroups.length, `Ephemeral '${SERVICE}' must expose >= 1 multi-row alignment group in workflow-rows (got ${multiRowGroups.length}). Reports: ${JSON.stringify(reports)}`).toBeGreaterThan(0);

      // ----- 4. Assert the directive's contract: column-1 width equality -----
      const col1Violators = multiRowGroups
        .filter((r) => r.col1WidthSpreadPx > TOLERANCE_PX)
        .map((r) => ({
          position: r.position,
          rowCount: r.rowCount,
          hostVar: r.hostVar,
          col1WidthSpreadPx: r.col1WidthSpreadPx,
          col1WidthsPx: r.col1WidthsPx,
          perPair: r.perPair,
        }));

      expect(
        col1Violators,
        `view='${view}' x layout='workflow-rows' — env-tag COLUMN-1 WIDTH equality (Variant A directive's direct contract): ` +
          `${col1Violators.length} position(s) in .svc-block[data-service="${SERVICE}"] exceeded the ${TOLERANCE_PX} px tolerance. ` +
          `Each entry lists the computed column-1 grid track width of every .leaf-pair[data-env-position=N] in that group; ` +
          `the EnvTagColumnWidthDirective is supposed to write per-position '--env-tag-col-N-width' onto the .svc-block so column-1 of every ` +
          `same-position .leaf-pair matches within ${TOLERANCE_PX} px.\n` +
          JSON.stringify(col1Violators, null, 2),
      ).toEqual([]);

      // ----- 5. Diagnostic surfacing — pair.left + tag.right spreads -----
      // Logged but NOT asserted; see header comment "Why column-1-width,
      // not .leaf-pair.left". The downstream spread, when present, is
      // the orthogonal column-2 max-content effect, not an issue-23
      // regression. The ephemeral fixture's box content is uniform
      // across rows (same status / version-width), so under normal
      // operation these spreads ARE ≤ 0.5 px — surfacing them in the
      // log lets us spot any future regression at the user-visible
      // level (e.g. someone adds a per-row attribute that varies in
      // width).
      const downstreamHotspots = multiRowGroups
        .filter((r) => r.pairLeftSpreadPx > TOLERANCE_PX || r.tagRightSpreadPx > TOLERANCE_PX)
        .map((r) => ({
          position: r.position,
          rowCount: r.rowCount,
          pairLeftSpreadPx: r.pairLeftSpreadPx,
          tagRightSpreadPx: r.tagRightSpreadPx,
          pairLefts: r.pairLefts,
          tagRights: r.tagRights,
          col1WidthsPx: r.col1WidthsPx,
        }));
      if (downstreamHotspots.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[issue-23][diagnostic] view='${view}' x layout='workflow-rows' (SPA): ` +
            `${downstreamHotspots.length} group(s) show > ${TOLERANCE_PX} px ` +
            `downstream X-position spread (.leaf-pair.left and/or env-tag.right). ` +
            `The directive contract IS satisfied (col1WidthsPx uniform); this is the ` +
            `orthogonal max-content box-column effect.\n` +
            JSON.stringify(downstreamHotspots, null, 2),
        );
      }
    });
  }
});
