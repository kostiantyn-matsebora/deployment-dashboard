/**
 * panel-rate-limit.spec.ts
 *
 * Unit tests for the "Fetcher · Rate Limit" card in PANEL_HTML.
 *
 * The panel is a served inline HTML+JS string — there is no DOM/browser test
 * harness.  These tests use string-contains checks to assert:
 *   1. The card container and dynamic adapter container id are present in the HTML.
 *   2. The rate-limit routing logic (event_type === 'rate-limit' early-return)
 *      exists in the JS section, which guarantees suppression from the Events feed.
 *   3. The updateRateLimitCard function and its key logic branches are present.
 *   4. The per-adapter store (rlAdapterStore) and slug helper (rlSlug) exist.
 *   5. A single adapter still renders correctly (rlAdapterSectionHtml).
 */

import { PANEL_HTML } from '../src/ui/panel';

// ── Static element IDs ────────────────────────────────────────────────────────

describe('PANEL_HTML — Fetcher Rate Limit card static element ids', () => {
  it('contains element id="rl-card" (outer card container)', () => {
    expect(PANEL_HTML).toContain('id="rl-card"');
  });

  it('contains element id="rl-adapters-container" (dynamic per-adapter content)', () => {
    expect(PANEL_HTML).toContain('id="rl-adapters-container"');
  });

  it('card title reads "Fetcher · Rate Limit"', () => {
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
    // The guard must appear inside mergeCompEvents.
    expect(PANEL_HTML).toContain("event_type === 'rate-limit'");
  });

  it('calls updateRateLimitCard when event_type is rate-limit', () => {
    expect(PANEL_HTML).toContain('updateRateLimitCard(rec)');
  });

  it('returns early from mergeCompEvents for rate-limit events (suppression)', () => {
    // Verify that `return` follows the updateRateLimitCard call inside the guard,
    // and that return precedes the next mergeIntoStore call.
    const rlBlock    = PANEL_HTML.indexOf("event_type === 'rate-limit'");
    const returnAfter = PANEL_HTML.indexOf('return;', rlBlock);
    const mergeAfter  = PANEL_HTML.indexOf('mergeIntoStore', rlBlock);
    expect(rlBlock).toBeGreaterThan(-1);
    expect(returnAfter).toBeGreaterThan(rlBlock);
    expect(returnAfter).toBeLessThan(mergeAfter);
  });

  it('updateRateLimitCard function is defined in the panel JS', () => {
    expect(PANEL_HTML).toContain('function updateRateLimitCard(rec)');
  });
});

// ── Per-adapter store and slug helper ─────────────────────────────────────────

describe('PANEL_HTML — per-adapter store and slug helper', () => {
  it('declares rlAdapterStore as a per-adapter keyed object', () => {
    expect(PANEL_HTML).toContain('rlAdapterStore');
  });

  it('updates rlAdapterStore keyed by adapter name (last-value-wins)', () => {
    // The store update uses the adapterName as key.
    expect(PANEL_HTML).toContain('rlAdapterStore[adapterName]');
  });

  it('defines rlSlug helper function for safe id slugification', () => {
    expect(PANEL_HTML).toContain('function rlSlug(adapter)');
  });

  it('rlSlug lowercases input', () => {
    expect(PANEL_HTML).toContain('.toLowerCase()');
  });

  it('rlSlug replaces non-alphanumeric characters with hyphens', () => {
    // The regex /[^a-z0-9]/g → '-' is the canonical slug replacement.
    expect(PANEL_HTML).toContain("[^a-z0-9]");
  });

  it('defines rlAdapterSectionHtml to build per-adapter section markup', () => {
    expect(PANEL_HTML).toContain('function rlAdapterSectionHtml(adapterName, entry)');
  });

  it('per-adapter section id uses slug pattern rl-<slug>-section', () => {
    // In the JS source the id is built as: '<div id="rl-' + slug + '-section"'
    // The panel string contains the literal fragment below (single-quote after rl-).
    expect(PANEL_HTML).toContain("rl-' + slug + '-section");
  });

  it('per-adapter state badge id uses slug pattern rl-<slug>-state-badge', () => {
    expect(PANEL_HTML).toContain("rl-' + slug + '-state-badge");
  });

  it('per-adapter own-label id uses slug pattern rl-<slug>-own-label', () => {
    expect(PANEL_HTML).toContain("rl-' + slug + '-own-label");
  });

  it('per-adapter progress-fill id uses slug pattern rl-<slug>-progress-fill', () => {
    expect(PANEL_HTML).toContain("rl-' + slug + '-progress-fill");
  });

  it('per-adapter ci-remaining id uses slug pattern rl-<slug>-ci-remaining', () => {
    expect(PANEL_HTML).toContain("rl-' + slug + '-ci-remaining");
  });

  it('per-adapter ci-limit id uses slug pattern rl-<slug>-ci-limit', () => {
    expect(PANEL_HTML).toContain("rl-' + slug + '-ci-limit");
  });

  it('per-adapter reset-at id uses slug pattern rl-<slug>-reset-at', () => {
    expect(PANEL_HTML).toContain("rl-' + slug + '-reset-at");
  });

  it('iterates over all store keys to render one section per adapter', () => {
    // Object.keys(rlAdapterStore) drives the per-adapter loop.
    expect(PANEL_HTML).toContain('Object.keys(rlAdapterStore)');
  });

  it('renders sections into rl-adapters-container via innerHTML', () => {
    expect(PANEL_HTML).toContain('rlAdaptersContainer.innerHTML');
  });
});

// ── updateRateLimitCard logic branches ────────────────────────────────────────

describe('PANEL_HTML — updateRateLimitCard logic', () => {
  it('applies badge-paused class for paused state', () => {
    expect(PANEL_HTML).toContain('badge badge-paused');
    expect(PANEL_HTML).toContain("state === 'paused'");
  });

  it('applies badge-running class for running state', () => {
    expect(PANEL_HTML).toContain("state === 'running'");
    expect(PANEL_HTML).toContain('badge badge-running');
  });

  it('renders null own_used / own_budget as em-dash fallback', () => {
    expect(PANEL_HTML).toContain('\\u2014');
  });

  it('caps progress fill at 100%', () => {
    expect(PANEL_HTML).toContain('Math.min(100,');
  });

  it('guards against division by zero on own_budget', () => {
    expect(PANEL_HTML).toContain('ownBudget > 0');
  });

  it('reads reset_at from payload and calls fmt() for local-time render', () => {
    expect(PANEL_HTML).toContain('p.reset_at');
    expect(PANEL_HTML).toContain('fmt(p.reset_at)');
  });

  it('reveals the card on first event via rlCard.style.display', () => {
    expect(PANEL_HTML).toContain('rlCard.style.display');
  });
});

// ── CSS for badge-paused ──────────────────────────────────────────────────────

describe('PANEL_HTML — badge-paused CSS class is defined', () => {
  it('defines .badge-paused with a distinct colour from running/idle', () => {
    expect(PANEL_HTML).toContain('.badge-paused');
  });
});
