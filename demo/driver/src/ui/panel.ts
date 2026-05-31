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
      padding: 24px 24px 72px;
      min-height: 100vh;
    }
    h1 {
      font-size: 1.25rem; font-weight: 600; color: #f4f4f5;
      margin-bottom: 20px; letter-spacing: 0.03em;
    }
    h1 span { color: #6366f1; }

    /* Layout */
    /* Top row: flex row of exactly three cards, proportional grow */
    .top-row {
      display: flex; flex-wrap: wrap; gap: 14px;
      align-items: stretch;
    }
    .top-row .card-ingest    { flex: 2.2 1 260px; min-width: 260px; }
    .top-row .card-gh-emulator { flex: 1.6 1 260px; min-width: 260px; }
    .top-row .card-control-api { flex: 1 1 260px; min-width: 260px; }

    /* Full-width feed cards stack below */
    .full { width: 100%; }

    /* Card */
    .card {
      background: #18181b; border: 1px solid #27272a;
      border-radius: 10px; padding: 18px;
    }
    .card-title {
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.1em; color: #71717a; margin-bottom: 14px;
    }

    /* Sub-section inside a card */
    .sub-section {
      border-top: 1px solid #27272a;
      margin-top: 14px;
      padding-top: 12px;
    }
    .sub-section-title {
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.09em; color: #52525b; margin-bottom: 10px;
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

    /* Liveness chip (status bar) */
    .chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; border-radius: 99px;
      font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em;
    }
    .chip-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .chip-up      { background: #14532d; color: #86efac; }
    .chip-down    { background: #450a0a; color: #f87171; }
    .chip-checking { background: #451a03; color: #fb923c; }

    /* Progress bar */
    .progress-bg   { background: #27272a; border-radius: 4px; height: 5px; overflow: hidden; }
    .progress-fill { background: #6366f1; height: 100%; width: 0%; border-radius: 4px; transition: width 0.4s; }

    /* Emit-style row (used in sub-sections) */
    .emit-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .emit-info { display: flex; flex-direction: column; gap: 6px; }
    .emit-title { font-size: 0.88rem; color: #d4d4d8; }

    /* Status bar (fixed top) */
    .status-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      background: #111115; border-bottom: 1px solid #27272a;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 7px 24px;
    }
    .sb-prog { flex: 1 1 100px; max-width: 160px; }
    .sb-lbl  { font-size: 0.7rem; color: #52525b; white-space: nowrap; }
    .sb-val  { font-size: 0.78rem; color: #a1a1aa; }
    .sb-val.err { color: #f87171; }
    .sb-sep  { color: #3f3f46; user-select: none; }

    /* Push page content below the status bar */
    body { padding-top: 60px; }

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

    /* Unified five-column row grid */
    .feed-row {
      display: grid;
      grid-template-columns: 8rem 8rem 10rem 11rem 1fr;
      gap: 0 8px;
      align-items: baseline;
    }
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
    .fi-type-initiated  { background: #451a03; color: #fb923c; }
    .fi-type-started    { background: #1a2744; color: #60a5fa; }
    .fi-type-completed  { background: #14532d; color: #86efac; }
    .fi-type-unknown    { background: #27272a; color: #a1a1aa; }
    .fi-id      { color: #d4d4d8; font-weight: 600; font-size: 0.72rem;
                  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fi-details { color: #71717a; overflow: hidden; text-overflow: ellipsis; }

    /* Component Events — state colour coding within .fi-details */
    .fi-state-running   { color: #86efac; }
    .fi-state-error     { color: #f87171; }
    .fi-state-neutral   { color: #a1a1aa; }

    /* Card dim — applied to interactive cards while reset_state == blocked */
    .card-blocked { opacity: 0.45; pointer-events: none; }

    /* GitHub store one-liner */
    .gh-store-line { font-size: 0.72rem; color: #71717a; margin-top: 10px; padding-top: 10px; border-top: 1px solid #27272a; }
    .gh-dataset-badge { display: inline-block; padding: 1px 7px; border-radius: 3px;
                        font-size: 0.65rem; font-weight: 700; letter-spacing: 0.06em;
                        background: #1a2744; color: #60a5fa; margin-right: 4px; }
  </style>
</head>
<body>

  <!-- ── Status bar (fixed top) ─────────────────────────────────────────────── -->
  <div class="status-bar">
    <span class="chip chip-checking" id="chip-driver"><span class="chip-dot"></span>Driver</span>
    <span class="chip chip-checking" id="chip-api"><span class="chip-dot"></span>API</span>
    <span class="chip chip-checking" id="chip-emulator"><span class="chip-dot"></span>Emulator</span>
    <span class="chip chip-checking" id="chip-fetcher"><span class="chip-dot"></span>Fetcher</span>
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

  <h1>Demo <span>Driver</span></h1>

  <!-- ── Top row: Ingest · GitHub Emulator · Control API ───────────────────── -->
  <div class="top-row">

    <!-- ── Ingest card ────────────────────────────────────────────────────────── -->
    <div class="card card-ingest" id="ingest-card">
      <div class="card-title">Ingest</div>

      <!-- Ingest sub-section -->
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

      <!-- Live Emission sub-section -->
      <div class="sub-section" id="live-emission-section">
        <div class="sub-section-title">Live Emission</div>
        <div class="emit-row">
          <div class="emit-info">
            <span class="emit-title">Random events</span>
            <span class="badge badge-off" id="emit-badge">OFF</span>
          </div>
          <button class="btn-enable" id="emit-toggle-btn">Enable</button>
        </div>
      </div>
    </div>

    <!-- ── GitHub Emulator card (hidden until emulator=="up") ───────────────── -->
    <div class="card card-gh-emulator" id="gh-emulator-card" style="display:none">
      <div class="card-title">GitHub Emulator</div>

      <!-- Seed sub-section (interactive — dims on reset) -->
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

      <!-- Live sub-section (interactive — dims on reset) -->
      <div class="sub-section" id="gh-live-section">
        <div class="sub-section-title">Live</div>
        <div class="emit-row">
          <div class="emit-info">
            <span class="emit-title">Periodic emit</span>
            <span class="badge badge-off" id="gh-emit-badge">OFF</span>
          </div>
          <button class="btn-enable" id="gh-emit-toggle-btn">Enable</button>
        </div>
      </div>

      <!-- Store one-liner (data surface — never dimmed) -->
      <div class="gh-store-line" id="gh-store-line">Not seeded</div>
    </div>

    <!-- ── Control API card ──────────────────────────────────────────────────── -->
    <div class="card card-control-api" id="control-api-card">
      <div class="card-title">Control API</div>
      <div class="emit-row">
        <div class="emit-info">
          <span class="lbl">Reset state</span>
          <span class="badge badge-reset-idle" id="reset-state-badge">IDLE</span>
          <div class="reset-id" id="reset-id-display"></div>
        </div>
        <button class="btn-stop" id="reset-api-btn">Reset System</button>
      </div>
      <div class="api-msg-row">
        <span class="api-msg" id="reset-api-msg"></span>
      </div>
    </div>

  </div><!-- /.top-row -->

  <!-- ── Feed cards (full width) ────────────────────────────────────────────── -->
    <!-- ── Post Feed card ────────────────────────────────────────────────────── -->
    <div class="card full" style="margin-top:14px">
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

    <!-- ── Events card (full row) — merged control-stream + component events ── -->
    <div class="card full" id="events-card" style="margin-top:14px">
      <div class="feed-header">
        <div class="card-title">Events</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="live-badge live-connecting" id="evt-live-badge">● CONNECTING</span>
          <button class="btn-sm" id="evt-clear-btn">Clear</button>
        </div>
      </div>
      <div class="feed-list" id="evt-feed-list">
        <div class="feed-empty" id="evt-feed-empty">No events yet.</div>
      </div>
    </div>

  <script>
    'use strict';
    const $ = id => document.getElementById(id);

    // ── Element refs ─────────────────────────────────────────────────────────────
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

    // Events card refs (merged feed — data surface, never dimmed)
    const evtLiveBadge = $('evt-live-badge');
    const evtClearBtn  = $('evt-clear-btn');
    const evtFeedList  = $('evt-feed-list');
    const evtFeedEmpty = $('evt-feed-empty');

    // Liveness chip refs
    const chipDriver   = $('chip-driver');
    const chipApi      = $('chip-api');
    const chipEmulator = $('chip-emulator');
    const chipFetcher  = $('chip-fetcher');

    // Interactive control cards — dimmed while reset_state == blocked.
    const interactiveCards = [$('ingest-card'), $('gh-emulator-card'), $('control-api-card')];

    // Individual interactive controls disabled during reset.
    const interactiveControls = [
      ingestBtn, ingestStopBtn, emitToggleBtn, resetApiBtn,
      datasetSelect, countInput, delayInput, resetCheck,
      $('gh-seed-btn'), $('gh-clear-btn'), $('gh-emit-toggle-btn'),
      $('gh-dataset-select'), $('gh-count-input'), $('gh-reset-check'),
    ];

    let pollTimer        = null;
    let healthPollTimer  = null;
    let ghStatusPollTimer = null;
    let eventSource      = null;
    let ctrlEventSource  = null;
    let compPollTimer    = null;
    let emitting         = false;
    let ghEmitting       = false;
    let isBlocked        = false;

    // ── localStorage keys & caps ───────────────────────────────────────────────
    const LS_POSTS  = 'dd.posts';   // cap: 10 rows
    const LS_EVENTS = 'dd.events';  // cap: 20 rows
    const CAP_POSTS  = 10;
    const CAP_EVENTS = 20;

    // ── Merged events in-memory store ─────────────────────────────────────────
    // Each entry: { _ts: ISO string (sortable), id: string, kind: 'control'|'component', ...original fields }
    let eventsStore = [];

    // ── Helpers ───────────────────────────────────────────────────────────────
    async function apiFetch(url, opts = {}) {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
      });
      return res.json();
    }

    function fmtMs(iso) {
      // Format with milliseconds: HH:MM:SS.mmm
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const hh  = String(d.getHours()).padStart(2, '0');
      const mm  = String(d.getMinutes()).padStart(2, '0');
      const ss  = String(d.getSeconds()).padStart(2, '0');
      const ms  = String(d.getMilliseconds()).padStart(3, '0');
      return hh + ':' + mm + ':' + ss + '.' + ms;
    }

    // Legacy fmt used by status bar (no ms required there)
    function fmt(iso) {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Dataset toggle ────────────────────────────────────────────────────────
    datasetSelect.addEventListener('change', () => {
      const isRandom = datasetSelect.value === 'random';
      countLbl.style.display   = isRandom ? '' : 'none';
      countInput.style.display = isRandom ? '' : 'none';
    });

    $('gh-dataset-select').addEventListener('change', () => {
      const isRandom = $('gh-dataset-select').value === 'random';
      $('gh-count-lbl').style.display   = isRandom ? '' : 'none';
      $('gh-count-input').style.display = isRandom ? '' : 'none';
    });

    // ── Boot ──────────────────────────────────────────────────────────────────
    (async () => {
      hydrateFromStorage();
      await Promise.all([refreshStatus(), refreshEmit(), refreshGithubEmit()]);
      connectStream();
      connectControlStream();
      startCompEventsPoll();
      startHealthPoll();
      startGithubStatusPoll();
    })();

    // ── Health poll → liveness chips + emulator card visibility ──────────────
    function startHealthPoll() {
      refreshHealth();
      healthPollTimer = setInterval(refreshHealth, 5000);
    }

    async function refreshHealth() {
      try {
        const h = await apiFetch('/demo/health');
        setChip(chipDriver,   h.driver   || 'down');
        setChip(chipApi,      h.api      || 'down');
        setChip(chipEmulator, h.emulator || 'down');
        setChip(chipFetcher,  h.fetcher  || 'down');
        // Emulator card visibility driven exclusively by /demo/health emulator field.
        setEmulatorCardVisible(h.emulator === 'up');
      } catch {
        // Network error: mark all non-driver chips as checking.
        setChip(chipApi,      'checking');
        setChip(chipEmulator, 'checking');
        setChip(chipFetcher,  'checking');
      }
    }

    function setChip(el, status) {
      // status: 'up' | 'down' | 'checking'
      const cls = status === 'up' ? 'chip-up' : status === 'down' ? 'chip-down' : 'chip-checking';
      el.className = 'chip ' + cls;
    }

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

    // Emulator card visibility is controlled solely by /demo/health emulator field.
    let emulatorCardVisible = false;
    function setEmulatorCardVisible(visible) {
      if (visible === emulatorCardVisible) return;
      emulatorCardVisible = visible;
      const card = $('gh-emulator-card');
      if (card) card.style.display = visible ? '' : 'none';
    }

    // GitHub Store data (counters) is still sourced from GET /demo/github/status.
    function startGithubStatusPoll() {
      refreshGithubStatus();
      ghStatusPollTimer = setInterval(refreshGithubStatus, 5000);
    }

    async function refreshGithubStatus() {
      try {
        const res = await fetch('/demo/github/status', { headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) return;
        applyGithubStatus(await res.json());
      } catch {}
    }

    function applyStatus(d) {
      const state      = d.state      || 'idle';
      const resetState = d.reset_state || 'idle';
      const resetId    = d.reset_id   || null;

      // Scenario state badge — status bar.
      stateBadge.textContent = state;
      stateBadge.className   = 'badge badge-' + state;

      // Reset-state indicators.
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
        interactiveControls.forEach(el => { el.disabled = false; });
        ingestBtn.disabled     = state === 'running';
        ingestStopBtn.disabled = state !== 'running';
      }

      const total = d.events_total || 0;
      const sent  = d.events_sent  || 0;
      const pct   = total > 0 ? (sent / total * 100) : 0;

      // Update status bar.
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
      // One-liner: dataset · N repos · seeded HH:MM
      const line = $('gh-store-line');
      if (!line) return;
      if (!d.seeded_at && d.repos === undefined) { line.innerHTML = 'Not seeded'; return; }
      const datasetBadge = d.dataset
        ? '<span class="gh-dataset-badge">' + esc(d.dataset) + '</span>'
        : '';
      const reposText  = d.repos !== undefined ? String(d.repos) + ' repos' : '';
      const seededText = d.seeded_at ? 'seeded ' + fmt(d.seeded_at) : '';
      const parts = [reposText, seededText].filter(Boolean).join(' · ');
      line.innerHTML = datasetBadge + parts;
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
    emitToggleBtn.addEventListener('click', () => {
      if (isBlocked) return;
      emitToggleBtn.disabled = true;
      apiFetch('/demo/emit', {
        method: 'POST',
        body:   JSON.stringify({ enabled: !emitting }),
      }).then(applyEmit)
        .catch(() => {})
        .finally(() => { emitToggleBtn.disabled = isBlocked; });
    });

    // ── API reset ─────────────────────────────────────────────────────────────
    resetApiBtn.addEventListener('click', () => {
      if (isBlocked) return;
      resetApiBtn.disabled = true;
      resetApiMsg.textContent = '';
      resetApiMsg.className   = 'api-msg';
      apiFetch('/demo/api-reset', { method: 'POST' })
        .then(d => {
          if (d.ok) {
            resetApiMsg.textContent = '\\u2713 Reset OK (' + d.http_status + ')';
            resetApiMsg.className   = 'api-msg ok';
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
    });

    // ── Post Feed clear ───────────────────────────────────────────────────────
    clearBtn.addEventListener('click', () => {
      feedRows = [];
      localStorage.removeItem(LS_POSTS);
      feedList.innerHTML = '';
      feedList.appendChild(feedEmpty);
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

    // ── SSE stream (Post Feed) ─────────────────────────────────────────────────
    // In-memory ordered list of post-feed rows (newest-first, capped at CAP_POSTS).
    let feedRows = [];

    function connectStream() {
      if (eventSource) { try { eventSource.close(); } catch {} }
      setLiveBadge('connecting');
      eventSource = new EventSource('/demo/stream');

      eventSource.onopen = () => setLiveBadge('live');

      eventSource.addEventListener('posted', e => {
        const d = JSON.parse(e.data);
        prependFeedRow(d, 'posted');
        refreshStatus();
      });

      eventSource.addEventListener('error', e => {
        if (e.data) {
          prependFeedRow(JSON.parse(e.data), 'error');
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

    // Prepend a post-feed row, persist to localStorage (cap CAP_POSTS).
    function prependFeedRow(d, type) {
      const entry = Object.assign({ _type: type }, d);
      feedRows.unshift(entry);
      if (feedRows.length > CAP_POSTS) feedRows = feedRows.slice(0, CAP_POSTS);
      persistPosts();
      renderFeed();
    }

    function persistPosts() {
      try { localStorage.setItem(LS_POSTS, JSON.stringify(feedRows)); } catch {}
    }

    function renderFeed() {
      feedList.innerHTML = '';
      if (!feedRows.length) { feedList.appendChild(feedEmpty); return; }
      feedRows.forEach(d => {
        const type   = d._type || 'posted';
        const time   = fmtMs(d.posted_at || new Date().toISOString());
        const reporter    = d.reporter || '';
        const isEmit      = reporter.endsWith('/emit');
        const sourceClass = isEmit ? 'fi-source-emit' : 'fi-source-ingest';

        let detailsHtml, eventClass;
        if (type === 'posted') {
          eventClass  = 'fi-event-posted';
          detailsHtml = esc(d.service) + ' / ' + esc(d.environment) + ' \\u2192 ' + esc(d.status);
        } else {
          eventClass  = 'fi-event-error';
          detailsHtml = 'HTTP ' + esc(String(d.http_status)) + ' \\u00b7 attempt ' + esc(String(d.attempt));
        }

        feedList.appendChild(feedRow({
          time, source: reporter, sourceClass,
          event: type, eventClass,
          id: d.deployment_id || '',
          detailsHtml,
        }));
      });
    }

    // ── Shared unified row renderer ───────────────────────────────────────────
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
        '<span class="fi-time">'    + esc(time)                                        + '</span>' +
        srcHtml                                                                                    +
        '<span class="fi-event ' + (eventClass || 'fi-event-neutral') + '">' + esc(evtLabel) + '</span>' +
        idHtml                                                                                     +
        '<span class="fi-details">' + (detailsHtml || '')                              + '</span>';
      return row;
    }

    // ── Merged Events feed ────────────────────────────────────────────────────
    // Single in-memory array deduped by id, sorted by _ts DESC (newest first).
    // Sourced from: control-stream SSE (kind='control') + component-events poll (kind='component').

    // Events clear button
    evtClearBtn.addEventListener('click', () => {
      eventsStore = [];
      localStorage.removeItem(LS_EVENTS);
      evtFeedList.innerHTML = '';
      evtFeedList.appendChild(evtFeedEmpty);
    });

    function mergeEvents(newRows) {
      // Merge new rows into eventsStore, dedup by id.
      newRows.forEach(r => {
        const idx = eventsStore.findIndex(x => x.id === r.id);
        if (idx >= 0) {
          eventsStore[idx] = r; // update in place
        } else {
          eventsStore.push(r);
        }
      });
      // Sort datetime DESC.
      eventsStore.sort((a, b) => {
        const ta = new Date(a._ts || 0).getTime();
        const tb = new Date(b._ts || 0).getTime();
        return tb - ta;
      });
      // Trim to cap.
      if (eventsStore.length > CAP_EVENTS) eventsStore = eventsStore.slice(0, CAP_EVENTS);
      persistEvents();
      renderEventsStore();
    }

    function persistEvents() {
      try { localStorage.setItem(LS_EVENTS, JSON.stringify(eventsStore)); } catch {}
    }

    function renderEventsStore() {
      evtFeedList.innerHTML = '';
      if (!eventsStore.length) { evtFeedList.appendChild(evtFeedEmpty); return; }
      eventsStore.forEach(r => {
        let time, source, sourceClass, evtLabel, eventClass, id, detailsHtml;

        if (r.kind === 'control') {
          time        = fmtMs(r._ts || new Date().toISOString());
          source      = 'control-api';
          sourceClass = 'fi-source-ctrl';
          evtLabel    = r.type || 'unknown';
          eventClass  = r.type === 'reset-initiated' ? 'fi-type-initiated'
                      : r.type === 'reset-started'   ? 'fi-type-started'
                      : r.type === 'reset-completed'  ? 'fi-type-completed'
                      :                                 'fi-type-unknown';
          id          = r.id || '';
          detailsHtml = r.reset_id
            ? 'reset_id: <span class="fi-id">' + esc(r.reset_id) + '</span>'
            : '';
        } else {
          // kind === 'component'
          time        = fmtMs(r._ts || new Date().toISOString());
          source      = r.component_id || '';
          sourceClass = 'fi-source-comp';
          evtLabel    = r.event_type || '';
          eventClass  = 'fi-event-neutral';
          id          = r.id || '';
          const stateCls = r.state === 'running' ? 'fi-state-running'
                         : r.state === 'error'   ? 'fi-state-error'
                         :                         'fi-state-neutral';
          const detailPart = r.detail
            ? ' \\u00b7 <span class="fi-details">' + esc(r.detail) + '</span>'
            : '';
          detailsHtml =
            '<span class="' + stateCls + '">' + esc(r.state || '') + '</span>' + detailPart;
        }

        evtFeedList.appendChild(feedRow({ time, source, sourceClass, event: evtLabel, eventClass, id, detailsHtml }));
      });
    }

    // ── Control-stream SSE → Events feed ────────────────────────────────────
    function connectControlStream() {
      if (ctrlEventSource) { try { ctrlEventSource.close(); } catch {} }
      setEvtLiveBadge('connecting');
      ctrlEventSource = new EventSource('/demo/control-stream');

      ctrlEventSource.onopen = () => setEvtLiveBadge('live');

      const handleCtrlFrame = (type, rawData) => {
        let d = {};
        try { d = JSON.parse(rawData); } catch {}
        const row = Object.assign({}, d, {
          kind: 'control',
          type: type === 'unknown' ? (d.type || 'unknown') : type,
          _ts:  d.occurred_at || new Date().toISOString(),
          id:   d.id || (Date.now() + '-' + Math.random()), // fallback id for dedup
        });
        mergeEvents([row]);
      };

      ctrlEventSource.addEventListener('reset-initiated', e => handleCtrlFrame('reset-initiated', e.data));
      ctrlEventSource.addEventListener('reset-started',   e => handleCtrlFrame('reset-started',   e.data));
      ctrlEventSource.addEventListener('reset-completed', e => handleCtrlFrame('reset-completed',  e.data));

      // Forward unnamed frames (forward-compat).
      ctrlEventSource.onmessage = e => {
        if (!e.data) return;
        handleCtrlFrame('unknown', e.data);
      };

      ctrlEventSource.onerror = () => setEvtLiveBadge('reconnecting');
    }

    function setEvtLiveBadge(mode) {
      const labels = { connecting: '● CONNECTING', live: '● LIVE', reconnecting: '● RECONNECTING' };
      evtLiveBadge.textContent = labels[mode] || mode;
      evtLiveBadge.className   = 'live-badge live-' + mode;
    }

    // ── Component events poll → Events feed ──────────────────────────────────
    function startCompEventsPoll() {
      fetchCompEvents();
      compPollTimer = setInterval(fetchCompEvents, 5000);
    }

    async function fetchCompEvents() {
      try {
        const page = await apiFetch('/demo/control-events');
        const items = page.items || [];
        const rows = items.map(rec => ({
          kind:         'component',
          _ts:          rec.received_at || new Date().toISOString(),
          id:           rec.id           || '',
          component_id: rec.component_id || '',
          event_type:   rec.event_type   || '',
          state:        rec.state        || '',
          detail:       rec.detail       || '',
          received_at:  rec.received_at  || '',
        }));
        mergeEvents(rows);
      } catch {}
    }

    // ── localStorage hydration ────────────────────────────────────────────────
    function hydrateFromStorage() {
      // Post Feed
      try {
        const raw = localStorage.getItem(LS_POSTS);
        if (raw) {
          feedRows = JSON.parse(raw);
          if (!Array.isArray(feedRows)) feedRows = [];
          renderFeed();
        }
      } catch { feedRows = []; }

      // Events feed
      try {
        const raw = localStorage.getItem(LS_EVENTS);
        if (raw) {
          eventsStore = JSON.parse(raw);
          if (!Array.isArray(eventsStore)) eventsStore = [];
          // Restore kind field for any migrated rows.
          eventsStore.forEach(r => { if (!r.kind) r.kind = 'component'; });
          renderEventsStore();
        }
      } catch { eventsStore = []; }
    }
  </script>
</body>
</html>`;
