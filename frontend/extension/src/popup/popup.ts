// Popup entry point — Recent-events list panel.
// Spec: docs/design/views.md §Popup Panel Layout
//       docs/design/components.md §Latest-Change Popup Panel
// STATELESS: popup always fetches /api/deployments fresh; no dependence on latestChange.

import browser from 'webextension-polyfill';
import { getSettings } from '../shared/storage';
import { relativeElapsed, absoluteUtc } from '../shared/time';
import { pickTopN } from '../shared/deployments';
import type { DeploymentEvent } from '../shared/types';

// Status → CSS class suffix mapping (status-chip s-{key})
const STATUS_CLASS: Record<string, string> = {
  'in-progress': 's-progress',
  success:       's-success',
  failure:       's-failure',
  pending:       's-pending',
  queued:        's-queued',
  waiting:       's-waiting',
  cancelled:     's-cancelled',
  rejected:      's-rejected',
};

function show(id: string): void {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function hide(id: string): void {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

function setHref(id: string, href: string): void {
  const el = document.getElementById(id) as HTMLAnchorElement | null;
  if (el) el.href = href;
}

// ── Event row builder ─────────────────────────────────────────────────────

function buildEventRow(event: DeploymentEvent): HTMLElement {
  const row = document.createElement('div');
  row.className = 'event-row';

  // Header: chip + service
  const header = document.createElement('div');
  header.className = 'row-header';

  const chip = document.createElement('span');
  chip.className   = `status-chip ${STATUS_CLASS[event.status] ?? ''}`;
  chip.textContent = event.status;
  chip.setAttribute('role', 'status');
  header.appendChild(chip);

  const svc = document.createElement('span');
  svc.className   = 'service-name';
  svc.textContent = event.service;
  header.appendChild(svc);
  row.appendChild(header);

  // Meta: environment · version · @actor
  const meta = document.createElement('div');
  meta.className = 'row-meta';

  const envSpan = document.createElement('span');
  envSpan.className   = 'meta-item';
  envSpan.textContent = event.environment;
  meta.appendChild(envSpan);

  const sep1 = document.createElement('span');
  sep1.className   = 'meta-sep';
  sep1.textContent = '·';
  meta.appendChild(sep1);

  const ver = document.createElement('span');
  ver.className   = 'meta-item mono';
  ver.textContent = event.version ?? '—';
  meta.appendChild(ver);

  if (event.actor) {
    const sep2 = document.createElement('span');
    sep2.className   = 'meta-sep';
    sep2.textContent = '·';
    meta.appendChild(sep2);

    const actor = document.createElement('span');
    actor.className   = 'ink-2';
    actor.textContent = `@${event.actor}`;
    meta.appendChild(actor);
  }
  row.appendChild(meta);

  // Time: relative · absolute UTC
  const timeEl = document.createElement('div');
  timeEl.className   = 'row-time';
  timeEl.textContent = `${relativeElapsed(event.happened_at)} · ${absoluteUtc(event.happened_at)}`;
  row.appendChild(timeEl);

  // Actions: run link
  if (event.run_url) {
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const runLink = document.createElement('a');
    runLink.className   = 'hist-link';
    runLink.href        = event.run_url;
    runLink.target      = '_blank';
    runLink.rel         = 'noopener noreferrer';
    runLink.textContent = event.run_number ? `Open run #${event.run_number}` : 'Open run';
    actions.appendChild(runLink);
    row.appendChild(actions);
  }

  return row;
}

// ── Render ────────────────────────────────────────────────────────────────

async function render(): Promise<void> {
  hide('state-loading');
  hide('state-unconfigured');
  hide('state-paused');
  hide('state-empty');
  hide('state-list');
  hide('footer-dashboard-link');

  const settings = await getSettings();

  if (!settings.dashboardUrl) {
    show('state-unconfigured');
    return;
  }

  // Wire footer dashboard link whenever URL is configured.
  setHref('footer-dashboard-link', settings.dashboardUrl);
  show('footer-dashboard-link');

  if (!settings.watching) {
    show('state-paused');
    return;
  }

  // Fetch and filter the recent deployments list.
  let events: DeploymentEvent[] = [];
  try {
    const base = settings.dashboardUrl.replace(/\/$/, '');
    const res  = await fetch(`${base}/api/deployments`);
    if (res.ok) {
      events = pickTopN(await res.json(), settings, settings.popupCount);
    }
  } catch {
    // Network unavailable — fall through to empty state.
  }

  if (events.length === 0) {
    show('state-empty');
    return;
  }

  const list = document.getElementById('state-list')!;
  list.innerHTML = '';
  for (const event of events) {
    list.appendChild(buildEventRow(event));
  }
  show('state-list');
}

// ── Settings-open buttons ─────────────────────────────────────────────────

function openOptions(): void {
  browser.runtime.openOptionsPage();
}

document.getElementById('btn-settings')?.addEventListener('click', openOptions);
document.getElementById('btn-open-options')?.addEventListener('click', openOptions);
document.getElementById('btn-open-options-paused')?.addEventListener('click', openOptions);

// ── Live re-render ────────────────────────────────────────────────────────

// Re-render whenever the background service worker writes slotStatus (SSE event arrived).
// The popup is fully stateless — it re-fetches /api/deployments on each storage trigger.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'slotStatus' in changes) {
    void render();
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────

show('state-loading');
render();
