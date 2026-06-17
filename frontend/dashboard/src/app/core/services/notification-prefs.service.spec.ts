/**
 * NotificationPrefsService — unit tests.
 *
 * Covers:
 *   - Default state (enabled=false, success+failure statuses, watch-all-except, empty chips)
 *   - updatePrefs partial patch semantics
 *   - shouldNotify — master switch gating
 *   - shouldNotify — status axis gating
 *   - shouldNotify — service axis: watch-all-except + watch-only + empty chips = all
 *   - shouldNotify — environment axis: watch-all-except + watch-only + empty chips = all
 *   - localStorage persistence round-trip
 *   - localStorage hydration on init
 *   - localStorage corruption / missing key falls back to defaults
 */

import { TestBed } from '@angular/core/testing';
import {
  NotificationPrefsService,
  NOTIFICATION_STATUSES,
} from './notification-prefs.service';

const STORAGE_KEY = 'dd:notifPrefs';

function clearStorage(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

describe('NotificationPrefsService', () => {
  beforeEach(() => {
    clearStorage();
    TestBed.configureTestingModule({ providers: [NotificationPrefsService] });
  });

  afterEach(() => {
    clearStorage();
    TestBed.resetTestingModule();
  });

  // ── Default state ──────────────────────────────────────────────────────────

  describe('default state', () => {
    it('enabled is false by default (lazy opt-in)', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      expect(svc.prefs().enabled).toBe(false);
    });

    it('default statuses are success and failure', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      const statuses = svc.prefs().statuses;
      expect(statuses).toContain('success');
      expect(statuses).toContain('failure');
      expect(statuses.length).toBe(2);
    });

    it('default service filter is watch-all-except with empty chips', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      expect(svc.prefs().serviceMode).toBe('watch-all-except');
      expect(svc.prefs().serviceChips).toEqual([]);
    });

    it('default environment filter is watch-all-except with empty chips', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      expect(svc.prefs().envMode).toBe('watch-all-except');
      expect(svc.prefs().envChips).toEqual([]);
    });
  });

  // ── updatePrefs partial patch ──────────────────────────────────────────────

  describe('updatePrefs', () => {
    it('patches only the specified fields — others are unchanged', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      const before = svc.prefs();
      svc.updatePrefs({ enabled: true });
      const after = svc.prefs();
      expect(after.enabled).toBe(true);
      expect(after.statuses).toEqual(before.statuses);
      expect(after.serviceMode).toBe(before.serviceMode);
      expect(after.serviceChips).toEqual(before.serviceChips);
    });

    it('updates statuses correctly', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ statuses: ['failure'] });
      expect(svc.prefs().statuses).toEqual(['failure']);
    });
  });

  // ── shouldNotify — master switch ───────────────────────────────────────────

  describe('shouldNotify — master switch', () => {
    it('returns false when enabled is false regardless of status/service/env', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      // enabled defaults to false; success is in default statuses; empty chips = all
      expect(svc.shouldNotify('success', 'any-service', 'prod')).toBe(false);
    });

    it('returns true when enabled is true and event passes all filters', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ enabled: true });
      // success is in default statuses; no service/env chips = watch all
      expect(svc.shouldNotify('success', 'payments-api', 'prod')).toBe(true);
    });
  });

  // ── shouldNotify — status axis ────────────────────────────────────────────

  describe('shouldNotify — status axis', () => {
    it('returns false for a status not in the enabled list', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ enabled: true, statuses: ['success'] });
      expect(svc.shouldNotify('failure', 'svc', 'prod')).toBe(false);
    });

    it('returns true for a status that IS in the enabled list', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ enabled: true, statuses: ['failure', 'in-progress'] });
      expect(svc.shouldNotify('in-progress', 'svc', 'dev')).toBe(true);
    });

    it('returns false when statuses list is empty', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ enabled: true, statuses: [] });
      expect(svc.shouldNotify('success', 'svc', 'prod')).toBe(false);
    });

    it('all 8 statuses fire when all are enabled', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ enabled: true, statuses: [...NOTIFICATION_STATUSES] });
      for (const status of NOTIFICATION_STATUSES) {
        expect(svc.shouldNotify(status, 'svc', 'env')).toBe(true);
      }
    });
  });

  // ── shouldNotify — service axis ───────────────────────────────────────────

  describe('shouldNotify — service axis', () => {
    it('empty chips = watch all (watch-all-except mode)', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ enabled: true, serviceMode: 'watch-all-except', serviceChips: [] });
      expect(svc.shouldNotify('success', 'any-service', 'prod')).toBe(true);
    });

    it('empty chips = watch all (watch-only mode)', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ enabled: true, serviceMode: 'watch-only', serviceChips: [] });
      expect(svc.shouldNotify('success', 'any-service', 'prod')).toBe(true);
    });

    it('watch-all-except: excludes listed services', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled: true,
        serviceMode: 'watch-all-except',
        serviceChips: ['payments-api'],
      });
      expect(svc.shouldNotify('success', 'payments-api', 'prod')).toBe(false);
      expect(svc.shouldNotify('success', 'auth-service', 'prod')).toBe(true);
    });

    it('watch-only: includes only listed services', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled: true,
        serviceMode: 'watch-only',
        serviceChips: ['checkout'],
      });
      expect(svc.shouldNotify('success', 'checkout', 'prod')).toBe(true);
      expect(svc.shouldNotify('success', 'other-service', 'prod')).toBe(false);
    });
  });

  // ── shouldNotify — service axis glob matching ─────────────────────────────

  describe('shouldNotify — service axis glob matching', () => {
    it('watch-all-except: glob "*-api" excludes all services ending in -api', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled:      true,
        serviceMode:  'watch-all-except',
        serviceChips: ['*-api'],
      });
      expect(svc.shouldNotify('success', 'payments-api', 'prod')).toBe(false);
      expect(svc.shouldNotify('success', 'auth-api',     'prod')).toBe(false);
      expect(svc.shouldNotify('success', 'checkout',     'prod')).toBe(true);
    });

    it('watch-only: glob "*-api" includes only services ending in -api', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled:      true,
        serviceMode:  'watch-only',
        serviceChips: ['*-api'],
      });
      expect(svc.shouldNotify('success', 'payments-api', 'prod')).toBe(true);
      expect(svc.shouldNotify('success', 'auth-api',     'prod')).toBe(true);
      expect(svc.shouldNotify('success', 'checkout',     'prod')).toBe(false);
    });

    it('glob "?" matches exactly one character', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled:      true,
        serviceMode:  'watch-only',
        serviceChips: ['sv?'],
      });
      expect(svc.shouldNotify('success', 'svc', 'prod')).toBe(true);
      expect(svc.shouldNotify('success', 'svcc', 'prod')).toBe(false);
    });

    it('glob matching is case-insensitive', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled:      true,
        serviceMode:  'watch-only',
        serviceChips: ['*-API'],
      });
      expect(svc.shouldNotify('success', 'payments-api', 'prod')).toBe(true);
    });
  });

  // ── shouldNotify — environment axis ───────────────────────────────────────

  describe('shouldNotify — environment axis', () => {
    it('empty chips = watch all (watch-all-except mode)', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ enabled: true, envMode: 'watch-all-except', envChips: [] });
      expect(svc.shouldNotify('success', 'svc', 'any-env')).toBe(true);
    });

    it('watch-all-except: excludes listed environments', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled: true,
        envMode: 'watch-all-except',
        envChips: ['dev', 'staging'],
      });
      expect(svc.shouldNotify('success', 'svc', 'dev')).toBe(false);
      expect(svc.shouldNotify('success', 'svc', 'prod')).toBe(true);
    });

    it('watch-only: includes only listed environments', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled: true,
        envMode: 'watch-only',
        envChips: ['prod', 'preprod'],
      });
      expect(svc.shouldNotify('success', 'svc', 'prod')).toBe(true);
      expect(svc.shouldNotify('success', 'svc', 'dev')).toBe(false);
    });

    it('watch-all-except: glob "prod*" excludes prod and production', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled:  true,
        envMode:  'watch-all-except',
        envChips: ['prod*'],
      });
      expect(svc.shouldNotify('success', 'svc', 'prod')).toBe(false);
      expect(svc.shouldNotify('success', 'svc', 'production')).toBe(false);
      expect(svc.shouldNotify('success', 'svc', 'dev')).toBe(true);
    });

    it('watch-only: glob "prod*" includes prod and production but not dev', () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({
        enabled:  true,
        envMode:  'watch-only',
        envChips: ['prod*'],
      });
      expect(svc.shouldNotify('success', 'svc', 'prod')).toBe(true);
      expect(svc.shouldNotify('success', 'svc', 'production')).toBe(true);
      expect(svc.shouldNotify('success', 'svc', 'dev')).toBe(false);
    });
  });

  // ── localStorage persistence ───────────────────────────────────────────────

  describe('localStorage persistence', () => {
    it('persists prefs to localStorage via effect on updatePrefs', async () => {
      const svc = TestBed.inject(NotificationPrefsService);
      svc.updatePrefs({ enabled: true, statuses: ['failure'] });
      // Effects are deferred in Angular — flush them explicitly.
      await TestBed.flushEffects();
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { enabled: boolean; statuses: string[] };
      expect(stored.enabled).toBe(true);
      expect(stored.statuses).toEqual(['failure']);
    });
  });

  // ── localStorage hydration ────────────────────────────────────────────────

  describe('localStorage hydration', () => {
    it('restores persisted prefs on new service instance', async () => {
      const svc1 = TestBed.inject(NotificationPrefsService);
      svc1.updatePrefs({
        enabled:     true,
        statuses:    ['failure', 'in-progress'],
        serviceMode: 'watch-only',
        serviceChips: ['payments-api'],
        envMode:     'watch-only',
        envChips:    ['prod'],
      });
      // Flush effects so the persistence effect writes to localStorage.
      await TestBed.flushEffects();

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [NotificationPrefsService] });
      const svc2 = TestBed.inject(NotificationPrefsService);

      expect(svc2.prefs().enabled).toBe(true);
      expect(svc2.prefs().statuses).toContain('failure');
      expect(svc2.prefs().statuses).toContain('in-progress');
      expect(svc2.prefs().serviceMode).toBe('watch-only');
      expect(svc2.prefs().serviceChips).toEqual(['payments-api']);
      expect(svc2.prefs().envMode).toBe('watch-only');
      expect(svc2.prefs().envChips).toEqual(['prod']);
    });

    it('falls back to defaults when localStorage is missing', () => {
      clearStorage();
      const svc = TestBed.inject(NotificationPrefsService);
      expect(svc.prefs().enabled).toBe(false);
    });

    it('falls back to defaults when localStorage value is malformed JSON', () => {
      localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{{');
      const svc = TestBed.inject(NotificationPrefsService);
      expect(svc.prefs().enabled).toBe(false);
    });

    it('falls back to default statuses when stored statuses array is empty', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: true, statuses: [] }));
      const svc = TestBed.inject(NotificationPrefsService);
      // Empty valid array → fall back to default (success + failure)
      expect(svc.prefs().statuses).toContain('success');
      expect(svc.prefs().statuses).toContain('failure');
    });

    it('ignores unknown status values in stored statuses array', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ enabled: true, statuses: ['unknown-status', 'success'] }),
      );
      const svc = TestBed.inject(NotificationPrefsService);
      expect(svc.prefs().statuses).toEqual(['success']);
    });
  });
});
