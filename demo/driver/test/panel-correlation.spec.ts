/**
 * panel-correlation.spec.ts
 *
 * Unit tests for the correlation_id visibility (R1) and filter (R2) features
 * in PANEL_HTML.
 *
 * Strategy: string-contains checks on the PANEL_HTML constant (same approach
 * as panel-rate-limit.spec.ts), asserting:
 *   R1 — correlation_id is read from rec and stored on each comp event entry.
 *   R1 — a .fi-corr chip is rendered inline in the details cell when present.
 *   R2 — activeCorrelationId state variable and selectCorrId() are defined.
 *   R2 — renderEventsStore filters on activeCorrelationId when set.
 *   R2 — corrFilterClearBtn wires up to clear the filter.
 *   R2 — the filter bar DOM elements are present and hidden by default.
 */

import { PANEL_HTML } from '../src/ui/panel';

// ── R1 — visibility: correlation_id stored on entry ──────────────────────────

describe('PANEL_HTML — R1: correlation_id read and stored on comp event entry', () => {
  it('reads rec.correlation_id in mergeCompEvents', () => {
    expect(PANEL_HTML).toContain('rec.correlation_id');
  });

  it('stores correlationId on the entry object inside mergeCompEvents', () => {
    expect(PANEL_HTML).toContain('correlationId,');
  });

  it('declares correlationId using rec.correlation_id with null fallback', () => {
    expect(PANEL_HTML).toContain('rec.correlation_id || null');
  });
});

// ── R1 — visibility: .fi-corr chip rendered in details cell ─────────────────

describe('PANEL_HTML — R1: .fi-corr chip rendered for present correlation ids', () => {
  it('defines .fi-corr CSS class in the style block', () => {
    expect(PANEL_HTML).toContain('.fi-corr {');
  });

  it('.fi-corr chip uses cursor:pointer (it is a clickable affordance)', () => {
    expect(PANEL_HTML).toContain('cursor: pointer');
  });

  it('.fi-corr-active CSS class is defined (highlights the active filter chip)', () => {
    expect(PANEL_HTML).toContain('.fi-corr-active {');
  });

  it('renderEventsStore appends a .fi-corr span to detailsHtml when correlationId present', () => {
    expect(PANEL_HTML).toContain('"fi-corr');
  });

  it('chip calls selectCorrId onclick', () => {
    expect(PANEL_HTML).toContain('onclick="selectCorrId(');
  });

  it('chip includes role="button" for accessibility', () => {
    expect(PANEL_HTML).toContain('role="button"');
  });

  it('chip includes tabindex="0" for keyboard focus', () => {
    expect(PANEL_HTML).toContain('tabindex="0"');
  });

  it('chip includes a keydown handler so Enter/Space also activates it', () => {
    expect(PANEL_HTML).toContain('onkeydown=');
  });

  it('chip is NOT rendered when correlationId is absent (conditional on entry.correlationId)', () => {
    expect(PANEL_HTML).toContain('if (entry.correlationId)');
  });
});

// ── R2 — filter state and selectCorrId function ──────────────────────────────

describe('PANEL_HTML — R2: activeCorrelationId state and selectCorrId handler', () => {
  it('declares activeCorrelationId as null (no active filter on load)', () => {
    expect(PANEL_HTML).toContain('let activeCorrelationId = null');
  });

  it('defines selectCorrId function', () => {
    expect(PANEL_HTML).toContain('function selectCorrId(id)');
  });

  it('selectCorrId toggles filter off when the same id is clicked again', () => {
    // The toggle: activeCorrelationId === id → null.
    expect(PANEL_HTML).toContain('activeCorrelationId === id');
  });

  it('selectCorrId calls applyCorrFilter then renderEventsStore', () => {
    const selIdx    = PANEL_HTML.indexOf('function selectCorrId');
    const applyIdx  = PANEL_HTML.indexOf('applyCorrFilter()', selIdx);
    const renderIdx = PANEL_HTML.indexOf('renderEventsStore()', selIdx);
    expect(selIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(selIdx);
    expect(renderIdx).toBeGreaterThan(applyIdx);
  });
});

// ── R2 — renderEventsStore filters on activeCorrelationId ────────────────────

describe('PANEL_HTML — R2: renderEventsStore applies client-side correlation filter', () => {
  it('filters eventsStore by activeCorrelationId when set', () => {
    expect(PANEL_HTML).toContain('e.correlationId === activeCorrelationId');
  });

  it('uses the full store when activeCorrelationId is null (no filter)', () => {
    // The ternary: activeCorrelationId ? filter(...) : eventsStore
    expect(PANEL_HTML).toContain('activeCorrelationId\n        ? eventsStore.filter');
  });

  it('applies .fi-corr-active class to the chip matching the active filter id', () => {
    expect(PANEL_HTML).toContain('fi-corr-active');
  });
});

// ── R2 — filter bar DOM elements ─────────────────────────────────────────────

describe('PANEL_HTML — R2: correlation filter bar DOM elements', () => {
  it('contains element id="corr-filter-bar" (filter bar container)', () => {
    expect(PANEL_HTML).toContain('id="corr-filter-bar"');
  });

  it('contains element id="corr-filter-id" (displays the active correlation id)', () => {
    expect(PANEL_HTML).toContain('id="corr-filter-id"');
  });

  it('contains element id="corr-filter-clear-btn" (clear affordance)', () => {
    expect(PANEL_HTML).toContain('id="corr-filter-clear-btn"');
  });

  it('corr-filter-bar is hidden by default (style="display:none")', () => {
    expect(PANEL_HTML).toContain('id="corr-filter-bar" style="display:none"');
  });

  it('.corr-filter-bar CSS class is defined', () => {
    expect(PANEL_HTML).toContain('.corr-filter-bar {');
  });
});

// ── R2 — applyCorrFilter helper ───────────────────────────────────────────────

describe('PANEL_HTML — R2: applyCorrFilter helper wires filter bar to state', () => {
  it('defines applyCorrFilter function', () => {
    expect(PANEL_HTML).toContain('function applyCorrFilter()');
  });

  it('shows the corr-filter-bar when activeCorrelationId is set', () => {
    expect(PANEL_HTML).toContain("corrFilterBar.style.display = ''");
  });

  it('hides the corr-filter-bar when activeCorrelationId is cleared', () => {
    expect(PANEL_HTML).toContain("corrFilterBar.style.display = 'none'");
  });

  it('writes the active id text into corrFilterId', () => {
    expect(PANEL_HTML).toContain('corrFilterId.textContent = activeCorrelationId');
  });
});

// ── R2 — clear affordance wired up ───────────────────────────────────────────

describe('PANEL_HTML — R2: corrFilterClearBtn clears the active correlation filter', () => {
  it('corrFilterClearBtn has an event listener', () => {
    expect(PANEL_HTML).toContain("corrFilterClearBtn.addEventListener('click'");
  });

  it('clear handler sets activeCorrelationId to null', () => {
    const clearIdx = PANEL_HTML.indexOf("corrFilterClearBtn.addEventListener('click'");
    const nullIdx  = PANEL_HTML.indexOf('activeCorrelationId = null', clearIdx);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(nullIdx).toBeGreaterThan(clearIdx);
  });

  it('clear handler calls renderEventsStore to update the feed', () => {
    const clearIdx  = PANEL_HTML.indexOf("corrFilterClearBtn.addEventListener('click'");
    const renderIdx = PANEL_HTML.indexOf('renderEventsStore()', clearIdx);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(renderIdx).toBeGreaterThan(clearIdx);
  });

  it('eventsClearBtn also resets the correlation filter on full clear', () => {
    // The eventsClearBtn handler sets activeCorrelationId = null before renderEventsStore.
    const clearIdx  = PANEL_HTML.indexOf("eventsClearBtn.addEventListener('click'");
    const nullIdx   = PANEL_HTML.indexOf('activeCorrelationId = null', clearIdx);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(nullIdx).toBeGreaterThan(clearIdx);
  });
});
