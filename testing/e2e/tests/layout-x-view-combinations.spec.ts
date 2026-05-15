// Implements testing/e2e/scenarios/layout-x-view-combinations.md
//
// Iterates the 12 (view, layout) combinations and asserts that each
// one renders cleanly: matrix mounts, data-view/data-layout markers
// agree with the selection, at least one stage box is present, and
// no console errors fired during rendering. The combination matrix
// is declarative below — adding a new view or layout means adding
// to those constants, not editing the test body.

import { test, expect, type ConsoleMessage } from '@playwright/test';

const VIEWS = ['detailed', 'compact', 'glance', 'focus'] as const;
const LAYOUTS = ['matrix', 'swim-lane', 'workflow-rows'] as const;

// Known-harmless console errors to filter out. Keep this list narrow
// and document why each entry is excluded; never paper over real bugs.
const CONSOLE_ERROR_EXCLUDES: readonly RegExp[] = [
  // Add entries here only with an inline justification when one is
  // discovered. Empty list = strict mode.
];

function shouldIgnore(message: string): boolean {
  return CONSOLE_ERROR_EXCLUDES.some((re) => re.test(message));
}

test.describe('Every (view, layout) combination renders without console errors', () => {
  for (const view of VIEWS) {
    for (const layout of LAYOUTS) {
      test(`view=${view} x layout=${layout}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (msg: ConsoleMessage) => {
          if (msg.type() === 'error') {
            const text = msg.text();
            if (!shouldIgnore(text)) errors.push(text);
          }
        });
        page.on('pageerror', (err) => {
          const text = err.message;
          if (!shouldIgnore(text)) errors.push(text);
        });

        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        // Pick view, then layout. Both selectors are documented in
        // SAD §7 and frontend-engineer exposes them via data-testid.
        await page.getByTestId(`view-option-${view}`).click();
        await page.getByTestId(`layout-option-${layout}`).click();

        await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
        await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', view);
        await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', layout);

        // At least one stage box must be rendered - guards against a
        // matrix mount that renders the chrome but no rows / pills.
        const stageBoxes = page.locator("[data-testid^='stage-box-']");
        await expect(stageBoxes.first()).toBeVisible();

        // Give the layout a paint frame to finish before snapshotting
        // console errors - this catches any deferred render-pass error.
        await page.evaluate(
          () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );

        expect(
          errors,
          `(${view} x ${layout}) emitted ${errors.length} console error(s):\n${errors.join('\n')}`,
        ).toEqual([]);
      });
    }
  }
});
