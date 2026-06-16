import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';

const CONTROL_HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mock Control</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:       #0d1117;
      --surface:  #161b22;
      --border:   #30363d;
      --text:     #c9d1d9;
      --muted:    #6e7681;
      --green:    #3fb950;
      --green-bg: #0d2c1a;
      --red:      #f85149;
      --amber:    #f59e0b;
      --blue:     #58a6ff;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 3rem 1rem;
      gap: 1rem;
    }
    header { width: 100%; max-width: 600px; margin-bottom: 1rem; }
    header h1 { font-size: 1.1rem; font-weight: 600; }
    header p  { font-size: 0.78rem; color: var(--muted); margin-top: 0.25rem; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
      width: 100%;
      max-width: 600px;
    }
    .card-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 1rem;
    }
    .card-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }
    .card-label-row .card-label { margin-bottom: 0; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .info { display: flex; flex-direction: column; gap: 0.4rem; }
    .info-title { font-size: 0.9rem; }
    .badge {
      display: inline-flex; align-items: center; gap: 0.35rem;
      font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em;
      padding: 0.2rem 0.6rem; border-radius: 999px; width: fit-content;
    }
    .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .badge-on  { background: var(--green-bg); color: var(--green); }
    .badge-off { background: #1c1c1c; color: var(--muted); }
    .badge-sm  { font-size: 0.62rem; padding: 0.15rem 0.45rem; }
    .btn {
      padding: 0.5rem 1.25rem; border: none; border-radius: 6px;
      font-size: 0.82rem; font-weight: 600; cursor: pointer;
      transition: opacity 0.1s; white-space: nowrap;
    }
    .btn:hover    { opacity: 0.85; }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-enable   { background: var(--green); color: #000; }
    .btn-disable  { background: var(--red);   color: #fff; }
    .btn-ghost {
      background: transparent; color: var(--muted);
      border: 1px solid var(--border);
      padding: 0.25rem 0.75rem; font-size: 0.75rem;
    }
    .btn-ghost:hover { color: var(--text); border-color: var(--text); }
    .btn-group { display: flex; gap: 0.5rem; align-items: center; }
    .count-val  { font-size: 2.25rem; font-weight: 700; color: var(--blue); line-height: 1; }
    .count-sub  { font-size: 0.75rem; color: var(--muted); margin-top: 0.35rem; }
    /* ── Feed ───────────────────────────────────────────────────────────────── */
    .feed {
      max-height: 260px;
      overflow-y: auto;
      margin: 0 -1.5rem;
      padding: 0 1.5rem;
      font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.7rem;
    }
    .feed-empty { color: var(--muted); padding: 1rem 0; text-align: center; }
    .feed-row {
      display: flex; gap: 0.6rem; padding: 0.35rem 0;
      border-bottom: 1px solid #21262d; align-items: center;
      min-width: 0;
    }
    .f-time   { color: var(--muted); flex-shrink: 0; width: 4.5rem; }
    .f-src    { flex-shrink: 0; font-size: 0.62rem; padding: 0.1rem 0.4rem;
                border-radius: 3px; font-weight: 700; letter-spacing: 0.04em; }
    .f-src-write   { background: #1a2744; color: var(--blue); }
    .f-src-emitter { background: #271d00; color: var(--amber); }
    .f-svc    { flex-shrink: 0; width: 10rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .f-status { flex-shrink: 0; width: 6rem; font-weight: 600; }
    .f-id     { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
    .s-success  { color: var(--green); }
    .s-failure  { color: var(--red); }
    .s-progress { color: var(--amber); }
    .footer { font-size: 0.72rem; color: var(--muted); margin-top: 0.5rem; }
  </style>
</head>
<body>
  <header>
    <h1>Dashboard Mock</h1>
    <p>Control panel &mdash; development only</p>
  </header>

  <!-- SSE Emission -->
  <div class="card">
    <div class="card-label">SSE Emission</div>
    <div class="row">
      <div class="info">
        <span class="info-title">Random event stream</span>
        <span id="emit-badge" class="badge badge-off">OFF</span>
      </div>
      <button id="emit-toggle" class="btn btn-enable" onclick="toggleEmit()">Enable</button>
    </div>
  </div>

  <!-- Demo Data -->
  <div class="card">
    <div class="card-label">Demo Data</div>
    <div class="row">
      <div class="info">
        <span class="info-title">Pre-loaded events</span>
        <span id="demo-badge" class="badge badge-on">ON</span>
      </div>
      <div class="btn-group">
        <button id="demo-toggle" class="btn btn-disable" onclick="toggleDemo()">Hide</button>
        <button id="demo-reset"  class="btn btn-ghost"   onclick="resetDemo()">Reset</button>
      </div>
    </div>
  </div>

  <!-- Event Store -->
  <div class="card">
    <div class="card-label">Event Store</div>
    <div id="count" class="count-val">&mdash;</div>
    <div class="count-sub">deployment events in store</div>
  </div>

  <!-- Live Ingest Feed -->
  <div class="card">
    <div class="card-label-row">
      <span class="card-label">Ingest Feed</span>
      <div class="btn-group">
        <span id="feed-conn" class="badge badge-sm badge-off">CONNECTING</span>
        <button class="btn btn-ghost" onclick="clearFeed()">Clear</button>
      </div>
    </div>
    <div id="feed" class="feed">
      <div class="feed-empty">No events yet&hellip;</div>
    </div>
  </div>

  <div class="footer" id="refreshed">Fetching&hellip;</div>

  <script>
    var emitting    = false;
    var demoEnabled = true;
    var busy        = false;
    var feedEntries = [];
    var MAX_FEED    = 100;

    // ── State helpers ────────────────────────────────────────────────────────

    function applyEmit(data) {
      emitting = data.emitting;
      var badge  = document.getElementById('emit-badge');
      var toggle = document.getElementById('emit-toggle');
      badge.className   = 'badge ' + (emitting ? 'badge-on' : 'badge-off');
      badge.textContent = emitting ? 'LIVE' : 'OFF';
      toggle.className  = 'btn ' + (emitting ? 'btn-disable' : 'btn-enable');
      toggle.textContent = emitting ? 'Disable' : 'Enable';
      if (data.event_count !== undefined) {
        document.getElementById('count').textContent = data.event_count;
      }
    }

    function applyDemo(data) {
      demoEnabled = data.enabled;
      var badge  = document.getElementById('demo-badge');
      var toggle = document.getElementById('demo-toggle');
      badge.className   = 'badge ' + (demoEnabled ? 'badge-on' : 'badge-off');
      badge.textContent = demoEnabled ? 'ON' : 'OFF';
      toggle.className  = 'btn ' + (demoEnabled ? 'btn-disable' : 'btn-enable');
      toggle.textContent = demoEnabled ? 'Hide' : 'Show';
    }

    function refresh() {
      Promise.all([
        fetch('/_mock/emit').then(function(r) { return r.json(); }),
        fetch('/_mock/demo').then(function(r) { return r.json(); })
      ]).then(function(results) {
        applyEmit(results[0]);
        applyDemo(results[1]);
        document.getElementById('refreshed').textContent =
          'Last refreshed ' + new Date().toLocaleTimeString();
      }).catch(function() {});
    }

    // ── Controls ─────────────────────────────────────────────────────────────

    function toggleEmit() {
      if (busy) return; busy = true;
      var el = document.getElementById('emit-toggle'); el.disabled = true;
      fetch('/_mock/emit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !emitting })
      }).then(function(r) { return r.json(); }).then(applyEmit)
        .catch(function() {})
        .finally(function() { busy = false; el.disabled = false; });
    }

    function toggleDemo() {
      if (busy) return; busy = true;
      var el = document.getElementById('demo-toggle'); el.disabled = true;
      fetch('/_mock/demo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !demoEnabled })
      }).then(function(r) { return r.json(); }).then(applyDemo)
        .catch(function() {})
        .finally(function() { busy = false; el.disabled = false; refresh(); });
    }

    function resetDemo() {
      if (busy) return; busy = true;
      var el = document.getElementById('demo-reset'); el.disabled = true;
      fetch('/_mock/demo/reset', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(d) { applyDemo(d); applyEmit(d); })
        .catch(function() {})
        .finally(function() { busy = false; el.disabled = false; refresh(); });
    }

    // ── Feed ─────────────────────────────────────────────────────────────────

    function clearFeed() {
      feedEntries = [];
      renderFeed();
    }

    function renderFeed() {
      var el = document.getElementById('feed');
      if (feedEntries.length === 0) {
        el.innerHTML = '<div class="feed-empty">No events yet&hellip;</div>';
        return;
      }
      el.innerHTML = feedEntries.map(function(entry) {
        var ev  = entry.event;
        var src = entry.source;
        var t   = new Date(entry.received_at).toLocaleTimeString();
        var srcCls  = src === 'write-api' ? 'f-src-write' : 'f-src-emitter';
        var srcLbl  = src === 'write-api' ? 'POST' : 'emit';
        var stCls   = ev.status === 'success' ? 's-success'
                    : ev.status === 'failure' ? 's-failure' : 's-progress';
        return '<div class="feed-row">'
          + '<span class="f-time">' + t + '</span>'
          + '<span class="f-src ' + srcCls + '">' + srcLbl + '</span>'
          + '<span class="f-svc">' + ev.service + ' / ' + ev.environment + '</span>'
          + '<span class="f-status ' + stCls + '">' + ev.status + '</span>'
          + '<span class="f-id" title="' + ev.deployment_id + '">' + ev.deployment_id + (ev.version ? ' &nbsp;' + ev.version : '') + '</span>'
          + '</div>';
      }).join('');
    }

    function connectFeed() {
      var connBadge = document.getElementById('feed-conn');
      var src = new EventSource('/_mock/stream');

      src.onopen = function() {
        connBadge.className   = 'badge badge-sm badge-on';
        connBadge.textContent = 'LIVE';
      };
      src.onerror = function() {
        connBadge.className   = 'badge badge-sm badge-off';
        connBadge.textContent = 'RECONNECTING';
      };
      src.addEventListener('ingest', function(e) {
        var entry = JSON.parse(e.data);
        feedEntries.unshift(entry);
        if (feedEntries.length > MAX_FEED) feedEntries.length = MAX_FEED;
        renderFeed();
        // keep count in sync without waiting for next poll
        document.getElementById('count').textContent =
          parseInt(document.getElementById('count').textContent || '0', 10) + 1;
      });
    }

    // ── Boot ─────────────────────────────────────────────────────────────────

    refresh();
    setInterval(refresh, 3000);
    connectFeed();
  </script>
</body>
</html>`;

@Controller()
export class AppController {
  @Get()
  controlPanel(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(CONTROL_HTML);
  }

  @Get('api/version')
  version() {
    return { version: '0.13.1' };
  }

  @Get('healthz')
  healthz() {
    return { status: 'ok' };
  }

  @Get('readyz')
  readyz() {
    return {
      status: 'ready',
      checks: { db: 'ok', listen: 'ok' },
    };
  }
}
