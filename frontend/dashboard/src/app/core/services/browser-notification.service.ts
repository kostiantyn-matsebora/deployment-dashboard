import { effect, inject, Injectable } from '@angular/core';
import { AppStateService } from './app-state.service';
import { NotificationPrefsService } from './notification-prefs.service';
import { DeploymentEvent } from '../models/deployment.model';

/**
 * BrowserNotificationService — fires OS-level browser notifications for deployment events.
 *
 * Spec: docs/design/mockup/index.html #pop-notif, docs/EXTENSION_SPECIFICATION.md §4.3
 *
 * Permission contract:
 *  - `Notification.requestPermission()` is called ONLY from `requestPermission()`,
 *    which is invoked explicitly by the topbar when the user toggles the master switch ON.
 *  - On subsequent events, we check `Notification.permission === 'granted'` without
 *    re-requesting; if denied we degrade silently (no console spam, no broken UI).
 *
 * Transition + de-dup:
 *  - Watches `AppStateService.lastEffectiveEvent` (effective status transitions only;
 *    context statuses pending/queued/waiting/cancelled/rejected do NOT update this signal).
 *  - De-dupes by tracking the last fired event ID so re-renders do not double-fire.
 *
 * Feature detection:
 *  - `'Notification' in window` — degrades when API is absent.
 *  - Secure context not enforced here; browser blocks requestPermission on non-HTTPS.
 *
 * Click: focuses the window and opens `run_url` in a new tab when available.
 */
@Injectable({ providedIn: 'root' })
export class BrowserNotificationService {
  private readonly state = inject(AppStateService);
  private readonly prefs = inject(NotificationPrefsService);

  /** Last event ID for which a notification was fired or considered (de-dup guard). */
  private lastSeenId: string | null = null;

  constructor() {
    // React to every new effective deployment event pushed via SSE.
    effect(() => {
      const ev = this.state.lastEffectiveEvent();
      if (!ev) return;
      this.onEvent(ev);
    });
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

  private onEvent(ev: DeploymentEvent): void {
    // De-dup: the signal may re-fire with the same value on re-renders.
    if (ev.id === this.lastSeenId) return;
    this.lastSeenId = ev.id;

    if (!this.prefs.shouldNotify(ev.status, ev.service, ev.environment)) return;
    if (!this.isSupported()) return;
    // Permission must already be granted — we never re-request here.
    if (Notification.permission !== 'granted') return;

    this.fire(ev);
  }

  private fire(ev: DeploymentEvent): void {
    try {
      const { title, body, tag } = this.buildContent(ev);
      const notif = new Notification(title, {
        body,
        tag,
        icon: '/assets/logo/logo.svg',
        requireInteraction: false,
      });
      if (ev.run_url) {
        const runUrl = ev.run_url;
        notif.onclick = () => {
          try {
            window.focus();
          } catch { /* non-fatal */ }
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
  private buildContent(ev: DeploymentEvent): { title: string; body: string; tag: string } {
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
}
