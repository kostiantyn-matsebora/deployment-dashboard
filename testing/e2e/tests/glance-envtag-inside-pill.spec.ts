// Implements testing/e2e/scenarios/glance-envtag-inside-pill.md
//
// Glance view (in every layout): each PAIRED env-tag is fully
// contained within its paired stage box and is not horizontally
// clipped. This is the SAD NFR-09 Glance exception, identical to
// the mockup harness Invariant 1 exception.

import { test, expect } from '@playwright/test';

const LAYOUTS = ['matrix', 'swim-lane', 'workflow-rows'] as const;

// Sub-pixel tolerance - mirrors testing/mockup-visual/harness.config.json
// tolerances.envTagSubpixelPx. Kept as a literal here because the SPA
// suite doesn't yet have its own harness.config.json; bumping this in
// future requires touching one place.
const SUBPIXEL_TOLERANCE_PX = 2;

test.describe('Glance view - env-tag inside paired pill (NFR-09 exception)', () => {
  for (const layout of LAYOUTS) {
    test(`layout=${layout}`, async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      await page.getByTestId('view-option-glance').click();
      await page.getByTestId(`layout-option-${layout}`).click();

      await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', 'glance');
      await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', layout);
      await expect(page.locator("[data-testid^='stage-box-']").first()).toBeVisible();

      // Two paint frames to let any post-mount geometry settle.
      await page.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );

      const violations: Array<{ tagText: string; boxId: string; reason: string }> = await page.evaluate(
        (tol: number) => {
          const list: Array<{ tagText: string; boxId: string; reason: string }> = [];
          const tags = Array.from(document.querySelectorAll('.env-tag')) as HTMLElement[];
          for (const tag of tags) {
            const pair = tag.closest('.leaf-pair');
            if (!pair) continue; // not a paired tag, skip
            const box = pair.querySelector("[data-testid^='stage-box-']") as HTMLElement | null;
            if (!box) continue;
            const t = tag.getBoundingClientRect();
            const b = box.getBoundingClientRect();
            const boxId = box.getAttribute('data-testid') || 'stage-box-?';
            const tagText = (tag.textContent || '').trim();

            // Containment.
            if (t.left < b.left - tol) {
              list.push({ tagText, boxId, reason: `tag.left(${t.left.toFixed(1)}) < box.left(${b.left.toFixed(1)}) - tol` });
            }
            if (t.right > b.right + tol) {
              list.push({ tagText, boxId, reason: `tag.right(${t.right.toFixed(1)}) > box.right(${b.right.toFixed(1)}) + tol` });
            }
            if (t.top < b.top - tol) {
              list.push({ tagText, boxId, reason: `tag.top(${t.top.toFixed(1)}) < box.top(${b.top.toFixed(1)}) - tol` });
            }
            if (t.bottom > b.bottom + tol) {
              list.push({ tagText, boxId, reason: `tag.bottom(${t.bottom.toFixed(1)}) > box.bottom(${b.bottom.toFixed(1)}) + tol` });
            }

            // Not clipped horizontally.
            if (tag.scrollWidth - tag.clientWidth > 1) {
              list.push({
                tagText,
                boxId,
                reason: `env-tag '${tagText}' is clipped: scrollWidth(${tag.scrollWidth}) > clientWidth(${tag.clientWidth})`,
              });
            }
          }
          return list;
        },
        SUBPIXEL_TOLERANCE_PX,
      );

      expect(
        violations,
        `Glance/${layout} - paired env-tag containment violations:\n${violations
          .map((v) => `  - [${v.boxId}] (${v.tagText}) ${v.reason}`)
          .join('\n')}`,
      ).toEqual([]);
    });
  }
});
