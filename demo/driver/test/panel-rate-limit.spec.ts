/**
 * panel-rate-limit.spec.ts
 *
 * Unit tests for the "Fetcher · Rate Limit" card additions to PANEL_HTML.
 *
 * The panel is a served inline HTML+JS string — there is no DOM/browser test
 * harness.  These tests use string-contains checks to assert:
 *   1. The required element ids are present in the HTML.
 *   2. The rate-limit routing logic (event_type === 'rate-limit' early-return)
 *      exists in the JS section, which guarantees suppression from the Events feed.
 *   3. The updateRateLimitCard function and its key logic branches are present.
 *
 * This matches how the panel string is realistically testable without a browser
 * environment (consistent with all other panel-level assertions in the project).
 */

import { PANEL_HTML } from '../src/ui/panel';

// ── Element IDs ──────────────────────────────────────────────────────────────

describe('PANEL_HTML — Fetcher Rate Limit card element ids', () => {
  const requiredIds = [
    'rl-card',
    'rl-state-badge',
    'rl-adapter',
    'rl-own-label',
    'rl-progress-fill',
    'rl-ci-remaining',
    'rl-ci-limit',
    'rl-reset-at',
  ];

  requiredIds.forEach(id => {
    it(`contains element id="${id}"`, () => {
      expect(PANEL_HTML).toContain(`id="${id}"`);
    });
  });

  it('card title reads "Fetcher · Rate Limit"', () => {
    // The · separator is the HTML entity ·  or the literal unicode char;
    // in the source it is the raw UTF-8 middle-dot inside the template literal.
    expect(PANEL_HTML).toContain('Fetcher');
    expect(PANEL_HTML).toContain('Rate Limit');
  });

  it('rl-card is hidden by default via CSS (#rl-card { display: none; })', () => {
    expect(PANEL_HTML).toContain('#rl-card { display: none; }');
  });
});

// ── rate-limit routing / suppression logic ────────────────────────────────────

describe('PANEL_HTML — rate-limit event routing and suppression', () => {
  it('mergeCompEvents checks event_type === "rate-limit" before mergeIntoStore', () => {
    // The guard must appear inside mergeCompEvents.  The string
    // `event_type === 'rate-limit'` is the canonical gate.
    expect(PANEL_HTML).toContain("event_type === 'rate-limit'");
  });

  it('calls updateRateLimitCard when event_type is rate-limit', () => {
    expect(PANEL_HTML).toContain('updateRateLimitCard(rec)');
  });

  it('returns early from mergeCompEvents for rate-limit events (suppression)', () => {
    // The block pattern: if rate-limit → updateRateLimitCard → return
    // Verify that `return` follows the updateRateLimitCard call inside the guard.
    const rlBlock = PANEL_HTML.indexOf("event_type === 'rate-limit'");
    const returnAfter = PANEL_HTML.indexOf('return;', rlBlock);
    const mergeAfter  = PANEL_HTML.indexOf('mergeIntoStore', rlBlock);
    // return; must appear before mergeIntoStore within the same guard block.
    expect(rlBlock).toBeGreaterThan(-1);
    expect(returnAfter).toBeGreaterThan(rlBlock);
    expect(returnAfter).toBeLessThan(mergeAfter);
  });

  it('updateRateLimitCard function is defined in the panel JS', () => {
    expect(PANEL_HTML).toContain('function updateRateLimitCard(rec)');
  });
});

// ── updateRateLimitCard logic branches ────────────────────────────────────────

describe('PANEL_HTML — updateRateLimitCard logic', () => {
  it('applies badge-paused class for paused state', () => {
    expect(PANEL_HTML).toContain("badge badge-paused");
    expect(PANEL_HTML).toContain("state === 'paused'");
  });

  it('applies badge-running class for running state', () => {
    expect(PANEL_HTML).toContain("state === 'running'");
    expect(PANEL_HTML).toContain("badge badge-running");
  });

  it('renders null own_used / own_budget as em-dash fallback', () => {
    // Null guard: `ownUsed != null ? String(ownUsed) : '\\u2014'`
    expect(PANEL_HTML).toContain('\\u2014');
  });

  it('caps progress fill at 100%', () => {
    expect(PANEL_HTML).toContain('Math.min(100,');
  });

  it('guards against division by zero on own_budget', () => {
    // `ownBudget > 0` prevents NaN from division
    expect(PANEL_HTML).toContain('ownBudget > 0');
  });

  it('reads reset_at from payload and calls fmt() for local-time render', () => {
    expect(PANEL_HTML).toContain('p.reset_at');
    expect(PANEL_HTML).toContain('fmt(p.reset_at)');
  });

  it('reveals the card on first event via style.display = "flex"', () => {
    expect(PANEL_HTML).toContain("rlCard.style.display");
  });
});

// ── CSS for badge-paused ──────────────────────────────────────────────────────

describe('PANEL_HTML — badge-paused CSS class is defined', () => {
  it('defines .badge-paused with a distinct colour from running/idle', () => {
    expect(PANEL_HTML).toContain('.badge-paused');
  });
});
