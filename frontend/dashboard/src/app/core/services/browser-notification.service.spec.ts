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
 *   - Notification fired when enabled + granted + passes filters
 *   - De-dup: same event ID does not fire twice
 *   - Replay guard: events older than startedAt are skipped
 *   - Bounded seenIds: set is pruned when cap is reached
 *   - buildDeploymentContent: title/body/tag for all 8 statuses
 *   - isProdLike: prod / production / prod-xyz all match
 */

import { Subject } from 'rxjs';
import { TestBed } from '@angular/core/testing';

import { BrowserNotificationService } from './browser-notification.service';
import { DeploymentApiService }        from './deployment-api.service';
import { NotificationPrefsService }    from './notification-prefs.service';
import { DeploymentEvent } from '../models/deployment.model';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid DeploymentEvent whose happened_at is in the future. */
function mkEvent(overrides: Partial<DeploymentEvent> = {}): DeploymentEvent {
  return {
    id:            'uuid-1',
    deployment_id: 'dep-1',
    service:       'payments-api',
    environment:   'prod',
    version:       'v1.2.3',
    status:        'success',
    // Future timestamp — won't be filtered by the startup high-water-mark.
    happened_at:   new Date(Date.now() + 60_000).toISOString(),
    run_url:       'https://ci.example.com/runs/42',
    run_number:    '42',
    actor:         'alice',
    ...overrides,
  };
}

/** Access protected / private members via type cast. */
function priv<T>(obj: BrowserNotificationService, key: string): T {
  return (obj as unknown as Record<string, T>)[key];
}

// ── Notification API mock ──────────────────────────────────────────────────

interface NotifMock {
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
  let notifMock:         NotifMock;
  let deploymentEvents$: Subject<DeploymentEvent>;

  function createService(prefOverrides: {
    enabled?: boolean;
    statuses?: string[];
  } = {}): BrowserNotificationService {
    deploymentEvents$ = new Subject<DeploymentEvent>();

    const mockApi: Partial<DeploymentApiService> = {
      streamEvents: () => deploymentEvents$.asObservable(),
    };

    const mockPrefs: Partial<NotificationPrefsService> = {
      shouldNotify: (status, service, environment) => {
        if (prefOverrides.enabled === false) return false;
        if (prefOverrides.statuses && !prefOverrides.statuses.includes(status)) return false;
        void service; void environment;
        return (prefOverrides.enabled ?? true) === true;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prefs: (() => ({ enabled: prefOverrides.enabled ?? true, statuses: [], serviceMode: 'watch-all-except', serviceChips: [], envMode: 'watch-all-except', envChips: [] })) as any,
    };

    TestBed.configureTestingModule({
      providers: [
        BrowserNotificationService,
        { provide: DeploymentApiService,     useValue: mockApi   },
        { provide: NotificationPrefsService, useValue: mockPrefs },
      ],
    });

    return TestBed.inject(BrowserNotificationService);
  }

  beforeEach(() => {
    notifMock = installNotifMock('granted');
    // Clear sessionStorage de-dup state between tests.
    try { sessionStorage.clear(); } catch { /* ignore */ }
  });

  afterEach(() => {
    removeNotifMock();
    TestBed.resetTestingModule();
    try { sessionStorage.clear(); } catch { /* ignore */ }
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
      createService({ enabled: false });
      deploymentEvents$.next(mkEvent());
      expect(notifMock.instances).toHaveLength(0);
    });
  });

  // ── Notification NOT fired without permission ──────────────────────────────

  describe('notification suppressed without granted permission', () => {
    it('does not fire when permission is denied', () => {
      notifMock.resetPermission('denied');
      createService({ enabled: true });
      deploymentEvents$.next(mkEvent());
      expect(notifMock.instances).toHaveLength(0);
    });

    it('does not fire when permission is default', () => {
      notifMock.resetPermission('default');
      createService({ enabled: true });
      deploymentEvents$.next(mkEvent());
      expect(notifMock.instances).toHaveLength(0);
    });
  });

  // ── Replay guard ──────────────────────────────────────────────────────────

  describe('replay guard', () => {
    it('skips deployment events whose happened_at is before service startedAt', () => {
      createService({ enabled: true });
      deploymentEvents$.next(mkEvent({ id: 'old-1', happened_at: '2020-01-01T00:00:00Z' }));
      expect(notifMock.instances).toHaveLength(0);
    });

    it('fires deployment events whose happened_at is after service startedAt', () => {
      createService({ enabled: true });
      deploymentEvents$.next(mkEvent({ id: 'new-1' })); // future timestamp from mkEvent
      expect(notifMock.instances).toHaveLength(1);
    });
  });

  // ── Notification fired correctly ───────────────────────────────────────────

  describe('notification fires when enabled + granted + passes filters', () => {
    it('constructs a Notification on a qualifying deployment event', () => {
      createService({ enabled: true });
      deploymentEvents$.next(mkEvent({ status: 'success', id: 'fire-1' }));
      expect(notifMock.instances).toHaveLength(1);
    });

    it('notification title contains service and environment', () => {
      createService({ enabled: true });
      deploymentEvents$.next(mkEvent({ service: 'checkout', environment: 'staging', id: 'fire-2' }));
      expect(notifMock.instances).toHaveLength(1);
      expect(notifMock.instances[0].title).toContain('checkout');
      expect(notifMock.instances[0].title).toContain('staging');
    });

    it('notification body contains version and run number', () => {
      createService({ enabled: true });
      deploymentEvents$.next(mkEvent({ version: 'v3.0.0', run_number: '99', id: 'fire-3' }));
      expect(notifMock.instances[0].options.body).toContain('v3.0.0');
      expect(notifMock.instances[0].options.body).toContain('run #99');
    });
  });

  // ── De-dup: same event ID does not double-fire ─────────────────────────────

  describe('de-duplication', () => {
    it('does not fire twice for the same event ID', () => {
      createService({ enabled: true });
      const ev = mkEvent({ id: 'same-uuid' });
      deploymentEvents$.next(ev);
      deploymentEvents$.next(ev); // duplicate delivery
      expect(notifMock.instances).toHaveLength(1);
    });

    it('fires for a second event with a different ID', () => {
      createService({ enabled: true });
      deploymentEvents$.next(mkEvent({ id: 'uuid-a', status: 'success' }));
      deploymentEvents$.next(mkEvent({ id: 'uuid-b', status: 'failure' }));
      expect(notifMock.instances).toHaveLength(2);
    });

    it('de-dup survives a page reload — seenIds round-trip via sessionStorage', () => {
      // ── First "page load": fire N events and let them persist to sessionStorage.
      const eventIds = ['reload-1', 'reload-2', 'reload-3'];
      createService({ enabled: true });
      for (const id of eventIds) {
        deploymentEvents$.next(mkEvent({ id }));
      }
      // All 3 notifications fired on first load.
      expect(notifMock.instances).toHaveLength(eventIds.length);

      // Verify sessionStorage was written.
      const raw = sessionStorage.getItem('dd:notifSeenIds');
      expect(raw).not.toBeNull();
      const stored: string[] = JSON.parse(raw!);
      for (const id of eventIds) {
        expect(stored).toContain(id);
      }

      // ── Second "page load": create a fresh service in a new TestBed.
      TestBed.resetTestingModule();
      notifMock.instances.length = 0; // reset spy without clearing sessionStorage

      // New service reads seenIds from sessionStorage on construction.
      const svc2 = createService({ enabled: true });
      void svc2; // used only to trigger the constructor subscription

      // Re-send the same event IDs — none should produce a new Notification.
      for (const id of eventIds) {
        deploymentEvents$.next(mkEvent({ id }));
      }
      expect(notifMock.instances).toHaveLength(0);
    });
  });

  // ── Bounded seenIds set ───────────────────────────────────────────────────

  describe('bounded seenIds', () => {
    it('prunes the set when MAX_SEEN_IDS is exceeded and continues firing', () => {
      const svc = createService({ enabled: true });
      const MAX = 500; // matches BrowserNotificationService.MAX_SEEN_IDS

      // Fire MAX+1 events — the (MAX+1)th triggers pruning because markSeen
      // checks `seenIds.size >= MAX` BEFORE adding, which is true at size=MAX.
      for (let i = 0; i <= MAX; i++) {
        deploymentEvents$.next(mkEvent({ id: `fill-${i}` }));
      }
      expect(notifMock.instances).toHaveLength(MAX + 1);

      // The seenIds set should have been pruned to approximately MAX/2.
      const seenSize = priv<Set<string>>(svc, 'seenIds').size;
      expect(seenSize).toBeLessThan(MAX);

      // Firing one more after pruning still works.
      deploymentEvents$.next(mkEvent({ id: 'after-prune' }));
      expect(notifMock.instances).toHaveLength(MAX + 2);
    });
  });

  // ── buildDeploymentContent — title / body / tag for all statuses ──────────

  describe('buildDeploymentContent()', () => {
    function build(ev: Partial<DeploymentEvent>): { title: string; body: string; tag: string } {
      const svc = createService({ enabled: true });
      return priv<(ev: DeploymentEvent) => { title: string; body: string; tag: string }>(
        svc, 'buildDeploymentContent',
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
