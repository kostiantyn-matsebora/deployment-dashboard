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
    .badge-on       { background: #14532d; color: #86efac; }
    .badge-off      { background: #27272a; color: #a1a1aa; }

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
    .feed-item { padding: 5px 0; border-bottom: 1px solid #1f1f23; line-height: 1.5; }
    .feed-item:last-child { border-bottom: none; }
    .fi-posted .fi-icon { color: #86efac; }
    .fi-error  .fi-icon { color: #f87171; }
    .fi-time  { color: #52525b; font-size: 0.7rem; margin-right: 6px; }
    .fi-id    { color: #d4d4d8; font-weight: 600; }
    .fi-meta  { color: #71717a; }
    .fi-src   { font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 3px;
                margin-right: 4px; letter-spacing: 0.04em; }
    .fi-src-ingest { background: #1a2744; color: #60a5fa; }
    .fi-src-emit   { background: #271d00; color: #f59e0b; }
    .feed-empty { color: #52525b; text-align: center; padding: 24px 0; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>Demo <span>Driver</span></h1>

  <div class="grid">

    <!-- ── Ingest card ───────────────────────────────────────────────────── -->
    <div class="card">
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
    <div class="card">
      <div class="card-title">Live Emission</div>
      <div class="emit-row">
        <div class="emit-info">
          <span class="emit-title">Random events</span>
          <span class="badge badge-off" id="emit-badge">OFF</span>
        </div>
        <button class="btn-enable" id="emit-toggle-btn" onclick="toggleEmit()">Enable</button>
      </div>
    </div>

    <!-- ── API card ───────────────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-title">API</div>
      <div class="api-row">
        <button class="btn-stop" id="reset-api-btn" onclick="resetApi()">Reset State</button>
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

    let pollTimer   = null;
    let eventSource = null;
    let emitting    = false;

    // ── Dataset toggle ────────────────────────────────────────────────────────
    datasetSelect.addEventListener('change', () => {
      const isRandom = datasetSelect.value === 'random';
      countLbl.style.display   = isRandom ? '' : 'none';
      countInput.style.display = isRandom ? '' : 'none';
    });

    // ── Boot ─────────────────────────────────────────────────────────────────
    (async () => {
      await Promise.all([refreshStatus(), refreshEmit()]);
      connectStream();
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
      const state = d.state || 'idle';
      stateBadge.textContent = state;
      stateBadge.className   = 'badge badge-' + state;

      const total = d.events_total || 0;
      const sent  = d.events_sent  || 0;
      const pct   = total > 0 ? (sent / total * 100) : 0;

      progressLbl.textContent  = sent + ' / ' + total + ' events';
      progressPct.textContent  = pct.toFixed(0) + '%';
      progressFill.style.width = pct.toFixed(1) + '%';
      errorCount.textContent   = d.errors || 0;
      startedAt.textContent    = d.started_at  ? fmt(d.started_at)  : '—';
      finishedAt.textContent   = d.finished_at ? fmt(d.finished_at) : '—';

      ingestBtn.disabled     = state === 'running';
      ingestStopBtn.disabled = state !== 'running';

      if (state === 'running') schedulePoll();
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
      const dataset  = datasetSelect.value;
      const reset    = resetCheck.checked;
      const delay    = parseInt(delayInput.value, 10) || 0;
      const count    = Math.min(parseInt(countInput.value, 10) || 10, 10);
      const body     = { dataset, reset, delay_ms: delay };
      if (dataset === 'random') body.count = count;
      try {
        const data = await apiFetch('/demo/ingest', {
          method: 'POST',
          body:   JSON.stringify(body),
        });
        applyStatus(data);
      } catch {}
    });

    ingestStopBtn.addEventListener('click', async () => {
      try {
        const data = await apiFetch('/demo/ingest/stop', { method: 'POST' });
        applyStatus(data);
      } catch {}
    });

    // ── Live emission ─────────────────────────────────────────────────────────
    function toggleEmit() {
      emitToggleBtn.disabled = true;
      apiFetch('/demo/emit', {
        method: 'POST',
        body:   JSON.stringify({ enabled: !emitting }),
      }).then(applyEmit)
        .catch(() => {})
        .finally(() => { emitToggleBtn.disabled = false; });
    }

    // ── API reset ─────────────────────────────────────────────────────────────
    function resetApi() {
      resetApiBtn.disabled = true;
      resetApiMsg.textContent = '';
      resetApiMsg.className   = 'api-msg';
      apiFetch('/demo/api-reset', { method: 'POST' })
        .then(d => {
          if (d.ok) {
            resetApiMsg.textContent = '✓ Reset OK (' + d.http_status + ')';
            resetApiMsg.className   = 'api-msg ok';
          } else {
            resetApiMsg.textContent = '✗ HTTP ' + (d.http_status || '—');
            resetApiMsg.className   = 'api-msg err';
          }
        })
        .catch(() => {
          resetApiMsg.textContent = '✗ Network error';
          resetApiMsg.className   = 'api-msg err';
        })
        .finally(() => { resetApiBtn.disabled = false; });
    }

    clearBtn.addEventListener('click', () => {
      feedList.innerHTML = '';
      feedList.appendChild(feedEmpty);
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

    function addFeedItem(type, d) {
      if (feedEmpty.parentNode === feedList) feedList.removeChild(feedEmpty);
      const item    = document.createElement('div');
      item.className = 'feed-item fi-' + type;
      const time    = fmt(d.posted_at || new Date().toISOString());
      const srcTag  = d.from_emit
        ? '<span class="fi-src fi-src-emit">emit</span>'
        : '<span class="fi-src fi-src-ingest">ingest</span>';
      if (type === 'posted') {
        item.innerHTML =
          '<span class="fi-icon">✓</span> ' +
          '<span class="fi-time">'  + esc(time)             + '</span>' +
          srcTag +
          '<span class="fi-id">'   + esc(d.deployment_id)  + '</span> ' +
          '<span class="fi-meta">' + esc(d.service) + ' / ' + esc(d.environment) + ' → ' + esc(d.status) + '</span>';
      } else {
        item.innerHTML =
          '<span class="fi-icon">✗</span> ' +
          '<span class="fi-time">'  + esc(time)             + '</span>' +
          srcTag +
          '<span class="fi-id">ERROR</span> ' +
          '<span class="fi-meta">' + esc(d.deployment_id) + ' · HTTP ' + d.http_status + ' · attempt ' + d.attempt + '</span>';
      }
      feedList.insertBefore(item, feedList.firstChild);
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
