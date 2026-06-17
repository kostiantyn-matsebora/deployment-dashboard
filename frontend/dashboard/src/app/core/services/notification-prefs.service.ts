import { effect, Injectable, signal } from '@angular/core';
import { Status } from '../models/deployment.model';

/** All 8 deployment statuses in the order shown in the notification prefs popover. */
export const NOTIFICATION_STATUSES: Status[] = [
  'success',
  'failure',
  'in-progress',
  'pending',
  'queued',
  'waiting',
  'cancelled',
  'rejected',
];

/** Notification filter mode for a given axis (services / environments). */
export type NotifFilterMode = 'watch-all-except' | 'watch-only';

/** Persisted notification preferences. */
export interface NotifPrefs {
  /** Master on/off. When false no notifications fire. */
  enabled: boolean;
  /** Which statuses to notify on. Defaults to success + failure per mockup. */
  statuses: Status[];
  /** Service filter mode. */
  serviceMode: NotifFilterMode;
  /** Chip values for the service filter — meaning depends on `serviceMode`. */
  serviceChips: string[];
  /** Environment filter mode. */
  envMode: NotifFilterMode;
  /** Chip values for the environment filter — meaning depends on `envMode`. */
  envChips: string[];
}

const STORAGE_KEY = 'dd:notifPrefs';

/** Default enabled statuses per mockup: success + failure pre-checked. */
const DEFAULT_STATUSES: Status[] = ['success', 'failure'];

const DEFAULT_PREFS: NotifPrefs = {
  enabled:      false,
  statuses:     [...DEFAULT_STATUSES],
  serviceMode:  'watch-all-except',
  serviceChips: [],
  envMode:      'watch-all-except',
  envChips:     [],
};

/**
 * NotificationPrefsService — stores and persists browser notification preferences.
 *
 * Pattern: mirrors ThemeService. Signal for each preference; an effect
 * persists to localStorage on every change. Deserialized on init.
 *
 * Spec: docs/design/mockup/index.html #pop-notif
 * Default `enabled: false` — user must explicitly opt in (lazy permission pattern).
 */
@Injectable({ providedIn: 'root' })
export class NotificationPrefsService {
  readonly prefs = signal<NotifPrefs>(this.readStored());

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs()));
      } catch {
        // storage unavailable — silently ignore
      }
    });
  }

  updatePrefs(patch: Partial<NotifPrefs>): void {
    this.prefs.set({ ...this.prefs(), ...patch });
  }

  /**
   * Return true if a deployment event with the given (status, service, environment)
   * should fire a notification given the current preferences.
   */
  shouldNotify(status: Status, service: string, environment: string): boolean {
    const p = this.prefs();
    if (!p.enabled) return false;
    if (!p.statuses.includes(status)) return false;
    if (!this.matchesAxis(service, p.serviceMode, p.serviceChips)) return false;
    if (!this.matchesAxis(environment, p.envMode, p.envChips)) return false;
    return true;
  }

  private matchesAxis(value: string, mode: NotifFilterMode, chips: string[]): boolean {
    if (chips.length === 0) {
      // blank = all (regardless of mode)
      return true;
    }
    if (mode === 'watch-all-except') {
      return !chips.includes(value);
    }
    // watch-only
    return chips.includes(value);
  }

  private readStored(): NotifPrefs {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<NotifPrefs>;
        return {
          enabled:      typeof p.enabled      === 'boolean' ? p.enabled      : DEFAULT_PREFS.enabled,
          statuses:     this.parseStatuses(p.statuses),
          serviceMode:  this.parseMode(p.serviceMode),
          serviceChips: this.parseChips(p.serviceChips),
          envMode:      this.parseMode(p.envMode),
          envChips:     this.parseChips(p.envChips),
        };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_PREFS, statuses: [...DEFAULT_PREFS.statuses], serviceChips: [], envChips: [] };
  }

  private parseStatuses(raw: unknown): Status[] {
    if (!Array.isArray(raw)) return [...DEFAULT_STATUSES];
    const valid = (raw as unknown[]).filter(
      (s): s is Status => (NOTIFICATION_STATUSES as string[]).includes(s as string),
    );
    return valid.length > 0 ? valid : [...DEFAULT_STATUSES];
  }

  private parseMode(raw: unknown): NotifFilterMode {
    return raw === 'watch-only' ? 'watch-only' : 'watch-all-except';
  }

  private parseChips(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[]).filter((x): x is string => typeof x === 'string');
  }
}
