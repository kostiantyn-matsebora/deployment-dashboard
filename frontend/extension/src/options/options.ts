// Options page entry point — Extension Config panel.
// Spec: docs/design/views.md §Config Panel Layout
//       docs/design/components.md §Extension Config

import browser from 'webextension-polyfill';
import { getSettings, saveSettings } from '../shared/storage';
import { ALL_STATUSES } from '../shared/types';
import type { ExtensionSettings } from '../shared/types';
import { unwrapItems } from '../shared/deployments';

// ── State ─────────────────────────────────────────────────────────────────

let settings: ExtensionSettings;

// ── DOM refs ──────────────────────────────────────────────────────────────

const inputUrl          = document.getElementById('input-url') as HTMLInputElement;
const btnWatching       = document.getElementById('btn-watching') as HTMLButtonElement;
const watchingStateText = document.getElementById('watching-state-text') as HTMLElement;
const filterSection     = document.getElementById('filter-section') as HTMLElement;
const segExclude        = document.getElementById('seg-exclude') as HTMLButtonElement;
const segInclude        = document.getElementById('seg-include') as HTMLButtonElement;
const servicesList      = document.getElementById('services-list') as HTMLElement;
const environmentsList  = document.getElementById('environments-list') as HTMLElement;
const statusesList      = document.getElementById('statuses-list') as HTMLElement;
const inputPopupCount   = document.getElementById('input-popup-count') as HTMLInputElement;
const saveStatus        = document.getElementById('save-status') as HTMLElement;

// ── Init ──────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  settings = await getSettings();
  inputUrl.value = settings.dashboardUrl;
  applyWatchingUI(settings.watching);
  applyFilterModeUI(settings.filterMode);
  renderStatusChecklist(settings.statuses);
  inputPopupCount.value = String(settings.popupCount);

  if (settings.dashboardUrl) {
    await loadFilterLists(settings.dashboardUrl, settings.services, settings.environments);
  }
}

// ── Watching switch ───────────────────────────────────────────────────────

btnWatching.addEventListener('click', () => {
  settings.watching = !settings.watching;
  applyWatchingUI(settings.watching);
});

function applyWatchingUI(watching: boolean): void {
  btnWatching.setAttribute('aria-checked', String(watching));
  btnWatching.classList.toggle('is-on', watching);
  watchingStateText.textContent = watching ? 'ON' : 'OFF';
  filterSection.setAttribute('aria-disabled', String(!watching));
  filterSection.classList.toggle('is-dimmed', !watching);

  // Make filter controls non-interactive when paused.
  const interactables = Array.from(filterSection.querySelectorAll<HTMLElement>('input, button'));
  for (const el of interactables) {
    if (watching) {
      el.removeAttribute('disabled');
    } else {
      el.setAttribute('disabled', 'disabled');
    }
  }
}

// ── Filter mode segmented control ─────────────────────────────────────────

segExclude.addEventListener('click', () => setFilterMode('exclude'));
segInclude.addEventListener('click', () => setFilterMode('include'));

function setFilterMode(mode: 'exclude' | 'include'): void {
  settings.filterMode = mode;
  applyFilterModeUI(mode);
}

function applyFilterModeUI(mode: 'exclude' | 'include'): void {
  segExclude.setAttribute('aria-pressed', String(mode === 'exclude'));
  segInclude.setAttribute('aria-pressed', String(mode === 'include'));
  segExclude.classList.toggle('is-active', mode === 'exclude');
  segInclude.classList.toggle('is-active', mode === 'include');
}

// ── Filter list loading ───────────────────────────────────────────────────

async function loadFilterLists(
  dashboardUrl: string,
  selectedServices: string[],
  selectedEnvironments: string[],
): Promise<void> {
  const base = dashboardUrl.replace(/\/$/, '');

  try {
    const [svcRes, envRes] = await Promise.all([
      fetch(`${base}/api/services`),
      fetch(`${base}/api/environments`),
    ]);

    const services: string[]     = svcRes.ok ? unwrapItems(await svcRes.json()) : [];
    const environments: string[] = envRes.ok ? unwrapItems(await envRes.json()) : [];

    renderChecklist(servicesList, 'svc', services, selectedServices);
    renderChecklist(environmentsList, 'env', environments, selectedEnvironments);
  } catch {
    servicesList.innerHTML     = '<p class="ink-2 no-items">Could not load services.</p>';
    environmentsList.innerHTML = '<p class="ink-2 no-items">Could not load environments.</p>';
  }
}

function renderChecklist(
  container: HTMLElement,
  prefix: string,
  items: string[],
  selected: string[],
): void {
  if (items.length === 0) {
    container.innerHTML = '<p class="ink-2 no-items">None found.</p>';
    return;
  }

  container.innerHTML = '';
  for (const item of items) {
    const id = `${prefix}-${item}`;
    const label = document.createElement('label');
    label.className = 'checklist-item';
    label.htmlFor = id;

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.id      = id;
    cb.value   = item;
    cb.checked = selected.includes(item);
    cb.className = 'checklist-cb';

    label.appendChild(cb);
    label.appendChild(document.createTextNode(item));
    container.appendChild(label);
  }
}

// ── Statuses checklist (static — all 8 statuses) ─────────────────────────

function renderStatusChecklist(enabledStatuses: string[]): void {
  statusesList.innerHTML = '';
  for (const status of ALL_STATUSES) {
    const id    = `status-${status}`;
    const label = document.createElement('label');
    label.className = 'checklist-item';
    label.htmlFor   = id;

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.id      = id;
    cb.value   = status;
    cb.checked = enabledStatuses.includes(status);
    cb.className = 'checklist-cb';

    label.appendChild(cb);
    label.appendChild(document.createTextNode(status));
    statusesList.appendChild(label);
  }
}

function collectChecked(prefix: string): string[] {
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    `input[type="checkbox"][id^="${prefix}-"]`,
  );
  return Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

// ── Re-load filter lists when URL changes ─────────────────────────────────

inputUrl.addEventListener('change', async () => {
  const url = inputUrl.value.trim();
  if (url) {
    // URL changed — clear prior server's selections so they don't bleed into
    // the new server's service/environment lists.
    await loadFilterLists(url, [], []);
  }
});

// ── Save ──────────────────────────────────────────────────────────────────

document.getElementById('options-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const rawCount   = parseInt(inputPopupCount.value, 10);
  const popupCount = Number.isFinite(rawCount) ? Math.min(50, Math.max(1, rawCount)) : 5;

  const patch: ExtensionSettings = {
    dashboardUrl: inputUrl.value.trim().replace(/\/$/, ''),
    watching:     settings.watching,
    filterMode:   settings.filterMode,
    services:     collectChecked('svc'),
    environments: collectChecked('env'),
    statuses:     collectChecked('status'),
    popupCount,
  };

  await saveSettings(patch);
  settings = { ...patch };

  // Notify background to re-evaluate connection.
  try {
    await browser.runtime.sendMessage({ type: 'settings-updated' });
  } catch {
    // Background SW may be inactive — it will pick up changes on next alarm.
  }

  saveStatus.textContent = 'Saved.';
  setTimeout(() => { saveStatus.textContent = ''; }, 2000);
});

init();
