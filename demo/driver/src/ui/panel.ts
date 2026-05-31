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
    .grid { display: grid; grid-template-columns: 3fr 1fr 1fr; gap: 14px; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
    .full { grid-column: 1 / -1; }

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

    /* Emit card row */
    .emit-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .emit-info { display: flex; flex-direction: column; gap: 6px; }
    .emit-title { font-size: 0.88rem; color: #d4d4d8; }

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
      max-height: 280px; overflow-y: auto;
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

    /* GitHub Store card counters */
    .gh-counters { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-bottom: 10px; }
    .gh-counter  { display: flex; flex-direction: column; align-items: center; }
    .gh-counter-val  { font-size: 1.2rem; font-weight: 700; color: #f4f4f5; line-height: 1; }
    .gh-counter-lbl  { font-size: 0.65rem; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
    .gh-meta { font-size: 0.72rem; color: #52525b; margin-top: 4px; }
    .gh-dataset-badge { display: inline-block; padding: 1px 7px; border-radius: 3px;
                        font-size: 0.65rem; font-weight: 700; letter-spacing: 0.06em;
                        background: #1a2744; color: #60a5fa; margin-left: 4px; }
  </style>
</head>
<body>

  <h1>Demo <span>Driver</span></h1>

  <div class="grid">

    <!-- ── Ingest card ───────────────────────────────────────────────────── -->
    <div class="card" id="ingest-card">
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
    </div>

    <!-- ── Live Emission card ─────────────────────────────────────────────── -->
    <div class="card" id="emit-card">
      <div class="card-title">Live Emission</div>
      <div class="emit-row">
        <div class="emit-info">
          <span class="emit-title">Random events</span>
          <span class="badge badge-off" id="emit-badge">OFF</span>
        </div>
        <button class="btn-enable" id="emit-toggle-btn" onclick="toggleEmit()">Enable</button>
      </div>
    </div>

    <!-- ── Control API card ─────────────────────────────────────────────── -->
    <div class="card" id="control-api-card">
      <div class="card-title">Control API</div>
      <div class="emit-row">
        <div class="emit-info">
          <span class="lbl">Reset state</span>
          <span class="badge badge-reset-idle" id="reset-state-badge">IDLE</span>
          <div class="reset-id" id="reset-id-display"></div>
        </div>
        <button class="btn-stop" id="reset-api-btn" onclick="resetApi()">Reset System</button>
      </div>
      <div class="api-msg-row">
        <span class="api-msg" id="reset-api-msg"></span>
      </div>
    </div>

    <!-- ── Post Feed card (full row) ─────────────────────────────────────── -->
    <div class="card full">
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

    <!-- ── Control API Events card (full row) ────────────────────────────── -->
    <div class="card full">
      <div class="feed-header">
        <div class="card-title">Control API Events</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="live-badge live-connecting" id="ctrl-live-badge">● CONNECTING</span>
          <button class="btn-sm" id="ctrl-clear-btn">Clear</button>
        </div>
      </div>
      <div class="feed-list" id="ctrl-feed-list">
        <div class="feed-empty" id="ctrl-feed-empty">No control events received yet.</div>
      </div>
    </div>

    <!-- ── Component Events card (full row) ──────────────────────────────── -->
    <div class="card full">
      <div class="feed-header">
        <div class="card-title">Component Events</div>
        <span class="live-badge live-live" id="comp-poll-badge">● POLLING</span>
      </div>
      <div class="feed-list" id="comp-feed-list">
        <div class="feed-empty" id="comp-feed-empty">No component events yet.</div>
      </div>
    </div>

    <!-- ── GitHub Seed card ───────────────────────────────────────────────── -->
    <div class="card" id="gh-seed-card">
      <div class="card-title">GitHub Seed</div>
      <div class="controls">
        <span class="lbl">Data set</span>
        <select id="gh-dataset-select">
          <option value="demo">demo</option>
          <option value="random">random</option>
        </select>

        <span class="lbl" id="gh-count-lbl" style="display:none">Count</span>
        <input type="number" id="gh-count-input" value="5" min="1" max="100" step="1"
               style="width:60px;display:none">

        <label class="chk-label">
          <input type="checkbox" id="gh-reset-check"> Reset
        </label>

        <button class="btn-run"  id="gh-seed-btn">Seed</button>
        <button class="btn-stop" id="gh-clear-btn">Clear</button>
      </div>
      <div class="api-msg-row">
        <span class="api-msg" id="gh-seed-msg"></span>
      </div>
    </div>

    <!-- ── GitHub Live card ───────────────────────────────────────────────── -->
    <div class="card" id="gh-live-card">
      <div class="card-title">GitHub Live</div>
      <div class="emit-row">
        <div class="emit-info">
          <span class="emit-title">Periodic emit</span>
          <span class="badge badge-off" id="gh-emit-badge">OFF</span>
        </div>
        <button class="btn-enable" id="gh-emit-toggle-btn">Enable</button>
      </div>
    </div>

    <!-- ── GitHub Store card ──────────────────────────────────────────────── -->
    <div class="card" id="gh-store-card">
      <div class="card-title">GitHub Store</div>
      <div class="gh-counters">
        <div class="gh-counter">
          <span class="gh-counter-val" id="gh-cnt-repos">—</span>
          <span class="gh-counter-lbl">Repos</span>
        </div>
        <div class="gh-counter">
          <span class="gh-counter-val" id="gh-cnt-deployments">—</span>
          <span class="gh-counter-lbl">Deployments</span>
        </div>
        <div class="gh-counter">
          <span class="gh-counter-val" id="gh-cnt-statuses">—</span>
          <span class="gh-counter-lbl">Statuses</span>
        </div>
        <div class="gh-counter">
          <span class="gh-counter-val" id="gh-cnt-workflows">—</span>
          <span class="gh-counter-lbl">Workflows</span>
        </div>
        <div class="gh-counter">
          <span class="gh-counter-val" id="gh-cnt-environments">—</span>
          <span class="gh-counter-lbl">Environments</span>
        </div>
      </div>
      <div class="gh-meta" id="gh-store-meta">Not seeded</div>
    </div>

  </div>

  <!-- ── Status bar (fixed footer) ────────────────────────────────────────── -->
  <div class="status-bar">
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

    // Interactive control cards — dimmed while reset_state == blocked.
    // GitHub Seed + GitHub Live are interactive (mutators); GitHub Store is a data surface.
    const interactiveCards = [$('ingest-card'), $('emit-card'), $('control-api-card'), $('gh-seed-card'), $('gh-live-card')];

    // Control API Events card refs (data feed — exempt from card-blocked dimming).
    const ctrlLiveBadge  = $('ctrl-live-badge');
    const ctrlClearBtn   = $('ctrl-clear-btn');
    const ctrlFeedList   = $('ctrl-feed-list');
    const ctrlFeedEmpty  = $('ctrl-feed-empty');

    // Component Events card refs (data feed — exempt from card-blocked dimming).
    const compFeedList   = $('comp-feed-list');
    const compFeedEmpty  = $('comp-feed-empty');

    // Interactive controls blocked during reset.
    const interactiveControls = [
      ingestBtn, ingestStopBtn, emitToggleBtn, resetApiBtn,
      datasetSelect, countInput, delayInput, resetCheck,
      $('gh-seed-btn'), $('gh-clear-btn'), $('gh-emit-toggle-btn'),
      $('gh-dataset-select'), $('gh-count-input'), $('gh-reset-check'),
    ];

    let pollTimer        = null;
    let eventSource      = null;
    let ctrlEventSource  = null;
    let compPollTimer    = null;
    let ghStatusPollTimer = null;
    let emitting         = false;
    let ghEmitting       = false;
    let isBlocked        = false;

    // ── Dataset toggle ────────────────────────────────────────────────────────
    datasetSelect.addEventListener('change', () => {
      const isRandom = datasetSelect.value === 'random';
      countLbl.style.display   = isRandom ? '' : 'none';
      countInput.style.display = isRandom ? '' : 'none';
    });

    // ── GitHub dataset toggle ─────────────────────────────────────────────────
    $('gh-dataset-select').addEventListener('change', () => {
      const isRandom = $('gh-dataset-select').value === 'random';
      $('gh-count-lbl').style.display   = isRandom ? '' : 'none';
      $('gh-count-input').style.display = isRandom ? '' : 'none';
    });

    // ── Boot ─────────────────────────────────────────────────────────────────
    (async () => {
      await Promise.all([refreshStatus(), refreshEmit(), refreshGithubEmit(), refreshGithubStatus()]);
      connectStream();
      connectControlStream();
      startCompEventsPoll();
      startGithubStatusPoll();
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

    async function refreshGithubEmit() {
      try {
        const data = await apiFetch('/demo/github/emit');
        applyGithubEmit(data);
      } catch {}
    }

    async function refreshGithubStatus() {
      try {
        const data = await apiFetch('/demo/github/status');
        applyGithubStatus(data);
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

    function applyGithubEmit(d) {
      ghEmitting = !!(d && d.emitting);
      const badge  = $('gh-emit-badge');
      const btn    = $('gh-emit-toggle-btn');
      badge.textContent = ghEmitting ? 'LIVE' : 'OFF';
      badge.className   = 'badge ' + (ghEmitting ? 'badge-on' : 'badge-off');
      btn.textContent   = ghEmitting ? 'Disable' : 'Enable';
      btn.className     = ghEmitting ? 'btn-stop' : 'btn-enable';
    }

    function applyGithubStatus(d) {
      if (!d) return;
      $('gh-cnt-repos').textContent        = d.repos         !== undefined ? String(d.repos)         : '—';
      $('gh-cnt-deployments').textContent  = d.deployments   !== undefined ? String(d.deployments)   : '—';
      $('gh-cnt-statuses').textContent     = d.statuses      !== undefined ? String(d.statuses)       : '—';
      $('gh-cnt-workflows').textContent    = d.workflows      !== undefined ? String(d.workflows)     : '—';
      $('gh-cnt-environments').textContent = d.environments   !== undefined ? String(d.environments)  : '—';

      const datasetText  = d.dataset   ? '<span class="gh-dataset-badge">' + esc(d.dataset) + '</span>' : '';
      const seededText   = d.seeded_at ? ' · seeded ' + fmt(d.seeded_at) : '';
      $('gh-store-meta').innerHTML = datasetText + seededText || 'Not seeded';
    }

    function schedulePoll() {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => { await refreshStatus(); }, 600);
    }

    function startGithubStatusPoll() {
      refreshGithubStatus();
      ghStatusPollTimer = setInterval(refreshGithubStatus, 5000);
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
      feedList.innerHTML = '';
      feedList.appendChild(feedEmpty);
    });

    ctrlClearBtn.addEventListener('click', () => {
      ctrlFeedList.innerHTML = '';
      ctrlFeedList.appendChild(ctrlFeedEmpty);
    });

    // ── GitHub Seed / Clear ───────────────────────────────────────────────────
    $('gh-seed-btn').addEventListener('click', async () => {
      if (isBlocked) return;
      const dataset = $('gh-dataset-select').value;
      const doReset = $('gh-reset-check').checked;
      const body    = { dataset, reset: doReset };
      if (dataset === 'random') {
        body.count = Math.max(1, parseInt($('gh-count-input').value, 10) || 5);
      }
      const msg = $('gh-seed-msg');
      msg.textContent = '';
      msg.className   = 'api-msg';
      try {
        const res = await fetch('/demo/github/seed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          msg.textContent = '\\u2713 Seeded';
          msg.className   = 'api-msg ok';
          applyGithubStatus(data);
        } else {
          msg.textContent = '\\u2717 HTTP ' + res.status;
          msg.className   = 'api-msg err';
        }
      } catch {
        msg.textContent = '\\u2717 Network error';
        msg.className   = 'api-msg err';
      }
      refreshGithubStatus();
    });

    $('gh-clear-btn').addEventListener('click', async () => {
      if (isBlocked) return;
      const msg = $('gh-seed-msg');
      msg.textContent = '';
      msg.className   = 'api-msg';
      try {
        const res = await fetch('/demo/github/clear', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (res.ok) {
          msg.textContent = '\\u2713 Cleared';
          msg.className   = 'api-msg ok';
        } else {
          msg.textContent = '\\u2717 HTTP ' + res.status;
          msg.className   = 'api-msg err';
        }
      } catch {
        msg.textContent = '\\u2717 Network error';
        msg.className   = 'api-msg err';
      }
      refreshGithubStatus();
    });

    // ── GitHub Live emission ───────────────────────────────────────────────────
    $('gh-emit-toggle-btn').addEventListener('click', () => {
      if (isBlocked) return;
      const btn = $('gh-emit-toggle-btn');
      btn.disabled = true;
      fetch('/demo/github/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !ghEmitting }),
      })
        .then(r => r.json())
        .then(applyGithubEmit)
        .catch(() => {})
        .finally(() => { btn.disabled = isBlocked; });
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
      if (feedEmpty.parentNode === feedList) feedList.removeChild(feedEmpty);

      const time   = fmt(d.posted_at || new Date().toISOString());
      // Source: use reporter field per §4.6; derive colour from trailing segment.
      const reporter    = d.reporter || '';
      const isEmit      = reporter.endsWith('/emit');
      const sourceClass = isEmit ? 'fi-source-emit' : 'fi-source-ingest';

      let detailsHtml;
      let eventClass;
      if (type === 'posted') {
        eventClass   = 'fi-event-posted';
        detailsHtml  = esc(d.service) + ' / ' + esc(d.environment) + ' \\u2192 ' + esc(d.status);
      } else {
        eventClass   = 'fi-event-error';
        detailsHtml  = 'HTTP ' + esc(String(d.http_status)) + ' \\u00b7 attempt ' + esc(String(d.attempt));
      }

      const row = feedRow({
        time,
        source:      reporter,
        sourceClass,
        event:       type,
        eventClass,
        id:          d.deployment_id || '',
        detailsHtml,
      });
      feedList.insertBefore(row, feedList.firstChild);
    }

    // ── Control API Events SSE (GET /demo/control-stream) ────────────────────
    function connectControlStream() {
      if (ctrlEventSource) { try { ctrlEventSource.close(); } catch {} }
      setCtrlLiveBadge('connecting');
      ctrlEventSource = new EventSource('/demo/control-stream');

      ctrlEventSource.onopen = () => setCtrlLiveBadge('live');

      // Named events for known reset lifecycle types.
      ctrlEventSource.addEventListener('reset-initiated', e => {
        addCtrlFeedItem('reset-initiated', e.data);
      });
      ctrlEventSource.addEventListener('reset-started', e => {
        addCtrlFeedItem('reset-started', e.data);
      });
      ctrlEventSource.addEventListener('reset-completed', e => {
        addCtrlFeedItem('reset-completed', e.data);
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
        addCtrlFeedItem('unknown', e.data);
      };

      ctrlEventSource.onerror = () => setCtrlLiveBadge('reconnecting');
    }

    function setCtrlLiveBadge(mode) {
      const labels = { connecting: '● CONNECTING', live: '● LIVE', reconnecting: '● RECONNECTING' };
      ctrlLiveBadge.textContent = labels[mode] || mode;
      ctrlLiveBadge.className   = 'live-badge live-' + mode;
    }

    function addCtrlFeedItem(type, rawData) {
      let d = {};
      try { d = JSON.parse(rawData); } catch {}

      if (ctrlFeedEmpty.parentNode === ctrlFeedList) ctrlFeedList.removeChild(ctrlFeedEmpty);

      const eventClass = type === 'reset-initiated' ? 'fi-type-initiated'
                       : type === 'reset-started'   ? 'fi-type-started'
                       : type === 'reset-completed'  ? 'fi-type-completed'
                       :                               'fi-type-unknown';

      const time       = d.occurred_at ? fmt(d.occurred_at) : fmt(new Date().toISOString());
      const detailsHtml = d.reset_id
        ? 'reset_id: <span class="fi-id">' + esc(d.reset_id) + '</span>'
        : '';

      const row = feedRow({
        time,
        source:      d.component || '',
        sourceClass: 'fi-source-ctrl',
        event:       type,
        eventClass,
        id:          d.id || '',
        detailsHtml,
      });
      ctrlFeedList.insertBefore(row, ctrlFeedList.firstChild);
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
        renderCompEvents(page.items || []);
      } catch {
        // Network error: keep existing list; badge stays POLLING.
      }
    }

    function renderCompEvents(items) {
      compFeedList.innerHTML = '';
      if (!items.length) {
        compFeedList.appendChild(compFeedEmpty);
        return;
      }
      // items arrive received_at DESC (newest first) per spec — render as-is.
      items.forEach(rec => {
        const stateCls = rec.state === 'running' ? 'fi-state-running'
                       : rec.state === 'error'   ? 'fi-state-error'
                       :                           'fi-state-neutral';

        const time     = rec.received_at ? fmt(rec.received_at) : '';
        // Details: coloured state first, then detail when present.
        const detailPart = rec.detail
          ? ' \\u00b7 <span class="fi-details">' + esc(rec.detail) + '</span>'
          : '';
        const detailsHtml =
          '<span class="' + stateCls + '">' + esc(rec.state || '') + '</span>' + detailPart;

        const row = feedRow({
          time,
          source:      rec.component_id || '',
          sourceClass: 'fi-source-comp',
          event:       rec.event_type   || '',
          eventClass:  'fi-event-neutral',
          id:          rec.id           || '',
          detailsHtml,
        });
        compFeedList.appendChild(row);
      });
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

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
