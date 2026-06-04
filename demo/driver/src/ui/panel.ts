/** Flat SVG mark — served at GET /demo/favicon.svg. */
export const FAVICON_SVG = `<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="62" height="62" rx="14" fill="#1d1a55"></rect><path d="M 23 29.4 C 31 29.4, 29 18, 37 18" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.8" stroke-linecap="round"></path><path d="M 37.5 15 L 40.5 18 L 37.5 21 Z" fill="rgba(255,255,255,0.85)"></path><path d="M 23 32 C 31 32, 29 32, 37 32" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.8" stroke-linecap="round"></path><path d="M 37.5 29 L 40.5 32 L 37.5 35 Z" fill="rgba(255,255,255,0.85)"></path><path d="M 23 34.6 C 31 34.6, 29 46, 37 46" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.8" stroke-linecap="round"></path><path d="M 37.5 43 L 40.5 46 L 37.5 49 Z" fill="rgba(255,255,255,0.85)"></path><rect x="10" y="27" width="13" height="10" rx="2.8" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)" stroke-width="0.9"></rect><rect x="10" y="27" width="2.8" height="10" rx="1.3" fill="#fff"></rect><rect x="42" y="13" width="13" height="10" rx="2.8" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)" stroke-width="0.9"></rect><rect x="42" y="13" width="2.8" height="10" rx="1.3" fill="#fff"></rect><rect x="42" y="27" width="13" height="10" rx="2.8" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)" stroke-width="0.9"></rect><rect x="42" y="27" width="2.8" height="10" rx="1.3" fill="#fff"></rect><rect x="42" y="41" width="13" height="10" rx="2.8" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)" stroke-width="0.9"></rect><rect x="42" y="41" width="2.8" height="10" rx="1.3" fill="#fff"></rect></svg>`;

/** Browser control panel — served at GET /demo/ (inline, no bundler). */
export const PANEL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo Driver</title>
  <link rel="icon" type="image/svg+xml" href="/demo/favicon.svg">
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

    /* Fetcher Rate-Limit card — hidden until first rate-limit event */
    #rl-card { display: none; }
    .rl-row  { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
    .rl-kv   { display: flex; align-items: baseline; gap: 4px; }
    .rl-key  { font-size: 0.65rem; color: #52525b; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }
    .rl-val  { font-size: 0.82rem; color: #d4d4d8; font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace; }
    .rl-sep  { color: #3f3f46; user-select: none; font-size: 0.7rem; }
    .badge-paused { background: #312e81; color: #a5b4fc; }
    .rl-progress-wrap { margin-top: 6px; }
    .rl-progress-label { display: flex; justify-content: space-between; font-size: 0.68rem; color: #71717a; margin-bottom: 3px; }

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

  <h1 style="display:flex;align-items:center;gap:10px">
    <svg width="28" height="28" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="border-radius:7px;flex-shrink:0">
      <defs>
        <linearGradient id="ddbg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2a2770"></stop>
          <stop offset="0.55" stop-color="#1b1850"></stop>
          <stop offset="1" stop-color="#121038"></stop>
        </linearGradient>
        <radialGradient id="ddsheen" cx="30%" cy="22%" r="90%">
          <stop offset="0" stop-color="rgba(150,142,255,0.55)"></stop>
          <stop offset="0.4" stop-color="rgba(120,110,255,0.12)"></stop>
          <stop offset="1" stop-color="rgba(120,110,255,0)"></stop>
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="14" fill="url(#ddbg)"></rect>
      <rect x="1" y="1" width="62" height="62" rx="14" fill="url(#ddsheen)"></rect>
      <rect x="1.5" y="1.5" width="61" height="61" rx="13.5" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1"></rect>
      <path d="M 23 29.4 C 31 29.4, 29 18, 37 18" fill="none" stroke="#34d29a" stroke-width="1.8" stroke-linecap="round"></path>
      <path d="M 37.5 15 L 40.5 18 L 37.5 21 Z" fill="#34d29a"></path>
      <path d="M 23 32 C 31 32, 29 32, 37 32" fill="none" stroke="#f5a524" stroke-width="1.8" stroke-linecap="round"></path>
      <path d="M 37.5 29 L 40.5 32 L 37.5 35 Z" fill="#f5a524"></path>
      <path d="M 23 34.6 C 31 34.6, 29 46, 37 46" fill="none" stroke="#ff5d5d" stroke-width="1.8" stroke-linecap="round"></path>
      <path d="M 37.5 43 L 40.5 46 L 37.5 49 Z" fill="#ff5d5d"></path>
      <rect x="10" y="27" width="13" height="10" rx="2.8" fill="rgba(180,175,255,0.15)" stroke="rgba(255,255,255,0.22)" stroke-width="0.9"></rect>
      <rect x="10" y="27" width="2.8" height="10" rx="1.3" fill="#34d29a"></rect>
      <rect x="42" y="13" width="13" height="10" rx="2.8" fill="rgba(180,175,255,0.15)" stroke="rgba(255,255,255,0.22)" stroke-width="0.9"></rect>
      <rect x="42" y="13" width="2.8" height="10" rx="1.3" fill="#34d29a"></rect>
      <rect x="42" y="27" width="13" height="10" rx="2.8" fill="rgba(180,175,255,0.15)" stroke="rgba(255,255,255,0.22)" stroke-width="0.9"></rect>
      <rect x="42" y="27" width="2.8" height="10" rx="1.3" fill="#f5a524"></rect>
      <rect x="42" y="41" width="13" height="10" rx="2.8" fill="rgba(180,175,255,0.15)" stroke="rgba(255,255,255,0.22)" stroke-width="0.9"></rect>
      <rect x="42" y="41" width="2.8" height="10" rx="1.3" fill="#ff5d5d"></rect>
    </svg>
    <span style="white-space:nowrap;color:#f4f4f5">Demo <span style="color:#6366f1">Driver</span></span>
  </h1>

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

    <!-- ── Fetcher · Rate Limit card ───────────────────────────────────────
         Hidden until the first rate-limit component event arrives.
         Consumes event_type: rate-limit off /demo/control-events (§4.9).
         These events are NOT added to the Events feed list (card-only).
         One section per adapter (keyed by payload.adapter, last-value-wins). -->
    <div class="card card-control" id="rl-card">
      <div class="card-title">Fetcher · Rate Limit</div>
      <div id="rl-adapters-container"></div>
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

    <!-- ── Deployments feed card ─────────────────────────────────────────── -->
    <div class="card">
      <div class="feed-header">
        <div class="card-title">Deployments</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="live-badge live-connecting" id="live-badge">● CONNECTING</span>
          <button class="btn-sm" id="clear-btn">Clear</button>
        </div>
      </div>
      <div class="feed-list" id="feed-list">
        <div class="feed-empty" id="feed-empty">No deployments received yet.</div>
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

    // Fetcher · Rate Limit card refs (shown/hidden by rate-limit component events).
    const rlCard             = $('rl-card');
    const rlAdaptersContainer = $('rl-adapters-container');

    // Per-adapter store: keyed by payload.adapter string, last-value-wins per adapter.
    // Shape: { [adapterName: string]: { state, p: payload } }
    const rlAdapterStore = {};

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

    let pollTimer           = null;
    let eventSource         = null;
    let ctrlEventSource     = null;
    let compEventSource     = null;
    let ghPollTimer         = null;
    let healthPollTimer     = null;
    let emitting            = false;
    let ghEmitting          = false;
    let isBlocked           = false;

    // Merged events store: dedup by id, sorted datetime DESC.
    let eventsStore = [];

    // Deployments feed store: latest 10, newest first; each entry is a rendered row obj.
    let deploymentsStore = [];

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
      connectComponentEvents();
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
      deploymentsStore = [];
      localStorage.removeItem('dd.deployments');
      feedList.innerHTML = '';
      feedList.appendChild(feedEmpty);
    });

    eventsClearBtn.addEventListener('click', () => {
      eventsStore = [];
      localStorage.removeItem('dd.events');
      renderEventsStore();
    });

    // ── Deployments SSE stream (GET /demo/deployments-stream) ────────────────
    // Re-broadcasts the API's real deployment stream as named "deployment" frames.
    // Each frame data is a DeploymentEvent JSON.
    function connectStream() {
      if (eventSource) { try { eventSource.close(); } catch {} }
      setLiveBadge('connecting');
      eventSource = new EventSource('/demo/deployments-stream');

      eventSource.onopen = () => setLiveBadge('live');

      eventSource.addEventListener('deployment', e => {
        if (!e.data) return;
        let d = {};
        try { d = JSON.parse(e.data); } catch { return; }
        addDeploymentRow(d);
      });

      eventSource.onerror = () => setLiveBadge('reconnecting');
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

    // Maps a deployment status string to a fi-event-* CSS class.
    // success → green, failure → red, in-progress / running / pending → amber, else neutral.
    function deploymentEventClass(status) {
      if (!status) return 'fi-event-neutral';
      const s = status.toLowerCase();
      if (s === 'success' || s === 'succeeded') return 'fi-event-posted';       // green
      if (s === 'failure' || s === 'failed'  || s === 'error') return 'fi-event-error'; // red
      if (s === 'in-progress' || s === 'in_progress' || s === 'running' || s === 'pending') {
        return 'fi-type-initiated'; // amber
      }
      return 'fi-event-neutral';
    }

    function addDeploymentRow(d) {
      // Dedup by deployment_id + happened_at to survive SSE reconnects.
      const uid = (d.deployment_id || '') + '|' + (d.happened_at || '');
      if (deploymentsStore.some(p => p._uid === uid)) return;

      const ts          = d.happened_at || new Date().toISOString();
      const source      = d.progress_reporter || '';
      // Source colour: fetcher-origin → blue (ingest); demo-driver origin → amber (emit).
      const sourceClass = source.startsWith('demo-driver') ? 'fi-source-emit' : 'fi-source-ingest';
      const status      = d.status || 'deployment';
      const eventClass  = deploymentEventClass(status);

      let detailsHtml = esc(d.service || '') + ' / ' + esc(d.environment || '') +
                        ' \\u2192 ' + esc(status);
      if (d.version) detailsHtml += ' \\u00b7 ' + esc(d.version);

      deploymentsStore.unshift({
        _uid: uid, _ts: ts,
        time: fmtMs(ts), source, sourceClass,
        event: status, eventClass,
        id: d.deployment_id || '', detailsHtml,
      });
      // Cap at 10.
      if (deploymentsStore.length > 10) deploymentsStore.length = 10;
      persistDeployments();
      renderDeploymentsStore();
    }

    function renderDeploymentsStore() {
      feedList.innerHTML = '';
      if (!deploymentsStore.length) { feedList.appendChild(feedEmpty); return; }
      deploymentsStore.forEach(p => {
        const row = feedRow({
          time: p.time, source: p.source, sourceClass: p.sourceClass,
          event: p.event, eventClass: p.eventClass, id: p.id, detailsHtml: p.detailsHtml,
        });
        feedList.appendChild(row);
      });
    }

    function persistDeployments() {
      try { localStorage.setItem('dd.deployments', JSON.stringify(deploymentsStore)); } catch {}
    }

    // ── Control API Events SSE (GET /demo/control-stream) ────────────────────
    // Per §8: single Events card badge reflects both control-stream and
    // component-events connections.  Each stream tracks its own state; the badge
    // shows LIVE only when both are live, RECONNECTING if either is reconnecting.
    let ctrlStreamState  = 'connecting';
    let compEventsState  = 'connecting';

    function setEventsLiveBadge(mode) {
      const labels = { connecting: '● CONNECTING', live: '● LIVE', reconnecting: '● RECONNECTING' };
      eventsLiveBadge.textContent = labels[mode] || mode;
      eventsLiveBadge.className   = 'live-badge live-' + mode;
    }

    function recalcEventsLiveBadge() {
      if (ctrlStreamState === 'reconnecting' || compEventsState === 'reconnecting') {
        setEventsLiveBadge('reconnecting');
      } else if (ctrlStreamState === 'live' && compEventsState === 'live') {
        setEventsLiveBadge('live');
      } else {
        setEventsLiveBadge('connecting');
      }
    }

    function connectControlStream() {
      if (ctrlEventSource) { try { ctrlEventSource.close(); } catch {} }
      ctrlStreamState = 'connecting';
      recalcEventsLiveBadge();
      ctrlEventSource = new EventSource('/demo/control-stream');

      ctrlEventSource.onopen = () => { ctrlStreamState = 'live'; recalcEventsLiveBadge(); };

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

      ctrlEventSource.onerror = () => { ctrlStreamState = 'reconnecting'; recalcEventsLiveBadge(); };
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

    // ── Component Events SSE (GET /demo/control-events) ──────────────────────
    // Per §4.9: EventSource on GET /demo/control-events; each frame carries a
    // single ComponentEventRecord as event: component + data: <JSON>.
    function connectComponentEvents() {
      if (compEventSource) { try { compEventSource.close(); } catch {} }
      compEventsState = 'connecting';
      recalcEventsLiveBadge();
      compEventSource = new EventSource('/demo/control-events');

      compEventSource.onopen = () => { compEventsState = 'live'; recalcEventsLiveBadge(); };

      // Each accepted POST /api/control/events produces one named "component" event frame.
      compEventSource.addEventListener('component', e => {
        if (!e.data) return;
        let rec = {};
        try { rec = JSON.parse(e.data); } catch { return; }
        mergeCompEvents(rec);
      });

      compEventSource.onerror = () => { compEventsState = 'reconnecting'; recalcEventsLiveBadge(); };
    }

    // ── Fetcher · Rate Limit card updater ────────────────────────────────────
    // Called when a rate-limit component event arrives.  Updates the per-adapter
    // store (last-value-wins per adapter) and re-renders all adapter sections.
    // These events are SUPPRESSED from the Events feed.

    // Converts an adapter name into a safe HTML id slug (lowercase, non-alnum → '-').
    function rlSlug(adapter) {
      return String(adapter).toLowerCase().replace(/[^a-z0-9]/g, '-');
    }

    // Builds the HTML for one adapter section from the store entry.
    function rlAdapterSectionHtml(adapterName, entry) {
      const slug      = rlSlug(adapterName);
      const p         = entry.p || {};
      const state     = entry.state || 'running';
      const badgeCls  = state === 'paused'  ? 'badge badge-paused'
                      : state === 'running' ? 'badge badge-running'
                      :                       'badge badge-idle';

      const ownUsed   = p.own_used   != null ? p.own_used   : null;
      const ownBudget = p.own_budget != null ? p.own_budget : null;
      const ownLabel  = (ownUsed   != null ? esc(String(ownUsed))   : '\\u2014') +
                        ' / ' +
                        (ownBudget != null ? esc(String(ownBudget)) : '\\u2014');
      const pct = (ownUsed != null && ownBudget != null && ownBudget > 0)
        ? Math.min(100, Math.round(ownUsed / ownBudget * 100))
        : 0;

      const ciRemaining = p.ci_remaining != null ? esc(String(p.ci_remaining)) : '\\u2014';
      const ciLimit     = p.ci_limit     != null ? esc(String(p.ci_limit))     : '\\u2014';
      const resetAt     = p.reset_at     != null ? esc(fmt(p.reset_at))        : '\\u2014';

      return (
        '<div id="rl-' + slug + '-section" style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #27272a">' +
          '<div class="rl-row">' +
            '<span id="rl-' + slug + '-state-badge" class="' + badgeCls + '">' + esc(state) + '</span>' +
            '<span class="rl-kv">' +
              '<span class="rl-key">Adapter</span>' +
              '<span class="rl-val" id="rl-' + slug + '-adapter">' + esc(adapterName) + '</span>' +
            '</span>' +
          '</div>' +
          '<div class="rl-progress-wrap">' +
            '<div class="rl-progress-label">' +
              '<span>Own usage</span>' +
              '<span id="rl-' + slug + '-own-label">' + ownLabel + '</span>' +
            '</div>' +
            '<div class="progress-bg">' +
              '<div class="progress-fill" id="rl-' + slug + '-progress-fill" style="width:' + pct + '%"></div>' +
            '</div>' +
          '</div>' +
          '<div class="rl-row" style="margin-top:8px">' +
            '<span class="rl-kv">' +
              '<span class="rl-key">CI quota</span>' +
              '<span class="rl-val" id="rl-' + slug + '-ci-remaining">' + ciRemaining + '</span>' +
              '<span class="rl-sep">/</span>' +
              '<span class="rl-val" id="rl-' + slug + '-ci-limit">' + ciLimit + '</span>' +
            '</span>' +
            '<span class="rl-sep">\\u00b7</span>' +
            '<span class="rl-kv">' +
              '<span class="rl-key">Resets</span>' +
              '<span class="rl-val" id="rl-' + slug + '-reset-at">' + resetAt + '</span>' +
            '</span>' +
          '</div>' +
        '</div>'
      );
    }

    function updateRateLimitCard(rec) {
      const p           = rec.payload || {};
      const adapterName = p.adapter != null ? String(p.adapter) : 'unknown';

      // Update store: last-value-wins per adapter.
      rlAdapterStore[adapterName] = { state: rec.state || 'running', p };

      // Re-render all adapter sections from the store.
      const html = Object.keys(rlAdapterStore)
        .map(name => rlAdapterSectionHtml(name, rlAdapterStore[name]))
        .join('');
      // Remove trailing separator border from the last section.
      rlAdaptersContainer.innerHTML = html;
      const sections = rlAdaptersContainer.querySelectorAll('[id$="-section"]');
      if (sections.length > 0) {
        sections[sections.length - 1].style.borderBottom = 'none';
        sections[sections.length - 1].style.marginBottom = '0';
        sections[sections.length - 1].style.paddingBottom = '0';
      }

      // Reveal the card on the first event.
      rlCard.style.display       = 'flex';
      rlCard.style.flexDirection = 'column';
    }

    // Renders a single ComponentEventRecord into the merged Events store.
    // Previously accepted an array (poll response); now called per-frame (SSE).
    // rate-limit events are routed to the Fetcher · Rate Limit card and are
    // NOT added to the Events feed (per-cycle noise suppression).
    function mergeCompEvents(rec) {
      if (rec.event_type === 'rate-limit') {
        updateRateLimitCard(rec);
        return;
      }

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

      // Hydrate Deployments feed.
      try {
        const raw = localStorage.getItem('dd.deployments');
        if (raw) {
          const rows = JSON.parse(raw);
          if (Array.isArray(rows)) {
            rows.forEach(p => {
              if (!deploymentsStore.some(q => q._uid === p._uid)) deploymentsStore.push(p);
            });
            deploymentsStore.sort((a, b) => b._ts.localeCompare(a._ts));
            if (deploymentsStore.length > 10) deploymentsStore.length = 10;
            renderDeploymentsStore();
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
