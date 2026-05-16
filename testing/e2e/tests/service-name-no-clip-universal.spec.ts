// Implements testing/e2e/scenarios/service-name-no-clip-universal.md
//
// User-reported defect: in Workflow-rows under some configurations
// the service name clipped with text-overflow:ellipsis. This oracle
// catches a future regression of the same shape across every View x
// Layout x Theme combination (4 x 3 x 2 = 24).
//
// Strategy:
//   1. Inject a deliberately long service name (32 chars) into the
//      live Alpine state. This stresses the column regardless of how
//      narrow the seeded corpus's names are.
//   2. For each (view, layout, theme), navigate to the corresponding
//      service's name element in the layout's DOM site and assert
//      scrollWidth <= clientWidth + 1 (1-px sub-pixel tolerance
//      mirroring the I2 env-tag oracle).
//
// Citations:
//   - testing/e2e/scenarios/service-name-no-clip-universal.md
//   - docs/ui-compact-options.md "Focus view specifics"
//   - docs/deployment-dashboard-architecture.md §4 FR-12
//
// Drift note: as of the focus-across-layouts cycle the SPA emits a
// stable hook for the service-name element at every render site:
// data-testid='service-name-{svcId}'. This spec uses that single
// canonical selector across all (view x layout) combinations. If the
// hook is missing for some combination the test fails fast with a
// clear "selector did not match" message (not a silent zero-element
// pass).

import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';
import { API_KEY, WRITE_BASE_URL, buildDeploymentPayload } from './support/env';

const VIEWS = ['detailed', 'compact', 'glance', 'focus'] as const;
const LAYOUTS = ['matrix', 'swim-lane', 'workflow-rows'] as const;
const THEMES = ['light', 'dark'] as const;

type View = (typeof VIEWS)[number];
type Layout = (typeof LAYOUTS)[number];
type Theme = (typeof THEMES)[number];

// 32-char stress-test name. Service id and display name are the same
// string in the SPA's discovery flow (the Read API returns service ids
// from the deployments table and the SPA derives ServiceDescriptor
// where id === name). A 32-char id therefore produces a 32-char
// rendered name, which exceeds the 176-px service-label column under
// any default font - exactly the condition that exposes a clipped
// .truncate utility if one regressed.
const LONG_NAME = 'this-is-a-very-long-service-name';
const LONG_NAME_SVC_ID = LONG_NAME;

const SUBPIXEL_TOLERANCE = 1;
const SSE_WAIT_MS = 5_000;

async function gotoFresh(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
}

// Seed a stress-test service via the Write API. Idempotent across
// re-runs because the (service, environment) slot is upserted - re-
// POSTing the same payload returns 201 with the same row. The SPA
// receives the new row via SSE within NFR-03's 5 s budget; we wait on
// the canonical service-name testid to appear before measuring.
//
// Why the Write API instead of an in-page injection: the SPA owns its
// store and does not (and should not) expose a debug hook to mutate
// it from the page context. The Write API is the production-grade
// path; using it keeps the test honest about the contract the SPA
// actually consumes.
async function seedLongNameService(page: Page): Promise<void> {
  const ctx = await playwrightRequest.newContext({
    baseURL: WRITE_BASE_URL,
    extraHTTPHeaders: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  });
  try {
    const resp = await ctx.post('/api/deployments', {
      data: buildDeploymentPayload({
        service: LONG_NAME_SVC_ID,
        environment: 'dev',
        version: 'v1.0.0',
        status: 'success',
        run_url: 'https://example.test/runs/long-name',
        run_number: 1,
        // Stable deployment_id so re-runs are idempotent (the Write
        // API treats a duplicate deployment_id as already-stored).
        deployment_id: `e2e-longname-${LONG_NAME_SVC_ID}-dev-1`,
      }),
    });
    if (![201, 200, 409].includes(resp.status())) {
      throw new Error(`seedLongNameService: unexpected status ${resp.status()} - ${await resp.text()}`);
    }
  } finally {
    await ctx.dispose();
  }
  // Wait for the SPA to render the service-name element for the new
  // service. The element exists exactly once per render site; we wait
  // on the canonical testid (emitted at every site per the focus-
  // across-layouts cycle contract).
  await expect(page.locator(`[data-testid="service-name-${LONG_NAME_SVC_ID}"]`).first()).toBeVisible({ timeout: SSE_WAIT_MS });
}

async function switchView(page: Page, view: View): Promise<void> {
  await page.getByTestId(`view-option-${view}`).click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', view);
}

async function switchLayout(page: Page, layout: Layout): Promise<void> {
  await page.getByTestId(`layout-option-${layout}`).click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', layout);
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  // Open the theme switcher, click the radio for the target theme.
  // We avoid asserting on internal data-active markers — clicking the
  // option is the user-facing contract.
  await page.getByTestId('theme-gear').click();
  await page.getByTestId(`theme-option-${theme}`).check();
  // Close the popover by clicking outside (Alpine @click.outside).
  await page.locator('header').click({ position: { x: 5, y: 5 } });
}

// Returns { scrollWidth, clientWidth, text } for the service-name
// element matching the given layout's DOM site. Throws if zero
// elements match (a selector drift, NOT a silent pass).
async function measureServiceName(
  page: Page,
  layout: Layout,
  svcId: string,
): Promise<{ scrollWidth: number; clientWidth: number; text: string }> {
  return await page.evaluate(
    ({ layout, svcId }) => {
      // Canonical selector: every render site (matrix detailed /
      // compact / glance / focus, swim-lane, workflow-rows) emits the
      // service-name element with data-testid="service-name-{svcId}".
      // The layout parameter is retained in the API for diagnostics
      // but no longer used for site-specific selection. If multiple
      // matches exist (a service rendered in multiple panels at the
      // same time), the first one is measured - all are subject to
      // the same column-width constraints.
      const el = document.querySelector(`[data-testid="service-name-${svcId}"]`);
      if (!el) {
        throw new Error(
          `service-name element not found for svc='${svcId}' in layout='${layout}'. ` +
            "Either the SPA failed to render the row under this (view x layout) combination, " +
            "or the service-name-{svcId} testid is missing at this render site - " +
            "the canonical contract requires it at every site.",
        );
      }
      const h = el as HTMLElement;
      return { scrollWidth: h.scrollWidth, clientWidth: h.clientWidth, text: (h.textContent || '').trim() };
    },
    { layout, svcId },
  );
}

test.describe('Service name renders without clipping across every View x Layout x Theme', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFresh(page);
    await seedLongNameService(page);
    // Give Angular one paint frame to settle after the SSE-driven
    // re-render.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
  });

  for (const view of VIEWS) {
    for (const layout of LAYOUTS) {
      for (const theme of THEMES) {
        test(`${view} x ${layout} x ${theme} — long service name renders fully`, async ({ page }) => {
          await switchLayout(page, layout);
          await switchView(page, view);
          await setTheme(page, theme);

          // One paint frame to settle theme transition + layout swap.
          await page.evaluate(
            () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
          );

          const { scrollWidth, clientWidth, text } = await measureServiceName(page, layout, LONG_NAME_SVC_ID);
          // Assertion: the rendered text content fits within the
          // element's content box (within the 1-px sub-pixel tolerance).
          // scrollWidth > clientWidth + 1 means the column is too narrow
          // and the text is actively clipped.
          expect(text, `Expected the injected long name '${LONG_NAME}' to be the rendered text.`).toBe(LONG_NAME);
          expect(
            scrollWidth - clientWidth,
            `Service name '${text}' is clipped in ${view} x ${layout} x ${theme}: scrollWidth(${scrollWidth}) > clientWidth(${clientWidth}) by ${scrollWidth - clientWidth} px. The column must widen (or the .truncate utility must drop) so the full service name renders.`,
          ).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
        });
      }
    }
  }
});
