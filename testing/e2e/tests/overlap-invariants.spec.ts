/**
 * Overlap Invariants — permanent regression gate.
 *
 * Rule: no UI element in a named set may overlap another element in the same
 * set.  Checks both the design mockup and the running SPA.
 *
 * ADDING A NEW COMBO:
 *   1. Append a row to COMBOS_UNDER_TEST.
 *   2. Set view, theme, and any setup actions needed to reach the target state.
 *   3. Specify which element group(s) to check for overlaps.
 *   This test file is auto-discovered by Playwright; every COMBOS_UNDER_TEST
 *   row generates one test.
 *
 * History:
 *   iteration-0  (#95 baseline)  — initial mockup swimlanes + matrix combos.
 */

import { test, expect, Page } from '@playwright/test';
import {
  openMockup,
  switchToSwimlanes,
  getBoundingBoxes,
  findOverlap,
} from './helpers';

// ---------------------------------------------------------------------------
// Combo table
// ---------------------------------------------------------------------------

interface ComboUnderTest {
  /** Unique identifier — becomes the test name suffix. */
  id: string;
  /** Human description shown in failure output. */
  description: string;
  /** Navigate + configure the page into this UI state. */
  setup: (page: Page) => Promise<void>;
  /**
   * One or more groups of CSS selectors whose elements must not overlap.
   * Each entry in the array is checked independently (elements within the
   * same entry are compared pairwise).
   */
  overlapGroups: Array<{
    label: string;
    selector: string;
  }>;
}

const COMBOS_UNDER_TEST: ComboUnderTest[] = [
  // ── iteration-0: swimlanes vis cards ─────────────────────────────────────

  {
    id: 'swimlanes-vis-cards-dark',
    description: 'Swimlanes view — vis cards must not overlap — dark theme',
    setup: async (page) => {
      await openMockup(page);
      await switchToSwimlanes(page);
    },
    overlapGroups: [
      {
        label: 'vis cards',
        selector: '#cards-layer .vis-card',
      },
    ],
  },

  {
    id: 'swimlanes-vis-cards-light',
    description: 'Swimlanes view — vis cards must not overlap — light theme',
    setup: async (page) => {
      await openMockup(page);
      await page.click('[data-theme-pick="light"]');
      await page.waitForTimeout(300);
      await switchToSwimlanes(page);
    },
    overlapGroups: [
      {
        label: 'vis cards',
        selector: '#cards-layer .vis-card',
      },
    ],
  },

  // ── iteration-0: swimlanes vis cards with inspector open ─────────────────

  {
    id: 'swimlanes-with-inspector-dark',
    description: 'Swimlanes view — vis-canvas and inspector must not overlap — dark theme',
    setup: async (page) => {
      await openMockup(page);
      await switchToSwimlanes(page);
      // Click a node to ensure the inspector panel is populated
      await page.locator('.vis-card[data-node-id="a1f7c2b8e1d2"]').click();
    },
    overlapGroups: [
      {
        label: 'vis cards',
        selector: '#cards-layer .vis-card',
      },
      {
        label: 'vis-canvas vs inspector panel',
        // Both grid columns of the vis-shell
        selector: '.vis-canvas, .vis-inspector',
      },
    ],
  },

  // ── iteration-0: matrix slots per row ────────────────────────────────────

  {
    id: 'matrix-slots-payments-api-dark',
    description: 'Matrix — payments-api row slots must not overlap — dark theme',
    setup: async (page) => {
      await openMockup(page); // openMockup auto-closes the drawer
    },
    overlapGroups: [
      {
        label: 'payments-api slot cells',
        selector: '.slot[data-svc="payments-api"]',
      },
    ],
  },

  {
    id: 'matrix-slots-auth-bff-dark',
    description: 'Matrix — auth-bff row slots must not overlap — dark theme',
    setup: async (page) => {
      await openMockup(page); // openMockup auto-closes the drawer
    },
    overlapGroups: [
      {
        label: 'auth-bff slot cells',
        selector: '.slot[data-svc="auth-bff"]',
      },
    ],
  },

  // ── iteration-1: analytics KPI band (#299) ───────────────────────────────

  {
    id: 'analytics-kpi-band-dark',
    description: 'Analytics view — KPI band cards must not overlap — dark theme',
    setup: async (page) => {
      await page.goto('http://localhost:4200/analytics');
      await page.waitForSelector('.an-kpi-card', { timeout: 20_000 });
      await page.waitForTimeout(600);
    },
    overlapGroups: [
      {
        label: 'KPI band cards',
        selector: '.an-kpi-card',
      },
    ],
  },

  {
    id: 'analytics-chart-grid-dark',
    description: 'Analytics view — chart grid cards must not overlap — dark theme',
    setup: async (page) => {
      await page.goto('http://localhost:4200/analytics');
      await page.waitForSelector('.an-card', { timeout: 20_000 });
      await page.waitForTimeout(600);
    },
    overlapGroups: [
      {
        label: 'chart grid cards',
        selector: '.an-grid .an-card',
      },
    ],
  },

  // ── iteration-1: matrix with namespace collision (#353) ──────────────────

  {
    id: 'matrix-row-heads-namespace-collision-dark',
    description: 'Matrix — all row headers must not overlap when namespace collision rows present — dark theme',
    setup: async (page) => {
      await page.goto('http://localhost:4200/matrix');
      await page.waitForSelector('.row-head', { timeout: 20_000 });
      await page.waitForTimeout(400);
    },
    overlapGroups: [
      {
        label: 'matrix row headers',
        selector: '.row-head',
      },
    ],
  },

  // ── iteration-0: swimlanes with minimal fields ────────────────────────────

  {
    id: 'swimlanes-minimal-fields-dark',
    description: 'Swimlanes — vis cards with only environment field on must not overlap',
    setup: async (page) => {
      await openMockup(page);
      await switchToSwimlanes(page);
      // Turn off all vis fields except environment
      await page.click('#btn-fields');
      const fieldsToToggleOff = ['version', 'run_url', 'sha', 'run_number', 'ref', 'actor', 'happened_at'];
      for (const field of fieldsToToggleOff) {
        await page.locator('#fields-grid-vis .field-toggle').filter({ hasText: new RegExp(`^${field}$`) }).click();
      }
      await page.keyboard.press('Escape');
      // Wait for buildSwim re-layout
      await page.waitForTimeout(400);
    },
    overlapGroups: [
      {
        label: 'vis cards (minimal fields)',
        selector: '#cards-layer .vis-card',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

for (const combo of COMBOS_UNDER_TEST) {
  test(`no overlap: ${combo.id}`, async ({ page }) => {
    await combo.setup(page);

    for (const group of combo.overlapGroups) {
      const boxes = await getBoundingBoxes(page, group.selector);

      // Require at least one element to be visible — empty result = selector
      // mismatch or wrong view state, which is a test authoring error.
      expect(
        boxes.length,
        `${combo.id} / ${group.label}: no visible elements matched "${group.selector}"`,
      ).toBeGreaterThan(0);

      const overlapMsg = findOverlap(boxes);
      expect(
        overlapMsg,
        `${combo.id} / ${group.label}: ${overlapMsg}`,
      ).toBeNull();
    }
  });
}
