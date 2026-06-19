import { effect, Injectable, signal } from '@angular/core';
import { Status } from '../models/deployment.model';
import { matchesAny, matchesComposite } from '../utils/glob.util';

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
   * Return true if a deployment event with the given (status, service, namespace,
   * environment) should fire a notification given the current preferences.
   *
   * Service matching uses composite glob rules (issue #353):
   *   - Slashed chip patterns match `namespace/service`; slashless match bare service.
   *   - Null namespace → bare service matching only.
   */
  shouldNotify(
    status: Status,
    service: string,
    environment: string,
    namespace?: string | null,
  ): boolean {
    const p = this.prefs();
    if (!p.enabled) return false;
    if (!p.statuses.includes(status)) return false;
    if (!this.matchesServiceAxis(service, namespace, p.serviceMode, p.serviceChips)) return false;
    if (!this.matchesAxis(environment, p.envMode, p.envChips)) return false;
    return true;
  }

  /**
   * Returns true when a (service, namespace) pair passes the given mode+chips
   * filter using composite glob matching (issue #353).
   *
   * NOTE: matching changed from case-sensitive exact membership (#271) to
   * case-insensitive glob via matchesAny (#351). Extended to composite matching
   * for namespace-aware filtering (#353).
   */
  private matchesServiceAxis(
    service: string,
    namespace: string | null | undefined,
    mode: NotifFilterMode,
    chips: string[],
  ): boolean {
    if (chips.length === 0) {
      // blank = all (regardless of mode)
      return true;
    }
    const matched = matchesComposite(service, namespace, chips);
    if (mode === 'watch-all-except') {
      return !matched;
    }
    // watch-only
    return matched;
  }

  /**
   * Returns true when `value` passes the given mode+chips filter.
   * Used for the environment axis (no namespace; plain glob matching).
   */
  private matchesAxis(value: string, mode: NotifFilterMode, chips: string[]): boolean {
    if (chips.length === 0) {
      // blank = all (regardless of mode)
      return true;
    }
    const matched = matchesAny(value, chips);
    if (mode === 'watch-all-except') {
      return !matched;
    }
    // watch-only
    return matched;
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
