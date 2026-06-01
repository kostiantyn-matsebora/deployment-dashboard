/** Browser control panel — served at GET /demo/ (inline, no bundler). */
export const PANEL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo Driver</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f0f13;
      color: #d4d4d8;
      padding: 24px 24px 56px;
      min-height: 100vh;
    }
    h1 {
      font-size: 1.25rem; font-weight: 600; color: #f4f4f5;
      margin-bottom: 20px; letter-spacing: 0.03em;
    }
    h1 span { color: #6366f1; }

    /* Layout */
    .top-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
    .top-row .card { flex-grow: 1; flex-shrink: 1; flex-basis: 0; min-width: 260px; }
    .top-row .card-ingest  { flex-grow: 2.2; }
    .top-row .card-github  { flex-grow: 1.6; }
    .top-row .card-control { flex-grow: 1; }
    .feeds-col { display: flex; flex-direction: column; gap: 14px; margin-top: 14px; }

    /* Card */
    .card {
      background: #18181b; border: 1px solid #27272a;
      border-radius: 10px; padding: 18px;
    }
    .card-title {
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.1em; color: #71717a; margin-bottom: 14px;
    }

    /* Form controls */
    select, input[type="number"] {
      background: #0f0f13; border: 1px solid #3f3f46; color: #d4d4d8;
      padding: 5px 9px; border-radius: 6px; font-size: 0.85rem; outline: none;
    }
    select { min-width: 120px; }
    input[type="number"] { width: 80px; }
    select:focus, input:focus { border-color: #6366f1; }
    input:disabled, select:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Checkbox */
    .chk-label {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.8rem; color: #a1a1aa; cursor: pointer; user-select: none;
    }
    .chk-label input[type="checkbox"] { accent-color: #6366f1; width: 14px; height: 14px; cursor: pointer; }

    /* Buttons */
    button {
      padding: 5px 14px; border-radius: 6px; border: none;
      font-size: 0.82rem; font-weight: 500; cursor: pointer; outline: none;
      transition: background 0.15s;
    }
    .btn-run    { background: #6366f1; color: #fff; }
    .btn-run:hover:not(:disabled)    { background: #4f46e5; }
    .btn-stop   { background: #ef4444; color: #fff; }
    .btn-stop:hover:not(:disabled)   { background: #dc2626; }
    .btn-enable { background: #16a34a; color: #fff; }
    .btn-enable:hover:not(:disabled) { background: #15803d; }
    .btn-sm     { background: #27272a; color: #a1a1aa; padding: 3px 10px; font-size: 0.76rem; }
    .btn-sm:hover { background: #3f3f46; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }

    .controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .lbl { font-size: 0.75rem; color: #71717a; white-space: nowrap; }

    /* State badge */
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 99px;
      font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
    }
    .badge-idle     { background: #27272a; color: #a1a1aa; }
    .badge-running  { background: #1e3a5f; color: #60a5fa; }
    .badge-done     { background: #14532d; color: #86efac; }
    .badge-failed   { background: #450a0a; color: #f87171; }
    .badge-blocked  { background: #451a03; color: #fb923c; }
    .badge-on       { background: #14532d; color: #86efac; }
    .badge-off      { background: #27272a; color: #a1a1aa; }
    .badge-reset-idle    { background: #27272a; color: #a1a1aa; }
    .badge-reset-blocked { background: #451a03; color: #fb923c; }

    /* Progress bar (reused in status bar) */
    .progress-bg   { background: #27272a; border-radius: 4px; height: 5px; overflow: hidden; }
    .progress-fill { background: #6366f1; height: 100%; width: 0%; border-radius: 4px; transition: width 0.4s; }

    /* Emit / badge-button inline rows */
    .emit-row { display: flex; align-items: center; gap: 10px; justify-content: flex-start; }
    .emit-info { display: flex; flex-direction: column; gap: 6px; }
    .emit-title { font-size: 0.88rem; color: #d4d4d8; }

    /* Ingest sub-section separator */
    .sub-section { margin-top: 14px; padding-top: 12px; border-top: 1px solid #27272a; }
    .sub-section-title { font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
                         letter-spacing: 0.1em; color: #52525b; margin-bottom: 8px; }

    /* GitHub card title row */
    .gh-title-row { display: flex; justify-content: space-between; align-items: baseline;
                    margin-bottom: 14px; }
    .gh-store-info { font-size: 0.65rem; color: #52525b; white-space: nowrap; }
    .gh-store-info span { color: #71717a; }

    /* GitHub card hidden by default */
    #gh-emulator-card { display: none; }

    /* Liveness chips (status bar) */
    .lv-chip {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.68rem; font-weight: 600; letter-spacing: 0.04em;
      padding: 2px 7px; border-radius: 99px; white-space: nowrap;
    }
    .lv-chip::before { content: '●'; font-size: 0.6rem; }
    .lv-up      { background: #14532d; color: #86efac; }
    .lv-down    { background: #450a0a; color: #f87171; }
    .lv-checking { background: #27272a; color: #a1a1aa; }

    /* Status bar (fixed footer) */
    .status-bar {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
      background: #111115; border-top: 1px solid #27272a;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 7px 24px;
    }
    .sb-prog { flex: 1 1 100px; max-width: 160px; }
    .sb-lbl  { font-size: 0.7rem; color: #52525b; white-space: nowrap; }
    .sb-val  { font-size: 0.78rem; color: #a1a1aa; }
    .sb-val.err { color: #f87171; }
    .sb-sep  { color: #3f3f46; user-select: none; }

    /* API card */
    .api-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .api-msg { font-size: 0.75rem; }
    .api-msg.ok  { color: #86efac; }
    .api-msg.err { color: #f87171; }
    .api-msg-row { margin-top: 8px; min-height: 1.1em; }

    /* Reset card */
    .reset-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .reset-id  { font-size: 0.7rem; color: #71717a; font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace; word-break: break-all; margin-top: 6px; }

    /* Feed */
    .feed-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .feed-header .card-title { margin-bottom: 0; }
    .live-badge {
      font-size: 0.7rem; font-weight: 700; padding: 2px 9px;
      border-radius: 99px; letter-spacing: 0.05em;
    }
    .live-connecting   { background: #27272a; color: #a1a1aa; }
    .live-live         { background: #14532d; color: #86efac; }
    .live-reconnecting { background: #451a03; color: #fb923c; }

    .feed-list {
      font-size: 0.76rem; font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
    }
    .feed-item { padding: 4px 0; border-bottom: 1px solid #1f1f23; line-height: 1.4; }
    .feed-item:last-child { border-bottom: none; }
    .feed-empty { color: #52525b; text-align: center; padding: 24px 0; font-size: 0.8rem; }

    /* Unified five-column row grid — shared by all three feed cards. */
    .feed-row {
      display: grid;
      grid-template-columns: 6.5rem 8rem 10rem 11rem 1fr;
      gap: 0 8px;
      align-items: baseline;
    }
    /* Responsive: collapse to wrapped flex on narrow viewports. */
    @media (max-width: 860px) {
      .feed-row { display: flex; flex-wrap: wrap; gap: 3px 6px; }
    }

    /* Column cells */
    .fi-time    { color: #52525b; font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fi-source  { font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 3px;
                  letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fi-source-ingest { background: #1a2744; color: #60a5fa; }
    .fi-source-emit   { background: #271d00; color: #f59e0b; }
    .fi-source-comp   { background: #1d1d30; color: #a78bfa; }
    .fi-source-ctrl   { background: #1a2744; color: #60a5fa; }
    .fi-event   { display: inline-block; font-size: 0.62rem; font-weight: 700;
                  padding: 1px 5px; border-radius: 3px; letter-spacing: 0.04em;
                  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fi-event-posted    { background: #14532d; color: #86efac; }
    .fi-event-error     { background: #450a0a; color: #f87171; }
    .fi-event-neutral   { background: #27272a; color: #a1a1aa; }
    /* Control stream type classes — reused from former fi-type-* naming. */
    .fi-type-initiated  { background: #451a03; color: #fb923c; }
    .fi-type-started    { background: #1a2744; color: #60a5fa; }
    .fi-type-completed  { background: #14532d; color: #86efac; }
    .fi-type-unknown    { background: #27272a; color: #a1a1aa; }
    .fi-id      { color: #d4d4d8; font-weight: 600; font-size: 0.72rem;
                  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fi-details { color: #71717a; overflow: hidden; text-overflow: ellipsis; }

    /* Component Events feed — state colour coding within .fi-details */
    .fi-state-running   { color: #86efac; }
    .fi-state-error     { color: #f87171; }
    .fi-state-neutral   { color: #a1a1aa; }

    /* Control card dim — applied to interactive cards while reset_state == blocked */
    .card-blocked { opacity: 0.45; pointer-events: none; }
  </style>
</head>
<body>

  <h1>Demo <span>Driver</span></h1>

  <!-- ── Top card row ────────────────────────────────────────────────────── -->
  <div class="top-row">

    <!-- ── Ingest card ───────────────────────────────────────────────────── -->
    <div class="card card-ingest" id="ingest-card">
      <div class="card-title">Ingest</div>
      <div class="controls">
        <span class="lbl">Data set</span>
        <select id="dataset-select">
          <option value="demo">demo</option>
          <option value="random">random</option>
        </select>

        <span class="lbl" id="count-lbl" style="display:none">Services</span>
        <input type="number" id="count-input" value="10" min="1" max="10" step="1"
               style="width:60px;display:none">

        <label class="chk-label">
          <input type="checkbox" id="reset-check" checked> Reset
        </label>

        <span class="lbl">Delay (ms)</span>
        <input type="number" id="delay-input" value="0" min="0" step="100">

        <button class="btn-run"  id="ingest-btn">Ingest</button>
        <button class="btn-stop" id="ingest-stop-btn" disabled>Stop</button>
      </div>

      <!-- Live Emission sub-section folded in -->
      <div class="sub-section">
        <div class="sub-section-title">Live Emission</div>
        <div class="emit-row">
          <span class="badge badge-off" id="emit-badge">OFF</span>
          <button class="btn-enable" id="emit-toggle-btn" onclick="toggleEmit()">Enable</button>
        </div>
      </div>
    </div>

    <!-- ── GitHub Emulator card ───────────────────────────────────────────── -->
    <div class="card card-github" id="gh-emulator-card">
      <div class="gh-title-row">
        <div class="card-title" style="margin-bottom:0">GitHub Emulator</div>
        <span class="gh-store-info" id="gh-store-info">demo · 2 repos · seeded —</span>
      </div>

      <!-- Seed group left · Live group right (space-between, no outer wrap) -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:8px;margin-top:10px">
        <!-- Seed group wraps internally on very narrow viewports -->
        <div style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:1;min-width:0">
          <span class="lbl">Data set</span>
          <select id="gh-dataset-select">
            <option value="demo">demo</option>
            <option value="random">random</option>
          </select>

          <span class="lbl" id="gh-count-lbl" style="display:none">Count</span>
          <input type="number" id="gh-count-input" value="5" min="1" max="20" step="1"
                 style="width:60px;display:none">

          <label class="chk-label">
            <input type="checkbox" id="gh-reset-check" checked> Reset
          </label>

          <button class="btn-run" id="gh-seed-btn" onclick="ghSeedOrStop()">Seed</button>
        </div>

        <!-- Live group — left-border separator; anchored to right by space-between -->
        <div style="display:inline-flex;align-items:center;gap:8px;flex-shrink:0;padding-left:10px;border-left:1px solid #3f3f46">
          <span class="lbl">Live</span>
          <span class="badge badge-off" id="gh-emit-badge">OFF</span>
          <button class="btn-enable" id="gh-emit-btn" onclick="ghToggleEmit()">Enable</button>
        </div>
      </div>
      <div class="api-msg-row">
        <span class="api-msg" id="gh-seed-msg"></span>
      </div>
    </div>

    <!-- ── Control API card ──────────────────────────────────────────────── -->
    <div class="card card-control" id="control-api-card">
      <div class="card-title">Control API</div>
      <div class="emit-row">
        <span class="badge badge-reset-idle" id="reset-state-badge">IDLE</span>
        <button class="btn-stop" id="reset-api-btn" onclick="resetApi()">Reset System</button>
      </div>
      <div class="reset-id" id="reset-id-display"></div>
      <div class="api-msg-row">
        <span class="api-msg" id="reset-api-msg"></span>
      </div>
    </div>

  </div>

  <!-- ── Feed cards (full width, stacked) ─────────────────────────────────── -->
  <div class="feeds-col">

    <!-- ── Post Feed card ────────────────────────────────────────────────── -->
    <div class="card">
      <div class="feed-header">
        <div class="card-title">Post Feed</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="live-badge live-connecting" id="live-badge">● CONNECTING</span>
          <button class="btn-sm" id="clear-btn">Clear</button>
        </div>
      </div>
      <div class="feed-list" id="feed-list">
        <div class="feed-empty" id="feed-empty">No events posted yet.</div>
      </div>
    </div>

    <!-- ── Events card (merged control-stream + component-events) ────────── -->
    <div class="card" id="events-card">
      <div class="feed-header">
        <div class="card-title">Events</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="live-badge live-connecting" id="events-live-badge">● CONNECTING</span>
          <button class="btn-sm" id="events-clear-btn">Clear</button>
        </div>
      </div>
      <div class="feed-list" id="events-feed-list">
        <div class="feed-empty" id="events-feed-empty">No events received yet.</div>
      </div>
    </div>

  </div>

  <!-- ── Status bar (fixed footer) ────────────────────────────────────────── -->
  <div class="status-bar">
    <span class="lv-chip lv-checking" id="lv-driver">Driver</span>
    <span class="lv-chip lv-checking" id="lv-api">API</span>
    <span class="lv-chip lv-checking" id="lv-emulator">Emulator</span>
    <span class="lv-chip lv-checking" id="lv-fetcher">Fetcher</span>
    <span class="sb-sep">·</span>
    <span class="badge badge-idle" id="state-badge">idle</span>
    <div class="sb-prog">
      <div class="progress-bg"><div class="progress-fill" id="progress-fill"></div></div>
    </div>
    <span class="sb-val" id="progress-lbl">0 / 0 events</span>
    <span class="sb-lbl" id="progress-pct">0%</span>
    <span class="sb-sep">·</span>
    <span class="sb-lbl">Errors</span>
    <span class="sb-val err" id="error-count">0</span>
    <span class="sb-sep">·</span>
    <span class="sb-lbl">Started</span>
    <span class="sb-val" id="started-at">—</span>
    <span class="sb-sep">·</span>
    <span class="sb-lbl">Finished</span>
    <span class="sb-val" id="finished-at">—</span>
    <span class="sb-sep">·</span>
    <span class="badge badge-reset-idle" id="sb-reset-badge">RESET: IDLE</span>
  </div>

  <script>
    'use strict';
    const $ = id => document.getElementById(id);

    const datasetSelect   = $('dataset-select');
    const countLbl        = $('count-lbl');
    const countInput      = $('count-input');
    const resetCheck      = $('reset-check');
    const delayInput      = $('delay-input');
    const ingestBtn       = $('ingest-btn');
    const ingestStopBtn   = $('ingest-stop-btn');
    const stateBadge      = $('state-badge');
    const progressLbl     = $('progress-lbl');
    const progressPct     = $('progress-pct');
    const progressFill    = $('progress-fill');
    const errorCount      = $('error-count');
    const startedAt       = $('started-at');
    const finishedAt      = $('finished-at');
    const emitBadge       = $('emit-badge');
    const emitToggleBtn   = $('emit-toggle-btn');
    const resetApiBtn     = $('reset-api-btn');
    const resetApiMsg     = $('reset-api-msg');
    const liveBadge       = $('live-badge');
    const clearBtn        = $('clear-btn');
    const feedList        = $('feed-list');
    const feedEmpty       = $('feed-empty');
    const resetStateBadge = $('reset-state-badge');
    const resetIdDisplay  = $('reset-id-display');
    const sbResetBadge    = $('sb-reset-badge');

    // Liveness chips (status bar).
    const lvDriver   = $('lv-driver');
    const lvApi      = $('lv-api');
    const lvEmulator = $('lv-emulator');
    const lvFetcher  = $('lv-fetcher');

    // GitHub Emulator card refs.
    const ghEmulatorCard  = $('gh-emulator-card');
    const ghDatasetSelect = $('gh-dataset-select');
    const ghCountLbl      = $('gh-count-lbl');
    const ghCountInput    = $('gh-count-input');
    const ghResetCheck    = $('gh-reset-check');
    const ghSeedBtn       = $('gh-seed-btn');
    const ghSeedMsg       = $('gh-seed-msg');
    const ghEmitBadge     = $('gh-emit-badge');
    const ghEmitBtn       = $('gh-emit-btn');
    const ghStoreInfo     = $('gh-store-info');

    // Merged Events feed refs (data feed — exempt from card-blocked dimming).
    const eventsLiveBadge = $('events-live-badge');
    const eventsClearBtn  = $('events-clear-btn');
    const eventsFeedList  = $('events-feed-list');
    const eventsFeedEmpty = $('events-feed-empty');

    // Interactive control cards — dimmed while reset_state == blocked.
    const interactiveCards = [$('ingest-card'), $('gh-emulator-card'), $('control-api-card')];

    // Interactive controls blocked during reset.
    const interactiveControls = [
      ingestBtn, ingestStopBtn, emitToggleBtn, resetApiBtn,
      datasetSelect, countInput, delayInput, resetCheck,
      ghSeedBtn, ghEmitBtn, ghDatasetSelect, ghCountInput, ghResetCheck,
    ];

    let pollTimer        = null;
    let eventSource      = null;
    let ctrlEventSource  = null;
    let compPollTimer    = null;
    let ghPollTimer      = null;
    let healthPollTimer  = null;
    let emitting         = false;
    let ghEmitting       = false;
    let isBlocked        = false;

    // Merged events store: dedup by id, sorted datetime DESC.
    let eventsStore = [];

    // Post Feed store: latest 10, newest first; each entry is the raw SSE data obj.
    let postsStore = [];

    // ── Dataset toggles ───────────────────────────────────────────────────────
    datasetSelect.addEventListener('change', () => {
      const isRandom = datasetSelect.value === 'random';
      countLbl.style.display   = isRandom ? '' : 'none';
      countInput.style.display = isRandom ? '' : 'none';
    });

    ghDatasetSelect.addEventListener('change', () => {
      const isRandom = ghDatasetSelect.value === 'random';
      ghCountLbl.style.display   = isRandom ? '' : 'none';
      ghCountInput.style.display = isRandom ? '' : 'none';
    });

    // ── Boot ─────────────────────────────────────────────────────────────────
    (async () => {
      hydrateFromStorage();
      await Promise.all([refreshStatus(), refreshEmit()]);
      connectStream();
      connectControlStream();
      startCompEventsPoll();
      startGhPoll();
      startHealthPoll();
    })();

    // ── Data loaders ──────────────────────────────────────────────────────────
    async function refreshStatus() {
      try {
        const data = await apiFetch('/demo/status');
        applyStatus(data);
      } catch {}
    }

    async function refreshEmit() {
      try {
        const data = await apiFetch('/demo/emit');
        applyEmit(data);
      } catch {}
    }

    function applyStatus(d) {
      const state      = d.state      || 'idle';
      const resetState = d.reset_state || 'idle';
      const resetId    = d.reset_id   || null;

      // Scenario state badge.
      stateBadge.textContent = state;
      stateBadge.className   = 'badge badge-' + state;

      // Reset-state indicators (card badge + footer chip).
      if (resetState === 'blocked') {
        resetStateBadge.textContent = 'RESET IN PROGRESS';
        resetStateBadge.className   = 'badge badge-reset-blocked';
        resetIdDisplay.textContent  = resetId ? 'reset_id: ' + resetId : '';
        sbResetBadge.textContent    = 'RESET: IN PROGRESS';
        sbResetBadge.className      = 'badge badge-reset-blocked';
      } else {
        resetStateBadge.textContent = 'IDLE';
        resetStateBadge.className   = 'badge badge-reset-idle';
        resetIdDisplay.textContent  = '';
        sbResetBadge.textContent    = 'RESET: IDLE';
        sbResetBadge.className      = 'badge badge-reset-idle';
      }

      // Card-dim + interactive control state (no full-panel overlay).
      isBlocked = (resetState === 'blocked');

      if (isBlocked) {
        interactiveCards.forEach(el => { el.classList.add('card-blocked'); });
        interactiveControls.forEach(el => { el.disabled = true; });
      } else {
        interactiveCards.forEach(el => { el.classList.remove('card-blocked'); });
        // Restore interactive controls based on ingest state.
        interactiveControls.forEach(el => { el.disabled = false; });
        ingestBtn.disabled     = state === 'running';
        ingestStopBtn.disabled = state !== 'running';
      }

      const total = d.events_total || 0;
      const sent  = d.events_sent  || 0;
      const pct   = total > 0 ? (sent / total * 100) : 0;

      progressLbl.textContent  = sent + ' / ' + total + ' events';
      progressPct.textContent  = pct.toFixed(0) + '%';
      progressFill.style.width = pct.toFixed(1) + '%';
      errorCount.textContent   = d.errors || 0;
      startedAt.textContent    = d.started_at  ? fmt(d.started_at)  : '—';
      finishedAt.textContent   = d.finished_at ? fmt(d.finished_at) : '—';

      // Poll while running or blocked (to detect unblock).
      if (state === 'running' || isBlocked) schedulePoll();
      else clearTimeout(pollTimer);
    }

    function applyEmit(d) {
      emitting = d.emitting;
      emitBadge.textContent = emitting ? 'LIVE' : 'OFF';
      emitBadge.className   = 'badge ' + (emitting ? 'badge-on' : 'badge-off');
      emitToggleBtn.textContent = emitting ? 'Disable' : 'Enable';
      emitToggleBtn.className   = emitting ? 'btn-stop' : 'btn-enable';
    }

    function schedulePoll() {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => { await refreshStatus(); }, 600);
    }

    // ── Ingest controls ───────────────────────────────────────────────────────
    ingestBtn.addEventListener('click', async () => {
      if (isBlocked) return;
      const dataset  = datasetSelect.value;
      const reset    = resetCheck.checked;
      const delay    = parseInt(delayInput.value, 10) || 0;
      const count    = Math.min(parseInt(countInput.value, 10) || 10, 10);
      const body     = { dataset, reset, delay_ms: delay };
      if (dataset === 'random') body.count = count;

      // When reset is checked the server blocks until the full reset cycle
      // completes before responding.  Dim the control cards immediately so
      // the user sees feedback during the wait; applyStatus will clear it once
      // the response arrives with reset_state back to idle.
      if (reset) {
        isBlocked = true;
        interactiveCards.forEach(el => { el.classList.add('card-blocked'); });
        interactiveControls.forEach(el => { el.disabled = true; });
        resetStateBadge.textContent = 'RESET IN PROGRESS';
        resetStateBadge.className   = 'badge badge-reset-blocked';
        sbResetBadge.textContent    = 'RESET: IN PROGRESS';
        sbResetBadge.className      = 'badge badge-reset-blocked';
      }

      try {
        const data = await apiFetch('/demo/ingest', {
          method: 'POST',
          body:   JSON.stringify(body),
        });
        applyStatus(data);
      } catch {
        // On network error: revert the optimistic card-dim so the UI is not
        // permanently stuck.
        if (reset) {
          isBlocked = false;
          interactiveCards.forEach(el => { el.classList.remove('card-blocked'); });
          interactiveControls.forEach(el => { el.disabled = false; });
          ingestBtn.disabled     = false;
          ingestStopBtn.disabled = true;
          resetStateBadge.textContent = 'IDLE';
          resetStateBadge.className   = 'badge badge-reset-idle';
          sbResetBadge.textContent    = 'RESET: IDLE';
          sbResetBadge.className      = 'badge badge-reset-idle';
        }
      }
    });

    ingestStopBtn.addEventListener('click', async () => {
      if (isBlocked) return;
      try {
        const data = await apiFetch('/demo/ingest/stop', { method: 'POST' });
        applyStatus(data);
      } catch {}
    });

    // ── Live emission ─────────────────────────────────────────────────────────
    function toggleEmit() {
      if (isBlocked) return;
      emitToggleBtn.disabled = true;
      apiFetch('/demo/emit', {
        method: 'POST',
        body:   JSON.stringify({ enabled: !emitting }),
      }).then(applyEmit)
        .catch(() => {})
        .finally(() => { emitToggleBtn.disabled = isBlocked; });
    }

    // ── API reset ─────────────────────────────────────────────────────────────
    function resetApi() {
      if (isBlocked) return;
      resetApiBtn.disabled = true;
      resetApiMsg.textContent = '';
      resetApiMsg.className   = 'api-msg';
      apiFetch('/demo/api-reset', { method: 'POST' })
        .then(d => {
          if (d.ok) {
            resetApiMsg.textContent = '\\u2713 Reset OK (' + d.http_status + ')';
            resetApiMsg.className   = 'api-msg ok';
            // Reset was accepted — the backend transitions to blocked via SSE,
            // which arrives after this HTTP response.  Start polling immediately
            // so applyStatus catches the blocked→idle cycle.
            schedulePoll();
          } else {
            resetApiMsg.textContent = '\\u2717 HTTP ' + (d.http_status || '—');
            resetApiMsg.className   = 'api-msg err';
          }
        })
        .catch(() => {
          resetApiMsg.textContent = '\\u2717 Network error';
          resetApiMsg.className   = 'api-msg err';
        })
        .finally(() => { resetApiBtn.disabled = isBlocked; refreshStatus(); });
    }

    clearBtn.addEventListener('click', () => {
      postsStore = [];
      localStorage.removeItem('dd.posts');
      feedList.innerHTML = '';
      feedList.appendChild(feedEmpty);
    });

    eventsClearBtn.addEventListener('click', () => {
      eventsStore = [];
      localStorage.removeItem('dd.events');
      renderEventsStore();
    });

    // ── SSE stream ────────────────────────────────────────────────────────────
    function connectStream() {
      if (eventSource) { try { eventSource.close(); } catch {} }
      setLiveBadge('connecting');
      eventSource = new EventSource('/demo/stream');

      eventSource.onopen = () => setLiveBadge('live');

      eventSource.addEventListener('posted', e => {
        const d = JSON.parse(e.data);
        addFeedItem('posted', d);
        refreshStatus();
      });

      eventSource.addEventListener('error', e => {
        if (e.data) {
          addFeedItem('error', JSON.parse(e.data));
        } else {
          setLiveBadge('reconnecting');
        }
      });
    }

    function setLiveBadge(mode) {
      const labels = { connecting: '● CONNECTING', live: '● LIVE', reconnecting: '● RECONNECTING' };
      liveBadge.textContent = labels[mode] || mode;
      liveBadge.className   = 'live-badge live-' + mode;
    }

    // ── Shared unified row renderer ───────────────────────────────────────────
    // Returns a div.feed-item.feed-row with five aligned columns:
    //   time | source | event | id | details
    // All server-interpolated values are passed through esc().
    // eventClass: one of fi-event-posted / fi-event-error / fi-event-neutral /
    //             fi-type-initiated / fi-type-started / fi-type-completed / fi-type-unknown
    // sourceClass: one of fi-source-ingest / fi-source-emit / fi-source-comp / fi-source-ctrl
    // detailsHtml: pre-escaped HTML string for the details cell (caller builds it).
    function feedRow({ time, source, sourceClass, event: evtLabel, eventClass, id, detailsHtml }) {
      const row = document.createElement('div');
      row.className = 'feed-item feed-row';
      const srcHtml = source
        ? '<span class="fi-source ' + (sourceClass || 'fi-source-ctrl') + '">' + esc(source) + '</span>'
        : '<span class="fi-source fi-source-ctrl" style="visibility:hidden">\\u2013</span>';
      const idHtml = id
        ? '<span class="fi-id">' + esc(id) + '</span>'
        : '<span class="fi-id" style="visibility:hidden">\\u2013</span>';
      row.innerHTML =
        '<span class="fi-time">'    + esc(time)                                    + '</span>' +
        srcHtml                                                                                +
        '<span class="fi-event ' + (eventClass || 'fi-event-neutral') + '">' + esc(evtLabel) + '</span>' +
        idHtml                                                                                 +
        '<span class="fi-details">' + (detailsHtml || '')                          + '</span>';
      return row;
    }

    function addFeedItem(type, d) {
      // Dedup by deployment_id (prevents duplicates on SSE reconnect).
      const uid = (d.deployment_id || '') + '|' + (d.posted_at || '') + '|' + type;
      if (postsStore.some(p => p._uid === uid)) return;

      const reporter    = d.reporter || '';
      const isEmit      = reporter.endsWith('/emit');
      const sourceClass = isEmit ? 'fi-source-emit' : 'fi-source-ingest';
      const ts          = d.posted_at || new Date().toISOString();

      let detailsHtml;
      let eventClass;
      if (type === 'posted') {
        eventClass   = 'fi-event-posted';
        detailsHtml  = esc(d.service) + ' / ' + esc(d.environment) + ' \\u2192 ' + esc(d.status);
      } else {
        eventClass   = 'fi-event-error';
        detailsHtml  = 'HTTP ' + esc(String(d.http_status)) + ' \\u00b7 attempt ' + esc(String(d.attempt));
      }

      postsStore.unshift({
        _uid: uid, _ts: ts,
        time: fmt(ts), reporter, sourceClass, type, eventClass,
        id: d.deployment_id || '', detailsHtml,
      });
      // Cap at 10.
      if (postsStore.length > 10) postsStore.length = 10;
      persistPosts();
      renderPostFeed();
    }

    function renderPostFeed() {
      feedList.innerHTML = '';
      if (!postsStore.length) { feedList.appendChild(feedEmpty); return; }
      postsStore.forEach(p => {
        const row = feedRow({
          time: p.time, source: p.reporter, sourceClass: p.sourceClass,
          event: p.type, eventClass: p.eventClass, id: p.id, detailsHtml: p.detailsHtml,
        });
        feedList.appendChild(row);
      });
    }

    function persistPosts() {
      try { localStorage.setItem('dd.posts', JSON.stringify(postsStore)); } catch {}
    }

    // ── Control API Events SSE (GET /demo/control-stream) ────────────────────
    function connectControlStream() {
      if (ctrlEventSource) { try { ctrlEventSource.close(); } catch {} }
      setEventsLiveBadge('connecting');
      ctrlEventSource = new EventSource('/demo/control-stream');

      ctrlEventSource.onopen = () => setEventsLiveBadge('live');

      // Named events for known reset lifecycle types.
      ctrlEventSource.addEventListener('reset-initiated', e => {
        mergeCtrlEvent('reset-initiated', e.data);
      });
      ctrlEventSource.addEventListener('reset-started', e => {
        mergeCtrlEvent('reset-started', e.data);
      });
      ctrlEventSource.addEventListener('reset-completed', e => {
        mergeCtrlEvent('reset-completed', e.data);
      });

      // Default message handler: frames with no event: field (e.g. plain
      // data-only frames) and a forward-compat catch for any unknown named type
      // that the server sends without a dedicated listener.  Named events that
      // don't match a listener above will NOT fire onmessage — they are silently
      // dropped by EventSource.  That is acceptable per §4.8 forward-compat note
      // ("unknown named types are best-effort").
      ctrlEventSource.onmessage = e => {
        // Ignore ": ping" heartbeats — they arrive as comment frames with no data.
        if (!e.data) return;
        mergeCtrlEvent('unknown', e.data);
      };

      ctrlEventSource.onerror = () => setEventsLiveBadge('reconnecting');
    }

    function setEventsLiveBadge(mode) {
      const labels = { connecting: '● CONNECTING', live: '● LIVE', reconnecting: '● RECONNECTING' };
      eventsLiveBadge.textContent = labels[mode] || mode;
      eventsLiveBadge.className   = 'live-badge live-' + mode;
    }

    function mergeCtrlEvent(type, rawData) {
      let d = {};
      try { d = JSON.parse(rawData); } catch {}

      const eventClass = type === 'reset-initiated' ? 'fi-type-initiated'
                       : type === 'reset-started'   ? 'fi-type-started'
                       : type === 'reset-completed'  ? 'fi-type-completed'
                       :                               'fi-type-unknown';

      const ts          = d.occurred_at || new Date().toISOString();
      const detailsHtml = d.reset_id
        ? 'reset_id: <span class="fi-id">' + esc(d.reset_id) + '</span>'
        : '';

      const entry = {
        _kind:      'ctrl',
        _ts:        ts,
        id:         d.id || ('ctrl-' + ts),
        time:       fmtMs(ts),
        source:     'control-api',
        sourceClass:'fi-source-ctrl',
        event:      type,
        eventClass,
        rowId:      d.id || '',
        detailsHtml,
      };
      mergeIntoStore(entry);
    }

    // ── Component Events poll (GET /demo/control-events, 5 s cadence) ─────────
    function startCompEventsPoll() {
      // Immediate first fetch, then schedule repeating interval.
      fetchCompEvents();
      compPollTimer = setInterval(fetchCompEvents, 5000);
    }

    async function fetchCompEvents() {
      try {
        const page = await apiFetch('/demo/control-events');
        mergeCompEvents(page.items || []);
      } catch {
        // Network error: keep existing list.
      }
    }

    function mergeCompEvents(items) {
      items.forEach(rec => {
        const stateCls = rec.state === 'running' ? 'fi-state-running'
                       : rec.state === 'error'   ? 'fi-state-error'
                       :                           'fi-state-neutral';
        const ts       = rec.received_at || new Date().toISOString();
        const detailPart = rec.detail
          ? ' \\u00b7 <span class="fi-details">' + esc(rec.detail) + '</span>'
          : '';
        const detailsHtml =
          '<span class="' + stateCls + '">' + esc(rec.state || '') + '</span>' + detailPart;

        const entry = {
          _kind:      'comp',
          _ts:        ts,
          id:         rec.id || ('comp-' + ts + '-' + (rec.component_id || '')),
          time:       fmtMs(ts),
          source:     rec.component_id || '',
          sourceClass:'fi-source-comp',
          event:      rec.event_type   || '',
          eventClass: 'fi-event-neutral',
          rowId:      rec.id           || '',
          detailsHtml,
        };
        mergeIntoStore(entry);
      });
    }

    // ── Merged events store helpers ───────────────────────────────────────────
    function mergeIntoStore(entry) {
      const exists = eventsStore.some(e => e.id === entry.id);
      if (!exists) {
        eventsStore.push(entry);
        // Sort by timestamp DESC.
        eventsStore.sort((a, b) => b._ts.localeCompare(a._ts));
        // Cap at 20.
        if (eventsStore.length > 20) eventsStore.length = 20;
        persistEvents();
        renderEventsStore();
      }
    }

    function renderEventsStore() {
      eventsFeedList.innerHTML = '';
      if (!eventsStore.length) {
        eventsFeedList.appendChild(eventsFeedEmpty);
        return;
      }
      eventsStore.forEach(entry => {
        const row = feedRow({
          time:        entry.time,
          source:      entry.source,
          sourceClass: entry.sourceClass,
          event:       entry.event,
          eventClass:  entry.eventClass,
          id:          entry.rowId,
          detailsHtml: entry.detailsHtml,
        });
        eventsFeedList.appendChild(row);
      });
    }

    function persistEvents() {
      try { localStorage.setItem('dd.events', JSON.stringify(eventsStore)); } catch {}
    }

    // ── GitHub Emulator controls ──────────────────────────────────────────────
    // Dispatcher: routes to ghDoSeed() or ghDoStop() based on current button label.
    function ghSeedOrStop() {
      if (ghSeedBtn.textContent === 'Stop') ghDoStop();
      else ghDoSeed();
    }

    async function ghDoSeed() {
      if (isBlocked) return;
      const doReset = ghResetCheck.checked;
      ghSeedBtn.disabled    = true;
      ghSeedMsg.textContent = '';
      ghSeedMsg.className   = 'api-msg';

      // Step 1: seed the emulator.
      let seedOk = false;
      try {
        const dataset = ghDatasetSelect.value;
        const body    = { dataset, reset: doReset };
        if (dataset === 'random') body.count = parseInt(ghCountInput.value, 10) || 5;
        const d = await apiFetch('/demo/github/seed', {
          method: 'POST',
          body:   JSON.stringify(body),
        });
        applyGithubStatus(d);
        ghSeedMsg.textContent = '\\u2713 Seeded';
        ghSeedMsg.className   = 'api-msg ok';
        seedOk = true;
      } catch {
        ghSeedMsg.textContent = '\\u2717 Seed error';
        ghSeedMsg.className   = 'api-msg err';
        ghSeedBtn.disabled = isBlocked;
        return;
      }

      // Step 2: if Reset was checked, also trigger the system reset — mirrors
      // the ingest handler's optimistic-dim pattern exactly.
      if (seedOk && doReset) {
        // Optimistic dim — same block as ingest handler.
        isBlocked = true;
        interactiveCards.forEach(el => { el.classList.add('card-blocked'); });
        interactiveControls.forEach(el => { el.disabled = true; });
        resetStateBadge.textContent = 'RESET IN PROGRESS';
        resetStateBadge.className   = 'badge badge-reset-blocked';
        sbResetBadge.textContent    = 'RESET: IN PROGRESS';
        sbResetBadge.className      = 'badge badge-reset-blocked';

        try {
          const r = await apiFetch('/demo/api-reset', { method: 'POST' });
          if (r.ok) {
            schedulePoll();
          } else {
            // Non-OK response: revert optimistic dim.
            isBlocked = false;
            interactiveCards.forEach(el => { el.classList.remove('card-blocked'); });
            interactiveControls.forEach(el => { el.disabled = false; });
            resetStateBadge.textContent = 'IDLE';
            resetStateBadge.className   = 'badge badge-reset-idle';
            sbResetBadge.textContent    = 'RESET: IDLE';
            sbResetBadge.className      = 'badge badge-reset-idle';
          }
        } catch {
          // Network error: revert optimistic dim.
          isBlocked = false;
          interactiveCards.forEach(el => { el.classList.remove('card-blocked'); });
          interactiveControls.forEach(el => { el.disabled = false; });
          resetStateBadge.textContent = 'IDLE';
          resetStateBadge.className   = 'badge badge-reset-idle';
          sbResetBadge.textContent    = 'RESET: IDLE';
          sbResetBadge.className      = 'badge badge-reset-idle';
        }
      } else {
        ghSeedBtn.disabled = isBlocked;
      }
    }

    async function ghDoStop() {
      if (isBlocked) return;
      ghSeedBtn.disabled    = true;
      ghSeedMsg.textContent = '';
      ghSeedMsg.className   = 'api-msg';
      try {
        const d = await apiFetch('/demo/github/clear', { method: 'POST' });
        applyGithubStatus(d);
        ghSeedMsg.textContent = '\\u2713 Cleared';
        ghSeedMsg.className   = 'api-msg ok';
      } catch {
        ghSeedMsg.textContent = '\\u2717 Clear error';
        ghSeedMsg.className   = 'api-msg err';
      } finally {
        ghSeedBtn.disabled = isBlocked;
      }
    }

    function ghToggleEmit() {
      if (isBlocked) return;
      ghEmitBtn.disabled = true;
      apiFetch('/demo/github/emit', {
        method: 'POST',
        body:   JSON.stringify({ enabled: !ghEmitting }),
      }).then(applyGhEmit)
        .catch(() => {})
        .finally(() => { ghEmitBtn.disabled = isBlocked; });
    }

    function applyGhEmit(d) {
      ghEmitting = d.emitting;
      ghEmitBadge.textContent = ghEmitting ? 'LIVE' : 'OFF';
      ghEmitBadge.className   = 'badge ' + (ghEmitting ? 'badge-on' : 'badge-off');
      ghEmitBtn.textContent   = ghEmitting ? 'Disable' : 'Enable';
      ghEmitBtn.className     = ghEmitting ? 'btn-stop' : 'btn-enable';
    }

    function applyGithubStatus(d) {
      // Show the card if this is a 2xx response (called from poll or seed/clear).
      ghEmulatorCard.style.display = 'flex';
      ghEmulatorCard.style.flexDirection = 'column';

      // Update the title one-liner.
      const repos     = d.repos != null ? d.repos : '?';
      const dataset   = d.dataset || '?';
      const seededAt  = d.seeded_at ? fmtMs(d.seeded_at) : '—';
      ghStoreInfo.innerHTML =
        esc(dataset) + ' · ' + esc(String(repos)) + ' repos · seeded ' + esc(seededAt);

      // Seed/Stop toggle: non-empty store → Stop; empty store → Seed.
      const hasData = ((d.deployments || 0) > 0) || ((d.repos || 0) > 0);
      ghSeedBtn.textContent = hasData ? 'Stop' : 'Seed';
      ghSeedBtn.className   = hasData ? 'btn-stop' : 'btn-run';

      // Sync emit state if present.
      if (typeof d.emitting === 'boolean') applyGhEmit(d);
    }

    // ── GitHub Emulator poll (5 s cadence, shows/hides card on 2xx/error) ─────
    function startGhPoll() {
      fetchGhStatus();
      ghPollTimer = setInterval(fetchGhStatus, 5000);
    }

    async function fetchGhStatus() {
      try {
        const res = await fetch('/demo/github/status', { headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) { ghEmulatorCard.style.display = 'none'; return; }
        applyGithubStatus(await res.json());
        // Sync emit toggle separately; ignore non-2xx / network error.
        try {
          const er = await fetch('/demo/github/emit', { headers: { 'Content-Type': 'application/json' } });
          if (er.ok) applyGhEmit(await er.json());
        } catch {}
      } catch {
        // Network error — hide the card.
        ghEmulatorCard.style.display = 'none';
      }
    }

    // ── localStorage hydration ────────────────────────────────────────────────
    function hydrateFromStorage() {
      // Hydrate Events feed.
      try {
        const raw = localStorage.getItem('dd.events');
        if (raw) {
          const rows = JSON.parse(raw);
          if (Array.isArray(rows)) {
            rows.forEach(entry => {
              // Merge without re-persisting (already persisted).
              if (!eventsStore.some(e => e.id === entry.id)) eventsStore.push(entry);
            });
            eventsStore.sort((a, b) => b._ts.localeCompare(a._ts));
            if (eventsStore.length > 20) eventsStore.length = 20;
            renderEventsStore();
          }
        }
      } catch {}

      // Hydrate Post Feed.
      try {
        const raw = localStorage.getItem('dd.posts');
        if (raw) {
          const rows = JSON.parse(raw);
          if (Array.isArray(rows)) {
            rows.forEach(p => {
              if (!postsStore.some(q => q._uid === p._uid)) postsStore.push(p);
            });
            postsStore.sort((a, b) => b._ts.localeCompare(a._ts));
            if (postsStore.length > 10) postsStore.length = 10;
            renderPostFeed();
          }
        }
      } catch {}
    }

    // ── Health poll (liveness chips) ──────────────────────────────────────────
    function startHealthPoll() {
      fetchHealth();
      healthPollTimer = setInterval(fetchHealth, 5000);
    }

    async function fetchHealth() {
      // Driver chip is always up if the panel loaded.
      applyHealthChip(lvDriver, 'up');
      try {
        const res = await fetch('/demo/health', { headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) throw new Error('non-2xx');
        const d = await res.json();
        applyHealthChip(lvApi,      d.api      || 'down');
        applyHealthChip(lvEmulator, d.emulator || 'down');
        applyHealthChip(lvFetcher,  d.fetcher  || 'down');
      } catch {
        applyHealthChip(lvApi,      'down');
        applyHealthChip(lvEmulator, 'down');
        applyHealthChip(lvFetcher,  'down');
      }
    }

    function applyHealthChip(el, status) {
      const cls = status === 'up' ? 'lv-up' : status === 'down' ? 'lv-down' : 'lv-checking';
      el.className = 'lv-chip ' + cls;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    async function apiFetch(url, opts = {}) {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
      });
      return res.json();
    }

    function fmt(iso) {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function fmtMs(iso) {
      const d = new Date(iso);
      const hms = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const ms  = String(d.getMilliseconds()).padStart(3, '0');
      return hms + '.' + ms;
    }

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
