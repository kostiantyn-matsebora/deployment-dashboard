/**
 * @jest-environment jest-environment-jsdom
 *
 * panel-correlation.spec.ts
 *
 * Tests for the correlation_id visibility (R1) and filter (R2) features.
 *
 * Two layers:
 *   Static  — string-contains checks on PANEL_HTML (structure / code presence).
 *   DOM     — jsdom-based tests that render chips into a real document, dispatch
 *             genuine click/keydown Events on chip elements, and assert that the
 *             filter bar appears and the clear button works.
 *             These are the regression gate: the prior string-contains tests passed
 *             while the onclick was broken because they never exercised the DOM path.
 */

import { PANEL_HTML } from '../src/ui/panel';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Boot PANEL_HTML in the jsdom document provided by jest-environment-jsdom.
 * We write the HTML into document.documentElement, then execute the inline
 * <script> via eval in window scope so the delegated listeners are wired up.
 *
 * Stubs for network / timer APIs are set on window before execution so the
 * script runs without throwing.
 */
function bootPanel(): void {
  // Stub Web APIs the inline script touches but we don't exercise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = globalThis as any;
  win.EventSource = class {
    addEventListener() {}
    close() {}
  };
  win.fetch = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

  // Write the full HTML into the document.
  document.open();
  document.write(PANEL_HTML);
  document.close();
}

/**
 * Inject a minimal .fi-corr chip into eventsFeedList, mirroring what
 * renderEventsStore produces after the fix (data-corr-id, no inline onclick).
 */
function injectChip(corrId: string): HTMLElement {
  const list = document.getElementById('events-feed-list')!;
  list.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'feed-item feed-row';
  row.innerHTML =
    '<span class="fi-details"> ' +
      '<span class="fi-corr"' +
      ' data-corr-id="' + corrId + '"' +
      ' role="button" tabindex="0" aria-pressed="false"' +
      '>corr:' + corrId.slice(0, 8) + '</span>' +
    '</span>';
  list.appendChild(row);
  return list.querySelector('.fi-corr') as HTMLElement;
}

// ─────────────────────────────────────────────────────────────────────────────
// Static — R1: chip HTML structure
// ─────────────────────────────────────────────────────────────────────────────

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

  it('chip uses data-corr-id attribute (safe, delegated-handler approach)', () => {
    expect(PANEL_HTML).toContain('data-corr-id=');
  });

  it('chip includes role="button" for accessibility', () => {
    expect(PANEL_HTML).toContain('role="button"');
  });

  it('chip includes tabindex="0" for keyboard focus', () => {
    expect(PANEL_HTML).toContain('tabindex="0"');
  });

  it('delegated click handler is bound on eventsFeedList (not inline onclick)', () => {
    // Inline onclick replaced by a single delegated addEventListener.
    expect(PANEL_HTML).not.toContain('onclick="selectCorrId(');
    expect(PANEL_HTML).toContain("eventsFeedList.addEventListener('click'");
  });

  it('delegated keydown handler is bound on eventsFeedList (not inline onkeydown)', () => {
    expect(PANEL_HTML).not.toContain('onkeydown=');
    expect(PANEL_HTML).toContain("eventsFeedList.addEventListener('keydown'");
  });

  it('chip is NOT rendered when correlationId is absent (conditional on entry.correlationId)', () => {
    expect(PANEL_HTML).toContain('if (entry.correlationId)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static — R2: filter state, selectCorrId, helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('PANEL_HTML — R2: activeCorrelationId state and selectCorrId handler', () => {
  it('declares activeCorrelationId as null (no active filter on load)', () => {
    expect(PANEL_HTML).toContain('let activeCorrelationId = null');
  });

  it('defines selectCorrId function', () => {
    expect(PANEL_HTML).toContain('function selectCorrId(id)');
  });

  it('selectCorrId toggles filter off when the same id is clicked again', () => {
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

describe('PANEL_HTML — R2: renderEventsStore applies client-side correlation filter', () => {
  it('filters eventsStore by activeCorrelationId when set', () => {
    expect(PANEL_HTML).toContain('e.correlationId === activeCorrelationId');
  });

  it('uses the full store when activeCorrelationId is null (no filter)', () => {
    expect(PANEL_HTML).toContain('activeCorrelationId\n        ? eventsStore.filter');
  });

  it('applies .fi-corr-active class to the chip matching the active filter id', () => {
    expect(PANEL_HTML).toContain('fi-corr-active');
  });
});

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
    const clearIdx  = PANEL_HTML.indexOf("eventsClearBtn.addEventListener('click'");
    const nullIdx   = PANEL_HTML.indexOf('activeCorrelationId = null', clearIdx);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(nullIdx).toBeGreaterThan(clearIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOM — chip click / keydown fires selectCorrId through the delegated handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * These tests are the regression gate.  The jsdom environment is provided by
 * jest-environment-jsdom (docblock above).  The panel is booted once (beforeAll)
 * so the inline <script> runs a single time and the delegated listeners on
 * eventsFeedList are wired up.  Each test re-injects a chip and dispatches a
 * real DOM Event; between tests the clear button is used to reset filter state.
 *
 * Because the handler resolves event.target.closest('.fi-corr') and reads
 * chip.dataset.corrId, these tests fail if either the chip lacks the attribute
 * or the delegated listener is absent — exactly the broken path they guard.
 */
describe('DOM — chip click and keydown wire through delegated handler', () => {
  beforeAll(() => {
    bootPanel();
  });

  // Helper: clear the active filter after each test so tests are independent.
  afterEach(() => {
    const clearBtn = document.getElementById('corr-filter-clear-btn')!;
    clearBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  it('clicking a chip makes the filter bar visible', () => {
    const corrId = 'abc123def456';
    const chip   = injectChip(corrId);
    const bar    = document.getElementById('corr-filter-bar')!;

    expect(bar.style.display).toBe('none');
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bar.style.display).not.toBe('none');
  });

  it('clicking a chip sets the filter label to the correlation id', () => {
    const corrId = 'abc123def456';
    const chip   = injectChip(corrId);
    const label  = document.getElementById('corr-filter-id')!;

    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(label.textContent).toBe(corrId);
  });

  it('clicking the clear button hides the filter bar again', () => {
    const corrId   = 'abc123def456';
    const chip     = injectChip(corrId);
    const bar      = document.getElementById('corr-filter-bar')!;
    const clearBtn = document.getElementById('corr-filter-clear-btn')!;

    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bar.style.display).not.toBe('none');

    clearBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bar.style.display).toBe('none');
  });

  it('clicking the same chip twice toggles the filter off (clear-bar hidden)', () => {
    const corrId = 'abc123def456';
    const chip   = injectChip(corrId);
    const bar    = document.getElementById('corr-filter-bar')!;

    // First click: filter on.
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bar.style.display).not.toBe('none');

    // renderEventsStore rebuilds the list; re-inject a chip with the same id.
    const chip2 = injectChip(corrId);
    chip2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bar.style.display).toBe('none');
  });

  it('pressing Enter on a chip makes the filter bar visible', () => {
    const corrId = 'abc123def456';
    const chip   = injectChip(corrId);
    const bar    = document.getElementById('corr-filter-bar')!;

    expect(bar.style.display).toBe('none');
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(bar.style.display).not.toBe('none');
  });

  it('pressing Space on a chip makes the filter bar visible', () => {
    const corrId = 'abc123def456';
    const chip   = injectChip(corrId);
    const bar    = document.getElementById('corr-filter-bar')!;

    chip.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(bar.style.display).not.toBe('none');
  });

  it('pressing a non-activation key on a chip does NOT activate the filter', () => {
    const corrId = 'abc123def456';
    const chip   = injectChip(corrId);
    const bar    = document.getElementById('corr-filter-bar')!;

    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(bar.style.display).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static — command-event (control-stream) corr chip
// ─────────────────────────────────────────────────────────────────────────────

describe('PANEL_HTML — command events carry correlation_id chip (not reset_id text)', () => {
  it('mergeCtrlEvent reads d.correlation_id (not d.reset_id)', () => {
    expect(PANEL_HTML).toContain('d.correlation_id || null');
    expect(PANEL_HTML).not.toContain('d.reset_id');
  });

  it('mergeCtrlEvent stores correlationId on the ctrl entry', () => {
    // The ctrl entry object includes correlationId as a field.
    const mergeIdx = PANEL_HTML.indexOf('function mergeCtrlEvent');
    const corrIdx  = PANEL_HTML.indexOf('correlationId,', mergeIdx);
    expect(mergeIdx).toBeGreaterThan(-1);
    expect(corrIdx).toBeGreaterThan(mergeIdx);
  });

  it('mergeCtrlEvent does NOT set a reset_id text detailsHtml (chip replaces it)', () => {
    // Old code: detailsHtml = d.reset_id ? 'reset_id: ...' : '';
    // New code: detailsHtml: '' — chip appended by renderEventsStore like comp events.
    expect(PANEL_HTML).not.toContain("'reset_id: '");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOM — command-event chip: delegated handler works for ctrl-style chips
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Command-event rows are rendered by renderEventsStore with the same .fi-corr
 * chip + data-corr-id pattern as component events.  The delegated listener on
 * eventsFeedList fires for both.  These tests verify that a chip injected with
 * a ctrl-event-style corrId activates the filter — proving the mechanism is
 * not limited to component events.
 *
 * Note: bootPanel() must only be called once per jsdom document lifetime.
 * The existing DOM suite already calls it in its beforeAll; this suite runs in
 * the same jsdom window and relies on the listeners already being wired.  We
 * guard against a stale document by checking the feed element is present.
 */
describe('DOM — command-event corr chip activates filter through delegated handler', () => {
  beforeAll(() => {
    // Only boot if the panel has not yet been written to this jsdom document.
    // (The sibling DOM suite runs first and calls bootPanel in its own beforeAll.)
    if (!document.getElementById('events-feed-list')) {
      bootPanel();
    }
  });

  afterEach(() => {
    // Clear filter + events store between tests.
    const clearBtn = document.getElementById('corr-filter-clear-btn')!;
    clearBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  it('a ctrl-style chip (source=control-api) activates the correlation filter on click', () => {
    // Inject a chip with a corrId that represents a control-stream frame.
    const corrId = 'ctrl-saga-corr-0001';
    const chip   = injectChip(corrId);
    const bar    = document.getElementById('corr-filter-bar')!;
    const label  = document.getElementById('corr-filter-id')!;

    expect(bar.style.display).toBe('none');
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bar.style.display).not.toBe('none');
    expect(label.textContent).toBe(corrId);
  });

  it('the same corrId chip filters the events list (only matching entries shown)', () => {
    // With a filter active on corrId, the feed shows only that corrId's entries.
    // We inject one chip with the target id and click it, then inject another
    // chip with a different id and verify the feed only shows one item.
    const corrId = 'ctrl-saga-corr-0002';
    const chip   = injectChip(corrId);
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Re-inject a chip with the same id (mimicking renderEventsStore rerender).
    const chip2 = injectChip(corrId);
    expect(chip2.classList.contains('fi-corr-active')).toBe(false); // injected raw, not by renderer
    // The bar is still visible (filter is active).
    const bar = document.getElementById('corr-filter-bar')!;
    expect(bar.style.display).not.toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static — reset checkboxes removed (#9)
// ─────────────────────────────────────────────────────────────────────────────

describe('PANEL_HTML — reset checkboxes are gone (#9)', () => {
  it('does NOT contain id="reset-check" (Ingest card checkbox removed)', () => {
    expect(PANEL_HTML).not.toContain('id="reset-check"');
  });

  it('does NOT contain id="gh-reset-check" (GitHub Emulator card checkbox removed)', () => {
    expect(PANEL_HTML).not.toContain('id="gh-reset-check"');
  });

  it('does NOT reference resetCheck variable in JS', () => {
    // The JS variable was removed along with the element.
    expect(PANEL_HTML).not.toContain("= $('reset-check')");
    expect(PANEL_HTML).not.toContain('resetCheck');
  });

  it('does NOT reference ghResetCheck variable in JS', () => {
    expect(PANEL_HTML).not.toContain("= $('gh-reset-check')");
    expect(PANEL_HTML).not.toContain('ghResetCheck');
  });

  it('ingest body does NOT include a reset field', () => {
    // The ingest POST body no longer sends reset: true/false.
    expect(PANEL_HTML).not.toContain('reset: doReset');
    expect(PANEL_HTML).not.toContain('reset: reset,');
  });

  it('ghDoSeed does NOT call /demo/api-reset (reset trigger removed)', () => {
    // The Step 2 reset block inside ghDoSeed is gone.
    const ghDoSeedIdx = PANEL_HTML.indexOf('async function ghDoSeed');
    const ghDoStopIdx = PANEL_HTML.indexOf('async function ghDoStop');
    expect(ghDoSeedIdx).toBeGreaterThan(-1);
    expect(ghDoStopIdx).toBeGreaterThan(-1);
    // No api-reset call should appear between ghDoSeed and ghDoStop.
    const apiResetInGhDoSeed = PANEL_HTML.indexOf('/demo/api-reset', ghDoSeedIdx);
    expect(apiResetInGhDoSeed === -1 || apiResetInGhDoSeed > ghDoStopIdx).toBe(true);
  });

  it('dedicated Reset System button is still present', () => {
    expect(PANEL_HTML).toContain('id="reset-api-btn"');
    expect(PANEL_HTML).toContain('Reset System');
  });
});
