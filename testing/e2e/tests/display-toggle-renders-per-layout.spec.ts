// Implements testing/e2e/scenarios/display-toggle-renders-per-layout.md
//
// Regression gate for issue #83 P1 regression: commit 284461e ported
// swim-lane-detailed from the mockup's static structure and silently
// dropped DeploymentMatrixStore reactivity. The Display picker
// (attribute-picker) writes to the store; the layout component must
// consume store.attrs() reactively and re-render nodes accordingly.
//
// This spec asserts the DOM-level consequence: toggling an attribute
// makes the per-slot anchor appear/disappear in the rendered matrix
// for EVERY (layout x view) combination in the MVP set.
//
// MVP active layouts: swim-lane, workflow-rows.
// Views exercised:
//   - detailed (most attributes; pick `sha` since it is off by default)
//   - compact  (cap 5; toggling `ref` from unchecked to checked at 4/5)
//   - glance   (cap 1; picking `ref` replaces `version`)
//   - focus    (cap 5; same shape as compact)
//
// Citations:
//   - docs/architecture.md §4 FR-02 — seven-attribute vocabulary
//   - docs/architecture.md §4 FR-12 — per-view caps
//   - docs/architecture.md §7 "Layout views" — layout components must
//     consume store.attrs() reactively, not statically mirror the mockup.
//   - testing/e2e/scenarios/attribute-picker-cap-enforcement.md — cap table.

import { test, expect, type Page } from '@playwright/test';

type Layout = 'swim-lane' | 'workflow-rows';
type ViewId = 'detailed' | 'compact' | 'glance' | 'focus';

// A service + environment whose slot is known to carry a `ref` value in
// the fixture corpus (testing/fixtures/seed-data.json).
const REF_FIXTURE = { service: 'service-b', env: 'dev' } as const;
// A service + environment whose slot carries a `sha` value.
const SHA_FIXTURE = { service: 'service-b', env: 'dev' } as const;
// A service + environment whose slot carries a `version` value (used for
// the Glance swap-ref-for-version test).
const VERSION_FIXTURE = { service: 'service-b', env: 'dev' } as const;

const LAYOUTS: Layout[] = ['swim-lane', 'workflow-rows'];

async function freshPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
}

async function switchView(page: Page, view: ViewId): Promise<void> {
  await page.getByTestId(`view-option-${view}`).click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', view);
}

async function switchLayout(page: Page, layout: Layout): Promise<void> {
  await page.getByTestId(`layout-option-${layout}`).click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', layout);
}

async function openPicker(page: Page): Promise<void> {
  await page.getByTestId('attribute-picker').click();
  // The popover is visible when open.
  await expect(page.getByTestId('picker-popover')).toBeVisible();
}

async function closePicker(page: Page): Promise<void> {
  // Click the attribute-picker button again to toggle the popover closed.
  await page.getByTestId('attribute-picker').click();
  // The popover element is removed from the DOM when closed.
  await expect(page.getByTestId('picker-popover')).toHaveCount(0);
}

test.describe('Display toggle — per-slot render anchor appears/disappears in all layouts', () => {
  // -----------------------------------------------------------------------
  // Detailed view: sha is off by default (5/7 = status version run ago actor).
  // Checking sha must cause current-sha-<svc>-<env> to appear in the
  // rendered matrix (both layouts). Unchecking must make it disappear.
  // -----------------------------------------------------------------------
  for (const layout of LAYOUTS) {
    test(`Detailed x ${layout}: checking 'sha' renders per-slot anchor; unchecking removes it`, async ({ page }) => {
      await freshPage(page);
      await switchLayout(page, layout);
      // Detailed is the default view — no view switch needed.

      const anchorTestid = `current-sha-${SHA_FIXTURE.service}-${SHA_FIXTURE.env}`;
      const anchor = page.getByTestId(anchorTestid);

      // Pre-condition: sha is not selected by default → anchor absent.
      await expect(anchor).toHaveCount(0);

      // Open picker, enable sha.
      await openPicker(page);
      await page.getByTestId('attr-checkbox-sha').check();
      await expect(page.getByTestId('picker-counter')).toHaveText('6/7');
      await closePicker(page);

      // Anchor must now appear in the rendered matrix node (FR-02 + FR-12
      // reactivity contract).
      await expect(
        anchor,
        `${layout} x detailed: current-sha anchor must be visible after enabling sha in the picker`,
      ).toBeVisible();

      // Verify the anchor contains non-empty text (positive control so we
      // know the node re-rendered, not just that an empty element appeared).
      const shaText = (await anchor.textContent()) ?? '';
      expect(
        shaText.trim().length,
        `${layout} x detailed: sha anchor must contain non-empty text`,
      ).toBeGreaterThan(0);

      // Uncheck sha — anchor must disappear.
      await openPicker(page);
      await page.getByTestId('attr-checkbox-sha').uncheck();
      await expect(page.getByTestId('picker-counter')).toHaveText('5/7');
      await closePicker(page);

      await expect(
        anchor,
        `${layout} x detailed: current-sha anchor must disappear after unchecking sha in the picker`,
      ).toHaveCount(0);
    });

    // -----------------------------------------------------------------------
    // Detailed view: enabling `ref` renders the value from the fixture verbatim.
    // Verifies the layout-component's template binding re-renders attribute
    // content (not just presence) — this is the exact shape the P1 regression
    // broke (the template was static, ignoring store.attrs()).
    // -----------------------------------------------------------------------
    test(`Detailed x ${layout}: 'ref' renders fixture value verbatim after toggling on`, async ({ page }) => {
      await freshPage(page);
      await switchLayout(page, layout);

      await openPicker(page);
      await page.getByTestId('attr-checkbox-ref').check();
      await closePicker(page);

      // service-b/dev carries ref="main" per testing/fixtures/seed-data.json.
      await expect(
        page.getByTestId(`current-ref-${REF_FIXTURE.service}-${REF_FIXTURE.env}`),
        `${layout} x detailed: ref anchor must contain the fixture value "main"`,
      ).toHaveText('main');
    });

    // -----------------------------------------------------------------------
    // Compact view: default is 4/5 (status version run ago). Enabling `ref`
    // renders the ref anchor; disabling removes it.
    // -----------------------------------------------------------------------
    test(`Compact x ${layout}: enabling 'ref' renders anchor; disabling removes it`, async ({ page }) => {
      await freshPage(page);
      await switchLayout(page, layout);
      await switchView(page, 'compact');

      const anchorTestid = `current-ref-${REF_FIXTURE.service}-${REF_FIXTURE.env}`;
      const anchor = page.getByTestId(anchorTestid);

      // Default compact: 4/5 — ref not selected.
      await expect(anchor).toHaveCount(0);

      await openPicker(page);
      await expect(page.getByTestId('picker-counter')).toHaveText('4/5');
      await page.getByTestId('attr-checkbox-ref').check();
      await expect(page.getByTestId('picker-counter')).toHaveText('5/5');
      await closePicker(page);

      await expect(
        anchor,
        `${layout} x compact: ref anchor must appear after enabling ref in compact picker`,
      ).toBeVisible();

      // Disable ref → anchor disappears.
      await openPicker(page);
      await page.getByTestId('attr-checkbox-ref').uncheck();
      await expect(page.getByTestId('picker-counter')).toHaveText('4/5');
      await closePicker(page);

      await expect(
        anchor,
        `${layout} x compact: ref anchor must disappear after unchecking ref`,
      ).toHaveCount(0);
    });

    // -----------------------------------------------------------------------
    // Glance view: cap 1, default `version`. Unchecking version + checking ref
    // must make the ref anchor appear and the version anchor disappear.
    // -----------------------------------------------------------------------
    test(`Glance x ${layout}: swapping 'version' for 'ref' re-renders the correct attribute`, async ({ page }) => {
      await freshPage(page);
      await switchLayout(page, layout);
      await switchView(page, 'glance');

      const versionAnchor = page.getByTestId(
        `current-version-${VERSION_FIXTURE.service}-${VERSION_FIXTURE.env}`,
      );
      const refAnchor = page.getByTestId(
        `current-ref-${REF_FIXTURE.service}-${REF_FIXTURE.env}`,
      );

      // Default glance: version is rendered; ref is not.
      await expect(versionAnchor).toBeVisible();
      await expect(refAnchor).toHaveCount(0);

      // Swap version for ref (order matters at cap 1: uncheck first).
      await openPicker(page);
      await expect(page.getByTestId('picker-counter')).toHaveText('1/1');
      await page.getByTestId('attr-checkbox-version').uncheck();
      await expect(page.getByTestId('picker-counter')).toHaveText('0/1');
      await page.getByTestId('attr-checkbox-ref').check();
      await expect(page.getByTestId('picker-counter')).toHaveText('1/1');
      await closePicker(page);

      // After the swap: version anchor gone, ref anchor present.
      await expect(
        versionAnchor,
        `${layout} x glance: version anchor must disappear after swapping to ref`,
      ).toHaveCount(0);
      await expect(
        refAnchor,
        `${layout} x glance: ref anchor must appear after swapping from version`,
      ).toBeVisible();
    });

    // -----------------------------------------------------------------------
    // Focus view: cap 5, default 4/5 (status version run ago). Enabling `sha`
    // renders the sha anchor. Focus is the view the P1 regression targeted
    // (swim-lane × focus lost reactivity alongside detailed in 284461e).
    // -----------------------------------------------------------------------
    test(`Focus x ${layout}: enabling 'sha' renders anchor in collapsed Focus lanes`, async ({ page }) => {
      await freshPage(page);
      await switchLayout(page, layout);
      await switchView(page, 'focus');

      const anchorTestid = `current-sha-${SHA_FIXTURE.service}-${SHA_FIXTURE.env}`;
      const anchor = page.getByTestId(anchorTestid);

      // Default focus 4/5 — sha not selected.
      await expect(anchor).toHaveCount(0);

      await openPicker(page);
      await expect(page.getByTestId('picker-counter')).toHaveText('4/5');
      await page.getByTestId('attr-checkbox-sha').check();
      await expect(page.getByTestId('picker-counter')).toHaveText('5/5');
      await closePicker(page);

      await expect(
        anchor,
        `${layout} x focus: sha anchor must appear in collapsed Focus lanes after enabling sha`,
      ).toBeVisible();
    });
  }
});
