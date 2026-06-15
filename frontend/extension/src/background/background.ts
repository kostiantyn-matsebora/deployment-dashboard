// MV3 background service worker.
// Responsibilities:
//   1. Maintain an EventSource connection to /api/events/stream.
//   2. On each deployment event: update slot-status map, recompute badge, fire notification.
//   3. Register an alarms heartbeat to survive SW teardown (MV3 idle-termination).
//   4. Seed badge state from GET /api/matrix on startup / URL change.
//   5. Persist lastEventId to storage.local so replay is gap-free across SW restarts.
//
// MV3 SSE survival strategy:
//   EventSource's browser-managed Last-Event-ID header is only populated from the
//   current in-memory EventSource instance.  When the service worker is torn down on
//   idle, the in-memory EventSource is gone.  On cold SW start we:
//     a) Read lastEventId from storage.local.
//     b) Open a NEW EventSource to `{url}?lastEventId={id}` — the server-side stream
//        handler treats ?lastEventId (or Last-Event-ID header) as the replay cursor.
//     c) The alarms heartbeat (~30 s) calls ensureConnected() to re-open after teardown.
//
// Event-handling serialization:
//   Rapid SSE events could interleave concurrent read-modify-write cycles on storage
//   (last-writer-wins on a stale snapshot).  A module-level promise chain `eventQueue`
//   ensures each handleDeploymentEvent call completes its storage round-trip before the
//   next one starts.  EventSource fires events on a single microtask queue so there is
//   no concurrency in the JS sense, but async awaits inside the handler create gaps where
//   a second event listener invocation can start before the first has finished writing.

import browser from 'webextension-polyfill';
import type { DeploymentEvent, ExtensionSettings, MatrixResponse } from '../shared/types';
import { computeBadge, seedSlotStatusFromMatrix, applyEventDelta } from '../shared/badge';
import { isWatched, isStatusEnabled } from '../shared/filter';
import { buildNotification } from '../shared/notifications';
import { getSettings, getLocalState, saveLocalState } from '../shared/storage';

// Badge colour tokens — matches tokens.css amber/coral
const AMBER = '#f5a524';
const CORAL = '#ff5d5d';
const ALARM_NAME = 'sse-heartbeat';

// Module-level EventSource handle.  One instance at most; recreated after teardown.
let eventSource: EventSource | null = null;
let currentDashboardUrl = '';

// Maps notification ID → click URL so each notification uses a unique ID (event.id)
// and the onClicked handler can still open the correct run URL.
// Kept in-memory only; notifications are ephemeral so persistence is not needed.
const notifClickUrls = new Map<string, string>();

// Serial event queue — each handler invocation is chained onto this promise so that
// read→modify→write cycles never interleave, eliminating the stale-snapshot race.
let eventQueue: Promise<void> = Promise.resolve();

// ── Lifecycle ─────────────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(onInstalled);
browser.runtime.onStartup.addListener(onStartup);
browser.alarms.onAlarm.addListener(onAlarm);
browser.notifications.onClicked.addListener(onNotificationClicked);
// N2: respond immediately when the options page saves new settings (settings-updated message).
// Without this the alarm heartbeat would be the first opportunity (~30 s) to reconnect.
browser.runtime.onMessage.addListener((msg: unknown) => {
  if (typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'settings-updated') {
    void bootstrap();
  }
});

async function onInstalled(): Promise<void> {
  await registerHeartbeat();
  await bootstrap();
}

async function onStartup(): Promise<void> {
  await registerHeartbeat();
  await bootstrap();
}

async function onAlarm(alarm: browser.Alarms.Alarm): Promise<void> {
  if (alarm.name === ALARM_NAME) {
    await ensureConnected();
  }
}

async function onNotificationClicked(notificationId: string): Promise<void> {
  const clickUrl = notifClickUrls.get(notificationId);
  if (clickUrl) {
    await browser.tabs.create({ url: clickUrl });
    notifClickUrls.delete(notificationId);
  }
  await browser.notifications.clear(notificationId);
}

// ── Heartbeat alarm ───────────────────────────────────────────────────────

async function registerHeartbeat(): Promise<void> {
  // MV3 minimum alarm period is 30 seconds (enforced by Chrome/Edge/Firefox).
  const existing = await browser.alarms.get(ALARM_NAME);
  if (!existing) {
    await browser.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 }); // 30 s
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  const settings = await getSettings();
  currentDashboardUrl = settings.dashboardUrl;

  if (!settings.watching || !settings.dashboardUrl) {
    applyBadgeClear();
    return;
  }

  await seedBadgeFromMatrix(settings.dashboardUrl, settings);
  openEventSource(settings.dashboardUrl);
}

// ── Badge seeding from /api/matrix ────────────────────────────────────────

async function seedBadgeFromMatrix(dashboardUrl: string, settings: ExtensionSettings): Promise<void> {
  try {
    const url = `${dashboardUrl.replace(/\/$/, '')}/api/matrix`;
    const res = await fetch(url);
    if (!res.ok) return;

    const body: MatrixResponse = await res.json();
    const slotStatus = seedSlotStatusFromMatrix(
      body,
      (service, environment) => isWatched(service, environment, settings),
    );
    await saveLocalState({ slotStatus });
    applyBadge(computeBadge(slotStatus, settings.statuses));
  } catch {
    // Network unavailable — leave badge as-is; heartbeat will retry.
  }
}

// ── EventSource ───────────────────────────────────────────────────────────

function openEventSource(dashboardUrl: string): void {
  closeEventSource();

  getLocalState().then(({ lastEventId }) => {
    const base = dashboardUrl.replace(/\/$/, '');
    // Append lastEventId as a query param so the server can replay missed events.
    const url = lastEventId
      ? `${base}/api/events/stream?lastEventId=${encodeURIComponent(lastEventId)}`
      : `${base}/api/events/stream`;

    const es = new EventSource(url);
    eventSource = es;

    es.addEventListener('deployment', (ev: Event) => {
      // Chain onto eventQueue so each handler runs strictly after the previous one
      // completes its storage write — eliminates the read-modify-write race.
      // The .catch() keeps the chain alive: a single handler failure is logged but
      // does NOT poison the queue — future events continue to be processed.
      eventQueue = eventQueue.then(() =>
        handleDeploymentEvent(ev as MessageEvent).catch(err =>
          console.warn('[ext] deployment event handler failed', err),
        ),
      );
    });

    es.onerror = () => {
      console.warn('[ext] SSE error — will auto-retry');
    };
  });
}

function closeEventSource(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

async function ensureConnected(): Promise<void> {
  const settings = await getSettings();

  if (!settings.watching || !settings.dashboardUrl) {
    closeEventSource();
    applyBadgeClear();
    return;
  }

  // Re-bootstrap if the URL changed (e.g. user updated options).
  if (settings.dashboardUrl !== currentDashboardUrl) {
    currentDashboardUrl = settings.dashboardUrl;
    await seedBadgeFromMatrix(settings.dashboardUrl, settings);
  }

  if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
    openEventSource(settings.dashboardUrl);
  }
}

// ── Event handling ────────────────────────────────────────────────────────

async function handleDeploymentEvent(ev: MessageEvent): Promise<void> {
  let event: DeploymentEvent;
  try {
    event = JSON.parse(ev.data as string) as DeploymentEvent;
  } catch {
    console.warn('[ext] Failed to parse deployment event', ev.data);
    return;
  }

  // Persist lastEventId for gap-free replay on SW restart.
  const lastEventId = ev.lastEventId || event.id;
  await saveLocalState({ lastEventId });

  const settings = await getSettings();
  if (!settings.watching) return;

  const watched = isWatched(event.service, event.environment, settings);

  // Only update slot-status map and badge for watched service+env combinations.
  // Out-of-scope events advance lastEventId (gap-free replay) but must not inflate
  // the badge — consistent with seedBadgeFromMatrix which is also watch-scoped.
  if (watched) {
    const local = await getLocalState();
    const updatedSlotStatus = applyEventDelta(
      local.slotStatus, event.service, event.environment, event.status,
    );
    await saveLocalState({ slotStatus: updatedSlotStatus });
    applyBadge(computeBadge(updatedSlotStatus, settings.statuses));
  }

  // Fire notification when both service+env and status are in-scope for this user.
  const statusEnabled = isStatusEnabled(event.status, settings);

  if (watched && statusEnabled) {
    const content  = buildNotification(event);
    const notifId  = `notif-${event.id}`;
    if (content.clickUrl) notifClickUrls.set(notifId, content.clickUrl);
    await browser.notifications.create(notifId, {
      type:    'basic',
      iconUrl: browser.runtime.getURL('icons/icon-48.png'),
      title:   content.title,
      message: content.message,
    });
  }
}

// ── Badge rendering ───────────────────────────────────────────────────────

function applyBadge(state: ReturnType<typeof computeBadge>): void {
  if (state.mode === 'idle') {
    applyBadgeClear();
    return;
  }

  const color = state.mode === 'failure' ? CORAL : AMBER;
  const text  = String(state.count);

  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
}

function applyBadgeClear(): void {
  browser.action.setBadgeText({ text: '' });
}
