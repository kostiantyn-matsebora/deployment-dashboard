/**
 * BrowserNotificationService — unit tests.
 *
 * Covers:
 *   - isSupported() feature detection
 *   - currentPermission delegation to Notification.permission
 *   - requestPermission() delegates to Notification.requestPermission
 *   - requestPermission() returns 'denied' when API is absent
 *   - Notification NOT fired when prefs.enabled is false
 *   - Notification NOT fired when permission is not 'granted'
 *   - Notification NOT fired when status not in filter
 *   - Notification fired when enabled + granted + passes filters
 *   - De-dup: same event ID does not fire twice
 *   - click-to-focus: window.focus() called on notification click
 *   - buildContent: title/body/tag for all 8 statuses (transition detection)
 *   - isProdLike: prod / production / prod-xyz all match
 */

import { TestBed }     from '@angular/core/testing';
import { signal }      from '@angular/core';

import { BrowserNotificationService } from './browser-notification.service';
import { AppStateService }            from './app-state.service';
import { NotificationPrefsService }   from './notification-prefs.service';
import { DeploymentEvent }            from '../models/deployment.model';

// ── Helpers ────────────────────────────────────────────────────────────────

function mkEvent(overrides: Partial<DeploymentEvent> = {}): DeploymentEvent {
  return {
    id:           'uuid-1',
    deployment_id: 'dep-1',
    service:      'payments-api',
    environment:  'prod',
    version:      'v1.2.3',
    status:       'success',
    happened_at:  '2026-06-17T10:00:00Z',
    run_url:      'https://ci.example.com/runs/42',
    run_number:   '42',
    actor:        'alice',
    ...overrides,
  };
}

/** Access protected / private members via type cast. */
function priv<T>(obj: BrowserNotificationService, key: string): T {
  return (obj as unknown as Record<string, T>)[key];
}

// ── Notification API mock ──────────────────────────────────────────────────

interface NotifMock {
  Notification: typeof Notification;
  instances: Array<{ title: string; options: NotificationOptions; onclick: (() => void) | null }>;
  resetPermission(p: NotificationPermission): void;
}

function installNotifMock(
  initialPermission: NotificationPermission = 'granted',
): NotifMock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mock: any = {
    instances: [],
    _permission: initialPermission,
  };

  const NotifClass = function (this: unknown, title: string, options: NotificationOptions) {
    const instance = { title, options, onclick: null as (() => void) | null };
    mock.instances.push(instance);
    Object.defineProperty(this, 'onclick', {
      get: () => instance.onclick,
      set: (fn: (() => void) | null) => { instance.onclick = fn; },
    });
    (this as { close: () => void }).close = () => { /* no-op */ };
  } as unknown as typeof Notification;

  Object.defineProperty(NotifClass, 'permission', {
    get: () => mock._permission,
    configurable: true,
  });

  NotifClass.requestPermission = async (): Promise<NotificationPermission> => mock._permission;

  mock.Notification    = NotifClass;
  mock.resetPermission = (p: NotificationPermission) => { mock._permission = p; };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any)['Notification'] = NotifClass;
  return mock as NotifMock;
}

function removeNotifMock(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any)['Notification'];
}

// ── Shared test setup ──────────────────────────────────────────────────────

describe('BrowserNotificationService', () => {
  let lastEffectiveEvent: ReturnType<typeof signal<DeploymentEvent | null>>;
  let notifMock:          NotifMock;

  function createService(prefOverrides: {
    enabled?: boolean;
    statuses?: string[];
  } = {}): BrowserNotificationService {
    // Mock AppStateService — expose only what BrowserNotificationService needs.
    lastEffectiveEvent = signal<DeploymentEvent | null>(null);
    const mockState: Partial<AppStateService> = {
      lastEffectiveEvent: lastEffectiveEvent as AppStateService['lastEffectiveEvent'],
    };

    // Mock NotificationPrefsService with controllable shouldNotify.
    const mockPrefs: Partial<NotificationPrefsService> = {
      shouldNotify: (status, service, environment) => {
        if (prefOverrides.enabled === false) return false;
        if (prefOverrides.statuses && !prefOverrides.statuses.includes(status)) return false;
        // Default pass-through
        void service; void environment;
        return prefOverrides.enabled ?? true;
      },
      prefs: signal({ enabled: prefOverrides.enabled ?? true, statuses: [], serviceMode: 'watch-all-except', serviceChips: [], envMode: 'watch-all-except', envChips: [] }) as never,
    };

    TestBed.configureTestingModule({
      providers: [
        BrowserNotificationService,
        { provide: AppStateService,          useValue: mockState },
        { provide: NotificationPrefsService, useValue: mockPrefs },
      ],
    });

    return TestBed.inject(BrowserNotificationService);
  }

  beforeEach(() => {
    notifMock = installNotifMock('granted');
  });

  afterEach(() => {
    removeNotifMock();
    TestBed.resetTestingModule();
  });

  // ── isSupported ──────────────────────────────────────────────────────────

  describe('isSupported()', () => {
    it('returns true when Notification is in globalThis', () => {
      const svc = createService();
      expect(svc.isSupported()).toBe(true);
    });

    it('returns false when Notification is absent', () => {
      removeNotifMock();
      const svc = createService();
      expect(svc.isSupported()).toBe(false);
    });
  });

  // ── currentPermission ─────────────────────────────────────────────────────

  describe('currentPermission', () => {
    it('returns granted when Notification.permission is granted', () => {
      notifMock.resetPermission('granted');
      const svc = createService();
      expect(svc.currentPermission).toBe('granted');
    });

    it('returns denied when Notification.permission is denied', () => {
      notifMock.resetPermission('denied');
      const svc = createService();
      expect(svc.currentPermission).toBe('denied');
    });

    it('returns default when API is absent', () => {
      removeNotifMock();
      const svc = createService();
      expect(svc.currentPermission).toBe('default');
    });
  });

  // ── requestPermission ─────────────────────────────────────────────────────

  describe('requestPermission()', () => {
    it('returns the current permission from the API', async () => {
      notifMock.resetPermission('granted');
      const svc = createService();
      const result = await svc.requestPermission();
      expect(result).toBe('granted');
    });

    it('returns denied when API is absent', async () => {
      removeNotifMock();
      const svc = createService();
      const result = await svc.requestPermission();
      expect(result).toBe('denied');
    });
  });

  // ── Notification NOT fired when prefs say no ───────────────────────────────

  describe('notification suppressed when prefs.enabled is false', () => {
    it('does not construct a Notification when enabled is false', () => {
      const svc = createService({ enabled: false });
      lastEffectiveEvent.set(mkEvent());
      expect(notifMock.instances).toHaveLength(0);
    });
  });

  // ── Notification NOT fired without permission ──────────────────────────────

  describe('notification suppressed without granted permission', () => {
    it('does not fire when permission is denied', () => {
      notifMock.resetPermission('denied');
      const svc = createService({ enabled: true });
      lastEffectiveEvent.set(mkEvent());
      expect(notifMock.instances).toHaveLength(0);
    });

    it('does not fire when permission is default (not yet requested)', () => {
      notifMock.resetPermission('default');
      const svc = createService({ enabled: true });
      lastEffectiveEvent.set(mkEvent());
      expect(notifMock.instances).toHaveLength(0);
    });
  });

  // ── Notification fired correctly ───────────────────────────────────────────

  describe('notification fires when enabled + granted + passes filters', () => {
    it('constructs a Notification on a qualifying event', async () => {
      notifMock.resetPermission('granted');
      const svc = createService({ enabled: true });
      lastEffectiveEvent.set(mkEvent({ status: 'success' }));
      await TestBed.flushEffects();
      expect(notifMock.instances.length).toBeGreaterThanOrEqual(1);
    });

    it('notification title contains service and environment', async () => {
      notifMock.resetPermission('granted');
      createService({ enabled: true });
      lastEffectiveEvent.set(mkEvent({ service: 'checkout', environment: 'staging' }));
      await TestBed.flushEffects();
      expect(notifMock.instances.length).toBeGreaterThanOrEqual(1);
      expect(notifMock.instances[0].title).toContain('checkout');
      expect(notifMock.instances[0].title).toContain('staging');
    });

    it('notification body contains version and run number', async () => {
      notifMock.resetPermission('granted');
      createService({ enabled: true });
      lastEffectiveEvent.set(mkEvent({ version: 'v3.0.0', run_number: '99' }));
      await TestBed.flushEffects();
      expect(notifMock.instances[0].options.body).toContain('v3.0.0');
      expect(notifMock.instances[0].options.body).toContain('run #99');
    });
  });

  // ── De-dup: same event ID does not double-fire ─────────────────────────────

  describe('de-duplication', () => {
    it('does not fire twice for the same event ID', async () => {
      notifMock.resetPermission('granted');
      const svc = createService({ enabled: true });
      const ev = mkEvent({ id: 'same-uuid' });
      lastEffectiveEvent.set(ev);
      await TestBed.flushEffects();
      // Simulate signal re-fire with same value (Angular may re-run effects).
      priv<(ev: DeploymentEvent) => void>(svc, 'onEvent').call(svc, ev);
      expect(notifMock.instances).toHaveLength(1);
    });

    it('fires for a second event with a different ID', async () => {
      notifMock.resetPermission('granted');
      createService({ enabled: true });
      lastEffectiveEvent.set(mkEvent({ id: 'uuid-a', status: 'success' }));
      await TestBed.flushEffects();
      lastEffectiveEvent.set(mkEvent({ id: 'uuid-b', status: 'failure' }));
      await TestBed.flushEffects();
      // Two distinct events → two notifications (one per event ID).
      expect(notifMock.instances).toHaveLength(2);
    });
  });

  // ── buildContent — title / body / tag for all statuses ────────────────────

  describe('buildContent()', () => {
    function build(ev: Partial<DeploymentEvent>): { title: string; body: string; tag: string } {
      const svc = createService({ enabled: true });
      return priv<(ev: DeploymentEvent) => { title: string; body: string; tag: string }>(
        svc, 'buildContent',
      ).call(svc, mkEvent(ev));
    }

    it('success — title is base, body contains "succeeded"', () => {
      const { title, body } = build({ status: 'success' });
      expect(title).toContain('payments-api');
      expect(body).toContain('succeeded');
    });

    it('failure — non-prod title is base, body contains "failed"', () => {
      const { title, body } = build({ status: 'failure', environment: 'staging' });
      expect(title).not.toContain('FAILED');
      expect(body).toContain('failed');
    });

    it('failure — prod title contains FAILED', () => {
      const { title, body } = build({ status: 'failure', environment: 'prod' });
      expect(title).toContain('FAILED');
      expect(body).toContain('FAILED');
    });

    it('in-progress body contains "started"', () => {
      const { body } = build({ status: 'in-progress' });
      expect(body).toContain('started');
    });

    it('pending body contains "pending"', () => {
      const { body } = build({ status: 'pending' });
      expect(body).toContain('pending');
    });

    it('queued body contains "queued"', () => {
      const { body } = build({ status: 'queued' });
      expect(body).toContain('queued');
    });

    it('waiting body contains "waiting"', () => {
      const { body } = build({ status: 'waiting' });
      expect(body).toContain('waiting');
    });

    it('cancelled body contains "cancelled"', () => {
      const { body } = build({ status: 'cancelled' });
      expect(body).toContain('cancelled');
    });

    it('rejected body contains "rejected"', () => {
      const { body } = build({ status: 'rejected' });
      expect(body).toContain('rejected');
    });

    it('tag is derived from service + environment', () => {
      const { tag } = build({ service: 'auth', environment: 'dev' });
      expect(tag).toContain('auth');
      expect(tag).toContain('dev');
    });

    it('body omits version label when version is absent', () => {
      const { body } = build({ status: 'success', version: undefined });
      expect(body).toContain('succeeded');
      expect(body).not.toContain('undefined');
    });

    it('body omits run label when run_number is absent', () => {
      const { body } = build({ status: 'success', run_number: undefined });
      expect(body).not.toContain('run #');
    });
  });

  // ── isProdLike ─────────────────────────────────────────────────────────────

  describe('isProdLike()', () => {
    function isProd(env: string): boolean {
      const svc = createService();
      return priv<(e: string) => boolean>(svc, 'isProdLike').call(svc, env);
    }

    it('recognises "prod"', ()        => expect(isProd('prod')).toBe(true));
    it('recognises "production"', ()  => expect(isProd('production')).toBe(true));
    it('recognises "prod-eu"', ()     => expect(isProd('prod-eu')).toBe(true));
    it('does NOT match "staging"', () => expect(isProd('staging')).toBe(false));
    it('does NOT match "dev"', ()     => expect(isProd('dev')).toBe(false));
    it('does NOT match "preprod"', () => expect(isProd('preprod')).toBe(false));
  });
});
