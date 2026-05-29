/**
 * Shared helpers for mockup E2E tests.
 *
 * All helpers operate against the design mockup at docs/design/mockup/index.html.
 * The mockup is a self-contained static HTML file: no server required.
 */

import { Page } from '@playwright/test';
import { pathToFileURL } from 'url';
import path from 'path';

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

/** Absolute file:// URL to the design mockup HTML. */
export const MOCKUP_URL = pathToFileURL(
  path.resolve(__dirname, '../../../docs/design/mockup/index.html'),
).href;

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the mockup and wait for all synchronous JS to settle
 * (renderMatrix, buildSwim two-pass layout, computeKPIs, openDrawer).
 *
 * Auto-closes the history drawer that the mockup opens on every load
 * (openDrawer('payments-api', 'staging') at end of script) so all tests
 * start with an unobstructed page and no pointer-event-intercepting overlay.
 */
export async function openMockup(page: Page): Promise<void> {
  await page.goto(MOCKUP_URL, { waitUntil: 'domcontentloaded' });
  // Allow all synchronous initialisation (including buildSwim measurement pass
  // and the auto-open drawer call) to complete.
  await page.waitForTimeout(800);
  // Dismiss the auto-opened drawer so the overlay no longer intercepts clicks.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

/**
 * Close the history drawer that auto-opens on mockup load
 * (openDrawer('payments-api', 'staging', { markFirst: true }) at bottom of script).
 *
 * Uses Escape, which triggers both closeDrawer() and closeAllPopovers().
 */
export async function closeDrawer(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

/**
 * Switch to the Swimlanes (vis) view.
 * setView('vis') triggers buildSwim() with the measurement second-pass;
 * all layout is synchronous, so 600 ms is ample headroom.
 */
export async function switchToSwimlanes(page: Page): Promise<void> {
  await page.click('button[data-view="vis"]');
  await page.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Return bounding boxes for all elements matching `selector`.
 * Zero-sized elements (hidden / not-yet-rendered) are filtered out.
 */
export async function getBoundingBoxes(page: Page, selector: string): Promise<Rect[]> {
  return page.locator(selector).evaluateAll((els) =>
    els
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      })
      .filter((r) => r.width > 0 && r.height > 0),
  );
}

/** Sub-pixel tolerance applied to every overlap comparison (1 px). */
export const OVERLAP_TOLERANCE = 1;

/**
 * Checks pairwise whether any two bounding boxes in `boxes` overlap
 * (by more than OVERLAP_TOLERANCE).
 *
 * Returns a descriptive message for the first overlapping pair found,
 * or null when no overlap exists.
 */
export function findOverlap(boxes: Rect[]): string | null {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlaps = !(
        a.x + a.width  <= b.x + OVERLAP_TOLERANCE ||
        b.x + b.width  <= a.x + OVERLAP_TOLERANCE ||
        a.y + a.height <= b.y + OVERLAP_TOLERANCE ||
        b.y + b.height <= a.y + OVERLAP_TOLERANCE
      );
      if (overlaps) {
        return (
          `[${i}] (x=${a.x.toFixed(1)},y=${a.y.toFixed(1)},` +
          `w=${a.width.toFixed(1)},h=${a.height.toFixed(1)}) ` +
          `overlaps ` +
          `[${j}] (x=${b.x.toFixed(1)},y=${b.y.toFixed(1)},` +
          `w=${b.width.toFixed(1)},h=${b.height.toFixed(1)})`
        );
      }
    }
  }
  return null;
}
