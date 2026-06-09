// Popup entry point — Latest-Change popup panel.
// Spec: docs/design/views.md §Popup Panel Layout
//       docs/design/components.md §Latest-Change Popup Panel

import browser from 'webextension-polyfill';
import { getSettings, getLocalState } from '../shared/storage';
import { relativeElapsed, absoluteUtc } from '../shared/time';
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

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHref(id: string, href: string): void {
  const el = document.getElementById(id) as HTMLAnchorElement | null;
  if (el) el.href = href;
}

async function render(): Promise<void> {
  hide('state-loading');
  hide('state-unconfigured');
  hide('state-paused');
  hide('state-empty');
  hide('state-event');

  const [settings, local] = await Promise.all([getSettings(), getLocalState()]);

  if (!settings.dashboardUrl) {
    show('state-unconfigured');
    return;
  }

  if (!settings.watching) {
    show('state-paused');
    return;
  }

  const event: DeploymentEvent | null = local.latestChange;
  if (!event) {
    show('state-empty');
    return;
  }

  // Populate event card.
  const chip = document.getElementById('ev-status');
  if (chip) {
    chip.textContent = event.status;
    chip.className = `status-chip ${STATUS_CLASS[event.status] ?? ''}`;
  }

  setText('ev-service', event.service);
  setText('ev-environment', event.environment);
  setText('ev-version', event.version ?? '—');
  setText('ev-actor', event.actor ? `@${event.actor}` : '');
  setText('ev-elapsed', relativeElapsed(event.happened_at));
  setText('ev-utc', absoluteUtc(event.happened_at));

  const runLink = document.getElementById('ev-run-link') as HTMLAnchorElement | null;
  if (runLink) {
    if (event.run_url) {
      runLink.href = event.run_url;
      // N1: label is "Open run #NNN" when run_number is present, plain "Open run" as fallback.
      runLink.textContent = event.run_number ? `Open run #${event.run_number}` : 'Open run';
      runLink.hidden = false;
    } else {
      runLink.hidden = true;
    }
  }

  setHref('ev-dashboard-link', settings.dashboardUrl);

  show('state-event');
}

// Wire settings-open buttons.
function openOptions(): void {
  browser.runtime.openOptionsPage();
}

document.getElementById('btn-settings')?.addEventListener('click', openOptions);
document.getElementById('btn-open-options')?.addEventListener('click', openOptions);
document.getElementById('btn-open-options-paused')?.addEventListener('click', openOptions);

// Show loading until render resolves.
show('state-loading');
render();
