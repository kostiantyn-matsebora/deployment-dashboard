import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NotificationPrefsService } from './notification-prefs.service';
import { DeploymentApiService } from './deployment-api.service';
import { DeploymentEvent } from '../models/deployment.model';

/**
 * BrowserNotificationService — fires OS-level browser notifications for deployment
 * events via the raw SSE stream.
 *
 * Spec: docs/design/mockup/index.html #pop-notif, docs/EXTENSION_SPECIFICATION.md §4.3
 *
 * Source: DeploymentApiService.streamEvents() — all 8 deployment statuses.
 *
 * Replay guard (SSE replays missed events on reconnect):
 *  - Startup high-water-mark: `startedAt` is set at construction time (ISO string).
 *    Events whose `happened_at` is strictly before this mark are treated as
 *    replayed history and silently skipped.
 *  - Bounded fired-ID set: the last MAX_SEEN_IDS event IDs are tracked to de-dup
 *    any event that arrives twice within a session (network blip, duplicate delivery).
 *    The set is pruned when it reaches the cap to prevent unbounded growth.
 *
 * Permission contract:
 *  - `Notification.requestPermission()` is called ONLY from `requestPermission()`,
 *    which is invoked explicitly by the topbar when the user toggles the master switch ON.
 *  - On subsequent events, we check `Notification.permission === 'granted'` without
 *    re-requesting; if denied we degrade silently (no console spam, no broken UI).
 *
 * Feature detection:
 *  - `'Notification' in window` — degrades when API is absent.
 *  - Secure context not enforced here; browser blocks requestPermission on non-HTTPS.
 *
 * Click: focuses the window and opens `run_url` in a new tab when available.
 */
@Injectable({ providedIn: 'root' })
export class BrowserNotificationService {
  private readonly api   = inject(DeploymentApiService);
  private readonly prefs = inject(NotificationPrefsService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * ISO timestamp recorded at construction.
   *
   * Events at or after this instant are treated as live transitions and will be
   * processed normally (subject to de-dup and permission gates).
   * Events strictly before this instant are treated as SSE replay / backfill and
   * are silently skipped so the user is not re-notified for historical activity.
   *
   * Comparison is done via `Date.getTime()` (numeric milliseconds) rather than
   * lexicographic string comparison so non-UTC offsets and lower-precision ISO
   * values (e.g. no sub-second component) are handled correctly.
   */
  protected startedAt: string = new Date().toISOString();

  /** Max number of IDs retained in the de-dup set. */
  private static readonly MAX_SEEN_IDS = 500;

  /** sessionStorage key for the persisted seen-ID set. */
  private static readonly SESSION_KEY = 'dd:notifSeenIds';

  /**
   * Bounded set of event IDs for which a notification was already fired or skipped.
   * Persisted to sessionStorage so a page reload within the same tab session does not
   * re-notify for events that were already processed before the reload.
   */
  private readonly seenIds: Set<string> = this.loadSeenIds();

  constructor() {
    this.api.streamEvents()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(ev => this.onDeploymentEvent(ev));
  }

  /**
   * Request browser notification permission explicitly on behalf of the user.
   *
   * Call this ONLY when the user opts in (toggles the master switch ON).
   * Returns the resulting permission state, or 'denied' when the API is absent.
   */
  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';
    try {
      return await Notification.requestPermission();
    } catch {
      // Non-HTTPS context, policy block, or browser quirk — degrade silently.
      return 'denied';
    }
  }

  /** Current Notification API permission state. 'default' when API is absent. */
  get currentPermission(): NotificationPermission {
    if (!this.isSupported()) return 'default';
    return Notification.permission;
  }

  /** True when the Notification API is available in this context. */
  isSupported(): boolean {
    return typeof Notification !== 'undefined';
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private onDeploymentEvent(ev: DeploymentEvent): void {
    // Replay guard: skip events that predate this session.
    // Use numeric comparison so non-UTC / lower-precision ISO strings are handled correctly.
    // NaN (unparseable date) is treated as "not older" — fail open to the seen-ID + permission gates.
    const happenedMs = new Date(ev.happened_at).getTime();
    const startedMs  = new Date(this.startedAt).getTime();
    if (!isNaN(happenedMs) && happenedMs < startedMs) return;

    // De-dup: skip if we've already processed this ID.
    if (this.hasSeen(ev.id)) return;
    this.markSeen(ev.id);

    if (!this.prefs.shouldNotify(ev.status, ev.service, ev.environment, ev.namespace)) return;
    if (!this.isSupported()) return;
    if (Notification.permission !== 'granted') return;

    this.fireDeployment(ev);
  }

  private hasSeen(id: string): boolean {
    return this.seenIds.has(id);
  }

  /**
   * Add an ID to the bounded de-dup set and persist to sessionStorage.
   * When the set reaches MAX_SEEN_IDS, prune the oldest half (FIFO approximation
   * via iteration order of insertion into a Set).
   */
  private markSeen(id: string): void {
    if (this.seenIds.size >= BrowserNotificationService.MAX_SEEN_IDS) {
      // Delete the first (oldest) MAX_SEEN_IDS / 2 entries.
      const pruneCount = BrowserNotificationService.MAX_SEEN_IDS / 2;
      let pruned = 0;
      for (const oldId of this.seenIds) {
        this.seenIds.delete(oldId);
        if (++pruned >= pruneCount) break;
      }
    }
    this.seenIds.add(id);
    this.persistSeenIds();
  }

  private loadSeenIds(): Set<string> {
    try {
      const raw = sessionStorage.getItem(BrowserNotificationService.SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return new Set<string>(
            (parsed as unknown[]).filter((x): x is string => typeof x === 'string'),
          );
        }
      }
    } catch {
      // sessionStorage unavailable or malformed — start clean
    }
    return new Set<string>();
  }

  private persistSeenIds(): void {
    try {
      sessionStorage.setItem(
        BrowserNotificationService.SESSION_KEY,
        JSON.stringify([...this.seenIds]),
      );
    } catch {
      // sessionStorage unavailable — fire-and-forget
    }
  }

  private fireDeployment(ev: DeploymentEvent): void {
    try {
      const { title, body, tag } = this.buildDeploymentContent(ev);
      const notif = new Notification(title, {
        body,
        tag,
        icon: '/assets/logo/logo.svg',
        requireInteraction: false,
      });
      if (ev.run_url) {
        const runUrl = ev.run_url;
        notif.onclick = () => {
          try { window.focus(); } catch { /* non-fatal */ }
          window.open(runUrl, '_blank', 'noopener,noreferrer');
          notif.close();
        };
      } else {
        notif.onclick = () => {
          try { window.focus(); } catch { /* non-fatal */ }
          notif.close();
        };
      }
    } catch {
      // Construction failed (non-HTTPS, quota, policy) — degrade silently.
    }
  }

  /**
   * Build browser Notification title + body for a deployment event.
   *
   * Mirrors buildNotification() in frontend/extension/src/shared/notifications.ts.
   * Inlined to avoid a cross-workspace package dependency.
   */
  private buildDeploymentContent(ev: DeploymentEvent): { title: string; body: string; tag: string } {
    const { service, environment, version, status, run_number } = ev;
    const versionLabel = version    ? ` ${version}`           : '';
    const runLabel     = run_number ? ` (run #${run_number})` : '';
    const base         = `${service} · ${environment}`;
    // Tag per (service × environment) — deduplicates concurrent transitions on the same slot.
    const tag          = `dd-notif-${service}-${environment}`;

    let title: string;
    let body: string;

    if (status === 'success') {
      title = base;
      body  = `${service}${versionLabel} succeeded${runLabel}`;
    } else if (status === 'failure') {
      const isProd   = this.isProdLike(environment);
      const emphasis = isProd ? 'FAILED' : 'failed';
      title = isProd ? `FAILED: ${base}` : base;
      body  = `${service}${versionLabel} ${emphasis}${runLabel}`;
    } else if (status === 'in-progress') {
      title = base;
      body  = `${service}${versionLabel} started${runLabel}`;
    } else if (status === 'pending') {
      title = base;
      body  = `${service}${versionLabel} pending${runLabel}`;
    } else if (status === 'queued') {
      title = base;
      body  = `${service}${versionLabel} queued${runLabel}`;
    } else if (status === 'waiting') {
      title = base;
      body  = `${service}${versionLabel} waiting${runLabel}`;
    } else if (status === 'cancelled') {
      title = base;
      body  = `${service}${versionLabel} cancelled${runLabel}`;
    } else {
      // rejected
      title = base;
      body  = `${service}${versionLabel} rejected${runLabel}`;
    }

    return { title, body, tag };
  }

  /** Mirrors isProdLike() from the extension shared module. */
  private isProdLike(environment: string): boolean {
    const lower = environment.toLowerCase();
    return lower === 'prod' || lower === 'production' || lower.startsWith('prod-');
  }

  // ── Test helpers (package-private via type cast) ──────────────────────────

  /**
   * @internal For testing — push a deployment event directly without an active EventSource.
   */
  _simulateDeploymentEvent(ev: DeploymentEvent): void {
    this.onDeploymentEvent(ev);
  }

  /** @internal For testing — inspect current seen-ID set. */
  _seenIdCount(): number {
    return this.seenIds.size;
  }

}
