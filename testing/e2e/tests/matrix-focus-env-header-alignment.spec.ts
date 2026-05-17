// Implements testing/e2e/scenarios/matrix-focus-env-header-alignment.md
//
// User-reported defect: in Matrix x Focus, when a row expands to
// --leaf-width-expanded (200 px), env-header cells no longer align
// with the widened deployment columns. The frontend is fixing the
// issue structurally; this oracle codifies the contract so a future
// regression of the same shape fails LOUDLY.
//
// Strategy (no mockup edits, no DOM coupling beyond data-testid):
//   1. Layout = matrix, View = focus.
//   2. Pre-expand: env-header cells align with the first row's
//      stage boxes by index (within 1 px on left + right).
//   3. Expand the first row via [data-testid^='row-chevron-'].
//   4. Post-expand: env-header cells align with the expanded row's
//      widened boxes AND with the collapsed row's boxes simultaneously.
//
// Citations:
//   - testing/e2e/scenarios/matrix-focus-env-header-alignment.md
//   - docs/ui/compact-options.md "Focus view specifics"

import { test, expect, type Page } from '@playwright/test';

const TOL_PX = 1;

async function gotoFresh(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
}

type RectPair = { left: number; right: number };

/**
 * Reads the env-header strip's per-env cell rects + the deployment-cell
 * rects of two service rows (one expanded, one collapsed). Returns
 * by-index parallel arrays so the caller can zip + assert.
 */
async function readRects(page: Page): Promise<{
  header: RectPair[];
  expandedRow: { svcId: string; boxes: RectPair[] } | null;
  collapsedRow: { svcId: string; boxes: RectPair[] } | null;
}> {
  return await page.evaluate(() => {
    function rect(el: Element): RectPair {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { left: r.left, right: r.right };
    }
    // Env-header cells: .text-center with inline width: var(--leaf-width)
    // that are NOT inside any [data-service-row] (those are per-row
    // chrome). We filter on the inline-style substring.
    const header: RectPair[] = Array.from(document.querySelectorAll('.text-center'))
      .filter((el) => (el as HTMLElement).getAttribute('style')?.includes('var(--leaf-width)'))
      .filter((el) => !el.closest('[data-service-row]'))
      .map(rect);

    const expandedRowEl = document.querySelector('[data-service-row][data-expanded="true"]');
    const collapsedRowEl = document.querySelector('[data-service-row][data-expanded="false"]');

    function readRowBoxes(row: Element | null): { svcId: string; boxes: RectPair[] } | null {
      if (!row) return null;
      const svcId = row.getAttribute('data-service-row') || '';
      const boxes = Array.from(row.querySelectorAll("[data-testid^='stage-box-']")).map(rect);
      return { svcId, boxes };
    }

    return {
      header,
      expandedRow: readRowBoxes(expandedRowEl),
      collapsedRow: readRowBoxes(collapsedRowEl),
    };
  });
}

function approxEqual(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

test.describe('Matrix Focus: env-header columns align with expanded + collapsed deployment columns', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFresh(page);
    await page.getByTestId('layout-option-matrix').click();
    await page.getByTestId('view-option-focus').click();
    await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', 'focus');
    await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', 'matrix');
  });

  test('Pre-expand: env-header aligns with collapsed deployment columns', async ({ page }) => {
    // Two paint frames to let the matrix settle.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    const r = await readRects(page);
    expect(r.header.length, 'Env-header strip must render at least one env cell.').toBeGreaterThan(0);
    expect(
      r.collapsedRow,
      'At least one collapsed row must exist pre-expand (no chevron was clicked).',
    ).not.toBeNull();
    const cells = r.collapsedRow!.boxes;
    expect(
      cells.length,
      `Collapsed row must have one stage-box per env (header has ${r.header.length}).`,
    ).toBe(r.header.length);

    for (let i = 0; i < r.header.length; i++) {
      const h = r.header[i];
      const b = cells[i];
      expect(
        approxEqual(h.left, b.left, TOL_PX),
        `Pre-expand env-header cell #${i} left=${h.left.toFixed(1)} does not align with collapsed row's box left=${b.left.toFixed(1)} (delta ${Math.abs(h.left - b.left).toFixed(1)} px > ${TOL_PX}).`,
      ).toBe(true);
      expect(
        approxEqual(h.right, b.right, TOL_PX),
        `Pre-expand env-header cell #${i} right=${h.right.toFixed(1)} does not align with collapsed row's box right=${b.right.toFixed(1)} (delta ${Math.abs(h.right - b.right).toFixed(1)} px > ${TOL_PX}).`,
      ).toBe(true);
    }
  });

  test('Post-expand: env-header aligns with BOTH expanded and collapsed rows simultaneously', async ({ page }) => {
    // Expand the FIRST row's chevron. We don't hard-code a service id —
    // the corpus order may shift; we click the first chevron in DOM
    // order.
    await page.locator('[data-testid^="row-chevron-"]').first().click();

    // Wait for the post-expand layout: at least one row must report
    // data-expanded="true". Use a polling expect.
    await expect(
      page.locator('[data-service-row][data-expanded="true"]'),
      'After clicking the first chevron, at least one row must report data-expanded="true".',
    ).toHaveCount(1);

    // Two paint frames for the width transition.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    const r = await readRects(page);
    expect(r.header.length, 'Env-header strip must still render at least one env cell.').toBeGreaterThan(0);
    expect(r.expandedRow, 'An expanded row must exist after clicking the chevron.').not.toBeNull();
    expect(r.collapsedRow, 'A collapsed row must STILL exist after expanding only the first.').not.toBeNull();

    // Sanity — expanded row's boxes should be visibly wider than the
    // collapsed row's boxes (--leaf-width-expanded vs --leaf-width).
    // If they are the same width the contract was broken in the OTHER
    // direction (no expansion happened). We assert a > 30 px delta on
    // box width as a fuzzy lower bound (200 vs 130-160 typical).
    const expandedW = r.expandedRow!.boxes[0].right - r.expandedRow!.boxes[0].left;
    const collapsedW = r.collapsedRow!.boxes[0].right - r.collapsedRow!.boxes[0].left;
    expect(
      expandedW - collapsedW,
      `Expanded row's first box width (${expandedW.toFixed(1)}) must be larger than collapsed row's (${collapsedW.toFixed(1)}) — --leaf-width-expanded should differ from --leaf-width.`,
    ).toBeGreaterThan(20);

    // Core assertion #1 — env-header aligns with EXPANDED row.
    expect(r.header.length).toBe(r.expandedRow!.boxes.length);
    for (let i = 0; i < r.header.length; i++) {
      const h = r.header[i];
      const b = r.expandedRow!.boxes[i];
      expect(
        approxEqual(h.left, b.left, TOL_PX),
        `Post-expand env-header cell #${i} left=${h.left.toFixed(1)} does not align with EXPANDED row's box left=${b.left.toFixed(1)} (delta ${Math.abs(h.left - b.left).toFixed(1)} px). The env-header is most likely still rendering at --leaf-width while the expanded row is at --leaf-width-expanded.`,
      ).toBe(true);
      expect(
        approxEqual(h.right, b.right, TOL_PX),
        `Post-expand env-header cell #${i} right=${h.right.toFixed(1)} does not align with EXPANDED row's box right=${b.right.toFixed(1)} (delta ${Math.abs(h.right - b.right).toFixed(1)} px).`,
      ).toBe(true);
    }

    // Core assertion #2 — env-header ALSO aligns with COLLAPSED row.
    // If #1 passes and #2 fails, the env-header switched to expanded
    // width but the collapsed row stayed narrow — which is also a
    // misalignment defect (the columns now read "drifted" in the
    // opposite direction).
    expect(r.header.length).toBe(r.collapsedRow!.boxes.length);
    for (let i = 0; i < r.header.length; i++) {
      const h = r.header[i];
      const b = r.collapsedRow!.boxes[i];
      expect(
        approxEqual(h.left, b.left, TOL_PX),
        `Post-expand env-header cell #${i} left=${h.left.toFixed(1)} does not align with COLLAPSED row's box left=${b.left.toFixed(1)} (delta ${Math.abs(h.left - b.left).toFixed(1)} px). If the expanded-row check just passed, the collapsed row drifted instead — the env-header must align with BOTH rows simultaneously.`,
      ).toBe(true);
      expect(
        approxEqual(h.right, b.right, TOL_PX),
        `Post-expand env-header cell #${i} right=${h.right.toFixed(1)} does not align with COLLAPSED row's box right=${b.right.toFixed(1)} (delta ${Math.abs(h.right - b.right).toFixed(1)} px).`,
      ).toBe(true);
    }
  });
});
