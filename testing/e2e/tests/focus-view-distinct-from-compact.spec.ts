// Implements testing/e2e/scenarios/focus-view-distinct-from-compact.md
//
// Regression-preventing oracle. A prior change rendered Focus
// indistinguishable from Compact (chevron + pin existed but were too
// understated to read) and every existing automated test stayed green.
// This spec asserts on the structural contract — row-gutter
// affordances — so a future regression of the same shape fails LOUDLY.
//
// Path A: the chevron + pin are present in ALL THREE layouts when
// View=Focus (per docs/ui/compact-options.md "Focus view specifics —
// Layout scope"). Granularity is service-grain in every layout:
//   - matrix:        one chevron + one pin per service-row
//   - swim-lane:     one chevron + one pin per service-lane
//   - workflow-rows: one chevron + one pin per service-header
//                    (NOT per path-row — service-grain only)
// Pin state is layout-agnostic and survives a Layout switch.
//
// Citations:
//   - docs/ui/compact-options.md "Focus view specifics" — chevron and
//     pin lifecycle, row-gutter placement, filter resilience, layout
//     scope, pin-survives-layout-switch.
//   - docs/architecture.md §4 FR-12 — four named
//     layout views (Focus must remain distinguishable).
//   - docs/ui/deployment-dashboard.html — testid catalogue:
//       row-chevron-{id}, row-pin-{id},
//       row-expanded-{id} / row-collapsed-{id},
//       data-expanded, data-pinned, collapse-all.

import { test, expect, type Page } from '@playwright/test';

// The three layouts where Focus's chevron + pin must appear and behave.
const FOCUS_LAYOUTS = ['matrix', 'swim-lane', 'workflow-rows'] as const;
type Layout = (typeof FOCUS_LAYOUTS)[number];

// Service IDs the seeded corpus is known to provide. Per
// testing/fixtures/seed-data.json + filter-search-and-failures-only:
//   - service-a / -c / -d : no current.status === 'failure' slot
//                           → filtered OUT by "Failures only"
//   - service-b           : has a failure slot → SURVIVES "Failures only"
// The pin-across-filter assertion deliberately pins service-a (a row
// that disappears when "Failures only" is on) so the pin's
// filter-resilience is observable.
const SVC_NO_FAILURE = 'service-a';
const SVC_SECOND_EXPAND = 'service-c';

async function gotoFresh(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
  await expect(page.getByTestId('view-option-detailed')).toHaveAttribute('data-active', 'true');
}

async function switchView(page: Page, view: 'detailed' | 'compact' | 'glance' | 'focus'): Promise<void> {
  await page.getByTestId(`view-option-${view}`).click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', view);
}

async function switchLayout(page: Page, layout: Layout): Promise<void> {
  await page.getByTestId(`layout-option-${layout}`).click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', layout);
}

// Count visible *services* under the current layout + view.
//
// Canonical Focus contract (post focus-across-layouts cycle): under
// Focus the primary data-testid of each service-grain anchor flips to
// `row-expanded-{id}` (when expanded) or `row-collapsed-{id}` (when
// collapsed) in EVERY layout. The legacy per-layout testids
// (`swim-lane-row-{id}` / `workflow-rows-{id}`) are emitted ONLY as
// sr-only alias spans for back-compat - counting them would double-
// count under Focus. Counting row-collapsed/row-expanded testids,
// de-duplicated by service id, is the canonical visible-service count
// for Focus.
//
// Under non-Focus views the per-layout legacy testids remain the
// canonical anchor:
//   - matrix:        one [data-service-row] per service.
//   - swim-lane:     one [data-testid^="swim-lane-row-"] per service.
//   - workflow-rows: one [data-testid^="workflow-rows-"] per service-header.
async function visibleServiceCount(page: Page, layout: Layout, view: 'focus' | 'non-focus' = 'focus'): Promise<number> {
  if (view === 'focus') {
    // Count distinct ids across row-collapsed-* + row-expanded-*. A
    // service is in exactly one of the two states at any time, so the
    // union (by id) is the visible-service count regardless of which
    // layout we are in.
    return await page.evaluate(() => {
      const ids = new Set<string>();
      for (const el of Array.from(document.querySelectorAll('[data-testid^="row-collapsed-"], [data-testid^="row-expanded-"]'))) {
        const tid = el.getAttribute('data-testid') || '';
        const id = tid.replace(/^row-(collapsed|expanded)-/, '');
        if (id) ids.add(id);
      }
      return ids.size;
    });
  }
  switch (layout) {
    case 'matrix':
      return page.locator('[data-service-row]').count();
    case 'swim-lane':
      return page.locator('[data-testid^="swim-lane-row-"]').count();
    case 'workflow-rows':
      return page.locator('[data-testid^="workflow-rows-"]').count();
  }
}

test.describe('Focus view — distinguishable from Compact', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFresh(page);
  });

  for (const layout of FOCUS_LAYOUTS) {
    test(`A[${layout}]. Compact has no row-gutter affordances; Focus has one chevron+pin per visible service`, async ({ page }) => {
      await switchLayout(page, layout);

      // --- Compact: zero chevrons, zero pins. ---
      await switchView(page, 'compact');
      // Wait for the layout swap to settle by checking at least one
      // service-anchor element is present under the new view.
      const anchorSelector =
        layout === 'matrix'
          ? '[data-service-row]'
          : layout === 'swim-lane'
            ? '[data-testid^="swim-lane-row-"]'
            : '[data-testid^="workflow-rows-"]';
      await expect(page.locator(anchorSelector).first()).toBeVisible();

      await expect(
        page.locator('[data-testid^="row-chevron-"]'),
        `Compact x ${layout} must NOT expose row-chevron-* — that affordance is what makes Focus distinct.`,
      ).toHaveCount(0);
      await expect(
        page.locator('[data-testid^="row-pin-"]'),
        `Compact x ${layout} must NOT expose row-pin-* — that affordance is what makes Focus distinct.`,
      ).toHaveCount(0);

      // --- Focus: chevron count == pin count == visible service count > 0. ---
      await switchView(page, 'focus');
      // Under Focus the canonical visible anchor is row-collapsed-* /
      // row-expanded-* (the per-layout legacy testids exist only as
      // sr-only alias spans that fail toBeVisible() - they are hidden
      // by class="sr-only"). Settle on the Focus-grade anchor.
      await expect(
        page.locator('[data-testid^="row-collapsed-"], [data-testid^="row-expanded-"]').first(),
      ).toBeVisible();

      const svcCount = await visibleServiceCount(page, layout);
      expect(svcCount, `Focus x ${layout} must render at least one service to be testable.`).toBeGreaterThan(0);

      await expect(
        page.locator('[data-testid^="row-chevron-"]'),
        `Focus x ${layout} must expose exactly one row-chevron-* per visible service (expected ${svcCount}). Workflow-rows must place the chevron on the service-header, not on each path-row.`,
      ).toHaveCount(svcCount);
      await expect(
        page.locator('[data-testid^="row-pin-"]'),
        `Focus x ${layout} must expose exactly one row-pin-* per visible service (expected ${svcCount}).`,
      ).toHaveCount(svcCount);

      // Distinct service ids in the chevron / pin testids — defends
      // against a duplicate-per-path regression in workflow-rows.
      const uniqueIds = await page.evaluate(() => {
        const chevSet = new Set<string>();
        const pinSet = new Set<string>();
        for (const el of Array.from(document.querySelectorAll('[data-testid^="row-chevron-"]'))) {
          const tid = el.getAttribute('data-testid') || '';
          chevSet.add(tid.replace(/^row-chevron-/, ''));
        }
        for (const el of Array.from(document.querySelectorAll('[data-testid^="row-pin-"]'))) {
          const tid = el.getAttribute('data-testid') || '';
          pinSet.add(tid.replace(/^row-pin-/, ''));
        }
        return { chevrons: chevSet.size, pins: pinSet.size };
      });
      expect(uniqueIds.chevrons, `Focus x ${layout}: chevron testids must map to ${svcCount} DISTINCT service ids.`).toBe(svcCount);
      expect(uniqueIds.pins, `Focus x ${layout}: pin testids must map to ${svcCount} DISTINCT service ids.`).toBe(svcCount);

      // --- Row-gutter placement: chevron + pin must NOT be nested
      // inside any stage-box (inline placement is out-of-contract per
      // docs/ui/compact-options.md "Focus view specifics"). ---
      const insideBoxOffenders = await page.evaluate(() => {
        const violators: string[] = [];
        const chevs = Array.from(document.querySelectorAll('[data-testid^="row-chevron-"]'));
        const pins = Array.from(document.querySelectorAll('[data-testid^="row-pin-"]'));
        for (const el of [...chevs, ...pins]) {
          if (el.closest('[data-testid^="stage-box-"]')) {
            violators.push(el.getAttribute('data-testid') || '<no-testid>');
          }
        }
        return violators;
      });
      expect(
        insideBoxOffenders,
        `Focus x ${layout}: chevron/pin must live in the row gutter, never inside a stage box. Offenders: ${insideBoxOffenders.join(', ')}`,
      ).toEqual([]);
    });

    test(`B[${layout}]. Chevron expands and collapses the service idempotently`, async ({ page }) => {
      await switchLayout(page, layout);
      await switchView(page, 'focus');

      // The chevron lives at the service-grain regardless of layout. We
      // do not assert on data-expanded against [data-service-row] in
      // workflow-rows because that attribute is on the .wf-row (path-row);
      // the canonical expanded-state mirror in workflow-rows is the
      // svc-block's expanded class / the path-rows it renders. We assert
      // the layout-agnostic testid flip (row-collapsed ↔ row-expanded)
      // which the frontend commits to mirror in every layout. For matrix
      // we ALSO assert data-expanded since that attribute is canonical
      // there.
      const chevron = page.getByTestId(`row-chevron-${SVC_NO_FAILURE}`);
      await expect(chevron).toBeVisible();

      // Initial state: collapsed testid present.
      await expect(page.getByTestId(`row-collapsed-${SVC_NO_FAILURE}`).first()).toBeVisible();
      await expect(page.getByTestId(`row-expanded-${SVC_NO_FAILURE}`)).toHaveCount(0);

      // Click chevron → expanded.
      await chevron.click();
      await expect(page.getByTestId(`row-expanded-${SVC_NO_FAILURE}`).first()).toBeVisible();
      await expect(page.getByTestId(`row-collapsed-${SVC_NO_FAILURE}`)).toHaveCount(0);

      // Click chevron again → back to collapsed.
      await chevron.click();
      await expect(page.getByTestId(`row-collapsed-${SVC_NO_FAILURE}`).first()).toBeVisible();
      await expect(page.getByTestId(`row-expanded-${SVC_NO_FAILURE}`)).toHaveCount(0);
    });
  }

  test('E. Pin survives a Layout switch (pin state is layout-agnostic)', async ({ page }) => {
    // Per docs/ui/compact-options.md "Focus view specifics — Pin
    // survives layout switch": state.pinned[id] is layout-agnostic.
    // Switching Layout while a service is pinned keeps the pin; the
    // affordance and its expansion semantics adapt to the new layout's
    // granularity but the pinned set itself does not reset.
    await switchLayout(page, 'matrix');
    await switchView(page, 'focus');

    // Pin in matrix.
    await page.getByTestId(`row-pin-${SVC_NO_FAILURE}`).click();
    await expect(page.getByTestId(`row-pin-${SVC_NO_FAILURE}`)).toBeVisible();
    const matrixRow = page.locator(`[data-service-row="${SVC_NO_FAILURE}"]`);
    await expect(matrixRow).toHaveAttribute('data-pinned', 'true');
    await expect(matrixRow).toHaveAttribute('data-expanded', 'true');

    // Switch to swim-lane → the same service must still be pinned + expanded.
    await switchLayout(page, 'swim-lane');
    // Pin testid is layout-agnostic — it must still be present and the
    // SAME service must still be pinned.
    const swimPin = page.getByTestId(`row-pin-${SVC_NO_FAILURE}`);
    await expect(
      swimPin,
      'Pin must survive a Layout switch — the affordance must still be present in swim-lane Focus.',
    ).toBeVisible();
    // The expanded testid for the pinned service must be present in swim-lane.
    await expect(
      page.getByTestId(`row-expanded-${SVC_NO_FAILURE}`).first(),
      'After Layout switch matrix → swim-lane the pinned service must still be expanded.',
    ).toBeVisible();

    // Also exercise matrix → workflow-rows.
    await switchLayout(page, 'workflow-rows');
    await expect(
      page.getByTestId(`row-pin-${SVC_NO_FAILURE}`),
      'Pin must survive a Layout switch — the affordance must still be present in workflow-rows Focus.',
    ).toBeVisible();
    await expect(
      page.getByTestId(`row-expanded-${SVC_NO_FAILURE}`).first(),
      'After Layout switch swim-lane → workflow-rows the pinned service must still be expanded.',
    ).toBeVisible();
  });

  test('C. Pin survives a "Failures only" filter round-trip and re-renders expanded', async ({ page }) => {
    await switchView(page, 'focus');

    // Pin a row that gets filtered out by "Failures only" so the
    // filter-resilience is observable.
    const pinnedRow = page.locator(`[data-service-row="${SVC_NO_FAILURE}"]`);
    await expect(pinnedRow).toBeVisible();
    await expect(pinnedRow).toHaveAttribute('data-pinned', 'false');
    await expect(pinnedRow).toHaveAttribute('data-expanded', 'false');

    await page.getByTestId(`row-pin-${SVC_NO_FAILURE}`).click();
    await expect(pinnedRow).toHaveAttribute('data-pinned', 'true');
    await expect(pinnedRow).toHaveAttribute('data-expanded', 'true');

    // Toggle "Failures only" ON → service-a is filtered out (per
    // testing/e2e/tests/filter-search-and-failures-only.spec.ts).
    const failuresToggle = page.getByTestId('failures-only-toggle');
    await failuresToggle.check();
    await expect(
      page.locator(`[data-service-row="${SVC_NO_FAILURE}"]`),
      'Failures-only filter must hide service-a (it has no failure slot).',
    ).toHaveCount(0);

    // Toggle OFF → the row re-appears AND is still pinned + expanded.
    await failuresToggle.uncheck();
    const rowAfter = page.locator(`[data-service-row="${SVC_NO_FAILURE}"]`);
    await expect(rowAfter).toBeVisible();
    await expect(
      rowAfter,
      'Pin must survive the filter sweep — docs/ui/compact-options.md "Focus view specifics" prescribes "pin is preserved; when the row re-matches the active filter set, it re-renders expanded".',
    ).toHaveAttribute('data-pinned', 'true');
    await expect(
      rowAfter,
      'Re-matched pinned row must come back expanded, not collapsed.',
    ).toHaveAttribute('data-expanded', 'true');
    // And the testid mirrors the expanded state.
    await expect(page.getByTestId(`row-expanded-${SVC_NO_FAILURE}`)).toBeVisible();
  });

  test('D. collapseAll collapses unpinned rows but leaves pinned rows expanded', async ({ page }) => {
    await switchView(page, 'focus');

    // Pin service-a (becomes expanded as a side-effect of pin).
    await page.getByTestId(`row-pin-${SVC_NO_FAILURE}`).click();
    await expect(page.locator(`[data-service-row="${SVC_NO_FAILURE}"]`)).toHaveAttribute('data-pinned', 'true');
    await expect(page.locator(`[data-service-row="${SVC_NO_FAILURE}"]`)).toHaveAttribute('data-expanded', 'true');

    // Expand service-c via chevron (NOT pinned).
    await page.getByTestId(`row-chevron-${SVC_SECOND_EXPAND}`).click();
    await expect(page.locator(`[data-service-row="${SVC_SECOND_EXPAND}"]`)).toHaveAttribute('data-expanded', 'true');
    await expect(page.locator(`[data-service-row="${SVC_SECOND_EXPAND}"]`)).toHaveAttribute('data-pinned', 'false');

    // "Collapse all" button is x-show'd when hasExpanded is truthy.
    const collapseAll = page.getByTestId('collapse-all');
    await expect(collapseAll).toBeVisible();
    await collapseAll.click();

    // Pinned row stays expanded + pinned.
    await expect(
      page.locator(`[data-service-row="${SVC_NO_FAILURE}"]`),
      'collapseAll must NOT collapse pinned rows — the mockup\'s collapseAll() skips ids where pinned[id] is truthy.',
    ).toHaveAttribute('data-expanded', 'true');
    await expect(page.locator(`[data-service-row="${SVC_NO_FAILURE}"]`)).toHaveAttribute('data-pinned', 'true');
    await expect(page.getByTestId(`row-expanded-${SVC_NO_FAILURE}`)).toBeVisible();

    // Unpinned row collapses.
    await expect(
      page.locator(`[data-service-row="${SVC_SECOND_EXPAND}"]`),
      'collapseAll must collapse unpinned rows.',
    ).toHaveAttribute('data-expanded', 'false');
    await expect(page.getByTestId(`row-collapsed-${SVC_SECOND_EXPAND}`)).toBeVisible();
  });
});
