/**
 * AppStateService — column order + hidden-set feature unit tests.
 *
 * Covers:
 *   - colOrder + colHidden persistence round-trips (localStorage)
 *   - orderedVisibleEnvironments derivation (order + hidden + new/gone envs)
 *   - reorderColumn: moves env to the correct index
 *   - toggleColHidden: hides and reveals; last-column guard
 *   - resetColumns: restores all + default sortEnvs order
 *   - syncColOrder: adds new envs; prunes removed envs
 *
 * Strategy: construct AppStateService directly (providedIn 'root') with a
 * real (fake) localStorage provided via TestBed; reset storage between cases.
 */
import { signal }     from '@angular/core';
import { TestBed }    from '@angular/core/testing';

import { AppStateService } from './app-state.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Access protected/private members via type cast. */
function priv<T>(obj: unknown, key: string): T {
  return (obj as Record<string, T>)[key];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AppStateService — column order + hidden-set', () => {
  let service: AppStateService;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({}).compileComponents();
    service = TestBed.inject(AppStateService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  // ── Default state ────────────────────────────────────────────────────────

  it('matrixColOrder defaults to empty array when nothing in localStorage', () => {
    expect(service.matrixColOrder()).toEqual([]);
  });

  it('matrixColHidden defaults to empty set when nothing in localStorage', () => {
    expect(service.matrixColHidden().size).toBe(0);
  });

  // ── localStorage round-trip ───────────────────────────────────────────────

  it('persists matrixColOrder to localStorage via effect', async () => {
    // Trigger the effect by setting the signal
    service.matrixColOrder.set(['prod', 'staging', 'dev']);
    // Allow effects to flush
    await TestBed.flushEffects();
    const stored = localStorage.getItem('dd:colOrder');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual(['prod', 'staging', 'dev']);
  });

  it('restores matrixColOrder from localStorage on next init', async () => {
    localStorage.setItem('dd:colOrder', JSON.stringify(['prod', 'qa']));
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({}).compileComponents();
    const fresh = TestBed.inject(AppStateService);
    expect(fresh.matrixColOrder()).toEqual(['prod', 'qa']);
  });

  it('persists matrixColHidden to localStorage via effect', async () => {
    service.matrixColHidden.set(new Set(['dev', 'qa']));
    await TestBed.flushEffects();
    const stored = localStorage.getItem('dd:colHidden');
    expect(stored).not.toBeNull();
    // Order not guaranteed in Set; check both values present
    const parts = stored!.split(',');
    expect(parts).toContain('dev');
    expect(parts).toContain('qa');
  });

  it('restores matrixColHidden from localStorage on next init', async () => {
    localStorage.setItem('dd:colHidden', 'staging,prod');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({}).compileComponents();
    const fresh = TestBed.inject(AppStateService);
    expect(fresh.matrixColHidden().has('staging')).toBe(true);
    expect(fresh.matrixColHidden().has('prod')).toBe(true);
    expect(fresh.matrixColHidden().has('dev')).toBe(false);
  });

  it('colHidden round-trip survives empty string (nothing hidden)', async () => {
    localStorage.setItem('dd:colHidden', '');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({}).compileComponents();
    const fresh = TestBed.inject(AppStateService);
    expect(fresh.matrixColHidden().size).toBe(0);
  });

  // ── orderedVisibleEnvironments ────────────────────────────────────────────

  describe('orderedVisibleEnvironments()', () => {
    it('returns allEnvs in default order when colOrder is empty and nothing hidden', () => {
      service.matrixColOrder.set([]);
      service.matrixColHidden.set(new Set());
      const result = service.orderedVisibleEnvironments(['dev', 'staging', 'prod']);
      expect(result).toEqual(['dev', 'staging', 'prod']);
    });

    it('applies saved colOrder (permutation of allEnvs)', () => {
      service.matrixColOrder.set(['prod', 'staging', 'dev']);
      service.matrixColHidden.set(new Set());
      const result = service.orderedVisibleEnvironments(['dev', 'staging', 'prod']);
      expect(result).toEqual(['prod', 'staging', 'dev']);
    });

    it('drops hidden environments from the result', () => {
      service.matrixColOrder.set(['dev', 'staging', 'prod']);
      service.matrixColHidden.set(new Set(['staging']));
      const result = service.orderedVisibleEnvironments(['dev', 'staging', 'prod']);
      expect(result).toEqual(['dev', 'prod']);
    });

    it('appends new envs (not in saved order) at the end', () => {
      service.matrixColOrder.set(['prod', 'dev']);
      service.matrixColHidden.set(new Set());
      // 'staging' is a new env not in colOrder
      const result = service.orderedVisibleEnvironments(['dev', 'staging', 'prod']);
      expect(result).toEqual(['prod', 'dev', 'staging']);
    });

    it('omits envs in colOrder that no longer exist in allEnvs', () => {
      service.matrixColOrder.set(['prod', 'staging', 'qa', 'dev']);
      service.matrixColHidden.set(new Set());
      // 'qa' has been removed from data
      const result = service.orderedVisibleEnvironments(['dev', 'staging', 'prod']);
      expect(result).toEqual(['prod', 'staging', 'dev']);
    });

    it('returns empty array when all envs are hidden', () => {
      service.matrixColOrder.set([]);
      service.matrixColHidden.set(new Set(['dev', 'staging']));
      const result = service.orderedVisibleEnvironments(['dev', 'staging']);
      expect(result).toEqual([]);
    });
  });

  // ── reorderColumn ─────────────────────────────────────────────────────────

  describe('reorderColumn()', () => {
    it('moves fromEnv to the position of toEnv (forward)', () => {
      service.matrixColOrder.set(['dev', 'staging', 'qa', 'prod']);
      service.reorderColumn('dev', 'prod');
      expect(service.matrixColOrder()).toEqual(['staging', 'qa', 'prod', 'dev']);
    });

    it('moves fromEnv to the position of toEnv (backward)', () => {
      service.matrixColOrder.set(['dev', 'staging', 'qa', 'prod']);
      service.reorderColumn('prod', 'dev');
      expect(service.matrixColOrder()).toEqual(['prod', 'dev', 'staging', 'qa']);
    });

    it('does nothing when fromEnv === toEnv', () => {
      service.matrixColOrder.set(['dev', 'staging', 'prod']);
      service.reorderColumn('dev', 'dev');
      expect(service.matrixColOrder()).toEqual(['dev', 'staging', 'prod']);
    });

    it('does nothing when fromEnv is not in colOrder', () => {
      service.matrixColOrder.set(['dev', 'staging', 'prod']);
      service.reorderColumn('unknown', 'dev');
      expect(service.matrixColOrder()).toEqual(['dev', 'staging', 'prod']);
    });
  });

  // ── toggleColHidden ───────────────────────────────────────────────────────

  describe('toggleColHidden()', () => {
    it('hides a visible column', () => {
      service.matrixColHidden.set(new Set());
      service.toggleColHidden('staging', ['dev', 'staging', 'prod']);
      expect(service.matrixColHidden().has('staging')).toBe(true);
    });

    it('reveals a hidden column', () => {
      service.matrixColHidden.set(new Set(['staging']));
      service.toggleColHidden('staging', ['dev', 'staging', 'prod']);
      expect(service.matrixColHidden().has('staging')).toBe(false);
    });

    it('last-column guard: refuses to hide the only visible column', () => {
      service.matrixColHidden.set(new Set(['staging', 'prod']));
      // Only 'dev' is visible; trying to hide it should be a no-op
      service.toggleColHidden('dev', ['dev', 'staging', 'prod']);
      expect(service.matrixColHidden().has('dev')).toBe(false); // still visible
    });

    it('allows hiding down to exactly 1 visible column', () => {
      service.matrixColHidden.set(new Set(['prod']));
      // 'dev' and 'staging' are visible; hiding staging leaves 1 — allowed
      service.toggleColHidden('staging', ['dev', 'staging', 'prod']);
      expect(service.matrixColHidden().has('staging')).toBe(true);
    });
  });

  // ── resetColumns ─────────────────────────────────────────────────────────

  describe('resetColumns()', () => {
    it('clears hidden set', () => {
      service.matrixColHidden.set(new Set(['dev', 'qa']));
      service.resetColumns(['dev', 'qa', 'staging', 'prod']);
      expect(service.matrixColHidden().size).toBe(0);
    });

    it('resets colOrder to sortEnvs default', () => {
      service.matrixColOrder.set(['prod', 'staging', 'dev']);
      service.resetColumns(['dev', 'staging', 'prod']);
      // sortEnvs: dev < staging < prod (per ENV_ORDER in service)
      expect(service.matrixColOrder()).toEqual(['dev', 'staging', 'prod']);
    });
  });

  // ── toggleSvcHidden ───────────────────────────────────────────────────────

  describe('toggleSvcHidden()', () => {
    it('hides a visible service', () => {
      service.matrixSvcHidden.set(new Set());
      service.toggleSvcHidden('svc-b', ['svc-a', 'svc-b', 'svc-c']);
      expect(service.matrixSvcHidden().has('svc-b')).toBe(true);
    });

    it('reveals a hidden service', () => {
      service.matrixSvcHidden.set(new Set(['svc-b']));
      service.toggleSvcHidden('svc-b', ['svc-a', 'svc-b', 'svc-c']);
      expect(service.matrixSvcHidden().has('svc-b')).toBe(false);
    });

    it('last-visible guard: refuses to hide the only visible service', () => {
      service.matrixSvcHidden.set(new Set(['svc-b', 'svc-c']));
      // Only 'svc-a' is visible; hiding it must be a no-op
      service.toggleSvcHidden('svc-a', ['svc-a', 'svc-b', 'svc-c']);
      expect(service.matrixSvcHidden().has('svc-a')).toBe(false); // still visible
    });

    it('allows hiding down to exactly 1 visible service', () => {
      service.matrixSvcHidden.set(new Set(['svc-c']));
      // 'svc-a' and 'svc-b' visible; hiding 'svc-b' leaves 1 — allowed
      service.toggleSvcHidden('svc-b', ['svc-a', 'svc-b', 'svc-c']);
      expect(service.matrixSvcHidden().has('svc-b')).toBe(true);
    });
  });

  // ── resetServices ─────────────────────────────────────────────────────────

  describe('resetServices()', () => {
    it('clears the hidden service set', () => {
      service.matrixSvcHidden.set(new Set(['svc-a', 'svc-b']));
      service.resetServices();
      expect(service.matrixSvcHidden().size).toBe(0);
    });
  });

  // ── visibleServices ───────────────────────────────────────────────────────

  describe('visibleServices()', () => {
    it('returns all services when none are hidden', () => {
      service.matrixSvcHidden.set(new Set());
      expect(service.visibleServices(['svc-a', 'svc-b', 'svc-c']))
        .toEqual(['svc-a', 'svc-b', 'svc-c']);
    });

    it('filters out hidden services', () => {
      service.matrixSvcHidden.set(new Set(['svc-b']));
      expect(service.visibleServices(['svc-a', 'svc-b', 'svc-c']))
        .toEqual(['svc-a', 'svc-c']);
    });

    it('tolerates stale hidden entries (service no longer in allSvcs)', () => {
      // 'old-svc' is in the hidden set but no longer present in the data
      service.matrixSvcHidden.set(new Set(['old-svc', 'svc-b']));
      expect(service.visibleServices(['svc-a', 'svc-b', 'svc-c']))
        .toEqual(['svc-a', 'svc-c']);
    });

    it('returns all services when only stale entries are hidden', () => {
      service.matrixSvcHidden.set(new Set(['gone-1', 'gone-2']));
      expect(service.visibleServices(['svc-a', 'svc-b']))
        .toEqual(['svc-a', 'svc-b']);
    });
  });

  // ── svcHidden persistence round-trip ─────────────────────────────────────

  it('persists matrixSvcHidden to localStorage via effect', async () => {
    service.matrixSvcHidden.set(new Set(['svc-a', 'svc-c']));
    await TestBed.flushEffects();
    const stored = localStorage.getItem('dd:svcHidden');
    expect(stored).not.toBeNull();
    const parts = stored!.split(',');
    expect(parts).toContain('svc-a');
    expect(parts).toContain('svc-c');
  });

  it('restores matrixSvcHidden from localStorage on next init', async () => {
    localStorage.setItem('dd:svcHidden', 'svc-a,svc-b');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({}).compileComponents();
    const fresh = TestBed.inject(AppStateService);
    expect(fresh.matrixSvcHidden().has('svc-a')).toBe(true);
    expect(fresh.matrixSvcHidden().has('svc-b')).toBe(true);
    expect(fresh.matrixSvcHidden().has('svc-c')).toBe(false);
  });

  // ── kpi recompute over visible services × visible environments ────────────

  describe('kpi — filtered by svcHidden + colHidden', () => {
    const ev = (id: string, svc: string, env: string, status: 'in-progress' | 'success' | 'failure') => ({
      id, service: svc, environment: env, status, deployment_id: `d${id}`, happened_at: '',
    });
    const makeMatrix = () => ({
      generated_at: '2026-06-17T00:00:00Z',
      environments: ['dev', 'prod'],
      rows: [
        {
          service: 'svc-a',
          slots: {
            dev:  { current: ev('1', 'svc-a', 'dev',  'in-progress') },
            prod: { current: ev('2', 'svc-a', 'prod', 'success') },
          },
        },
        {
          service: 'svc-b',
          slots: {
            dev:  { current: ev('3', 'svc-b', 'dev',  'failure') },
            prod: { current: ev('4', 'svc-b', 'prod', 'in-progress') },
          },
        },
      ],
    });

    it('counts all services + envs when nothing is hidden', async () => {
      service.matrixData.set(makeMatrix());
      service.matrixSvcHidden.set(new Set());
      service.matrixColHidden.set(new Set());
      await TestBed.flushEffects();
      const kpi = service.kpi();
      expect(kpi.services).toBe(2);
      expect(kpi.environments).toBe(2);
      expect(kpi.inFlight).toBe(2); // svc-a/dev + svc-b/prod
      expect(kpi.failed).toBe(1);   // svc-b/dev
    });

    it('excludes hidden services from kpi counts', async () => {
      service.matrixData.set(makeMatrix());
      service.matrixSvcHidden.set(new Set(['svc-b']));
      service.matrixColHidden.set(new Set());
      await TestBed.flushEffects();
      const kpi = service.kpi();
      expect(kpi.services).toBe(1);
      expect(kpi.inFlight).toBe(1); // only svc-a/dev
      expect(kpi.failed).toBe(0);
    });

    it('excludes hidden environments from kpi counts', async () => {
      service.matrixData.set(makeMatrix());
      service.matrixSvcHidden.set(new Set());
      service.matrixColHidden.set(new Set(['prod']));
      await TestBed.flushEffects();
      const kpi = service.kpi();
      expect(kpi.environments).toBe(1);
      expect(kpi.inFlight).toBe(1); // svc-a/dev only (svc-b/prod hidden)
      expect(kpi.failed).toBe(1);   // svc-b/dev still visible
    });

    it('respects both svcHidden and colHidden simultaneously', async () => {
      service.matrixData.set(makeMatrix());
      service.matrixSvcHidden.set(new Set(['svc-b']));
      service.matrixColHidden.set(new Set(['prod']));
      await TestBed.flushEffects();
      const kpi = service.kpi();
      expect(kpi.services).toBe(1);      // svc-a only
      expect(kpi.environments).toBe(1);  // dev only
      expect(kpi.inFlight).toBe(1);      // svc-a/dev
      expect(kpi.failed).toBe(0);
    });
  });

  // ── syncColOrder ──────────────────────────────────────────────────────────

  describe('syncColOrder()', () => {
    it('appends new envs not already in colOrder', () => {
      service.matrixColOrder.set(['dev', 'prod']);
      service.syncColOrder(['dev', 'staging', 'prod']);
      const order = service.matrixColOrder();
      expect(order).toContain('dev');
      expect(order).toContain('prod');
      expect(order).toContain('staging');
    });

    it('prunes envs from colOrder that no longer exist in allEnvs', () => {
      service.matrixColOrder.set(['dev', 'staging', 'qa', 'prod']);
      service.syncColOrder(['dev', 'staging', 'prod']); // 'qa' removed
      expect(service.matrixColOrder()).not.toContain('qa');
    });
  });

  // ── First-time-reorder regression ────────────────────────────────────────
  //
  // Regression guard for the bug where reorderColumn() was always a no-op on
  // a fresh session because matrixColOrder stayed [] until syncColOrder was
  // called — but syncColOrder was never called automatically.
  //
  // The fix: an effect in the constructor calls syncColOrder whenever
  // matrixData() becomes non-null. These tests verify that path end-to-end.

  describe('first-time reorder (fresh session, no prior localStorage)', () => {

    it('setting matrixData populates matrixColOrder via the seeding effect', async () => {
      // Fresh service, empty colOrder (no localStorage entry)
      expect(service.matrixColOrder()).toEqual([]);

      // Simulate the GET /api/matrix response arriving
      service.matrixData.set({
        generated_at:  '2026-06-04T10:00:00Z',
        environments:  ['dev', 'staging', 'prod'],
        rows:          [],
      });

      // Allow the effect to run
      await TestBed.flushEffects();

      // colOrder must now contain all three environments
      expect(service.matrixColOrder()).toContain('dev');
      expect(service.matrixColOrder()).toContain('staging');
      expect(service.matrixColOrder()).toContain('prod');
      expect(service.matrixColOrder()).toHaveLength(3);
    });

    it('reorderColumn succeeds on the FIRST drag after matrixData loads (the regression case)', async () => {
      // Precondition: empty localStorage — no prior dd:colOrder stored
      expect(localStorage.getItem('dd:colOrder')).toBeNull();
      expect(service.matrixColOrder()).toEqual([]);

      // Matrix data loads (as it would from GET /api/matrix)
      service.matrixData.set({
        generated_at:  '2026-06-04T10:00:00Z',
        environments:  ['dev', 'staging', 'prod'],
        rows:          [],
      });
      await TestBed.flushEffects();

      // At this point a user drags 'dev' onto 'prod' for the first time.
      // Before the fix, matrixColOrder was still [] so indexOf returned -1
      // and reorderColumn returned early — a silent no-op.
      service.reorderColumn('dev', 'prod');

      // After the fix the reorder must take effect.
      // splice('dev' out of [dev,staging,prod], insert at prod's index):
      // → ['staging', 'prod', 'dev']
      expect(service.matrixColOrder()).toEqual(['staging', 'prod', 'dev']);
    });

    it('reorderColumn is a silent no-op WITHOUT the seeding effect (confirms test guards the bug)', async () => {
      // Manually reproduce the pre-fix state: colOrder is empty, matrixData set,
      // but syncColOrder is NOT called (i.e. the effect is absent).
      // We simulate by calling reorderColumn directly without flushEffects.
      service.matrixData.set({
        generated_at:  '2026-06-04T10:00:00Z',
        environments:  ['dev', 'staging', 'prod'],
        rows:          [],
      });
      // Deliberately do NOT flush effects — colOrder stays []

      service.reorderColumn('dev', 'prod');

      // With an empty colOrder, indexOf returns -1 → early return → order unchanged.
      // This is the broken behaviour the fix corrects; the array remains empty.
      expect(service.matrixColOrder()).toEqual([]);
    });

    it('seeding effect is idempotent: re-setting matrixData with same envs does not change colOrder', async () => {
      service.matrixData.set({
        generated_at: '2026-06-04T10:00:00Z',
        environments: ['dev', 'staging', 'prod'],
        rows:         [],
      });
      await TestBed.flushEffects();
      const orderAfterFirst = [...service.matrixColOrder()];

      // User reorders: dev → prod
      service.reorderColumn('dev', 'prod');
      const orderAfterReorder = [...service.matrixColOrder()];

      // SSE arrives with the same environment list (typical heartbeat / update)
      service.matrixData.set({
        generated_at: '2026-06-04T11:00:00Z',
        environments: ['dev', 'staging', 'prod'],
        rows:         [],
      });
      await TestBed.flushEffects();

      // syncColOrder with all envs already present must not overwrite the
      // user's reordered state
      expect(service.matrixColOrder()).toEqual(orderAfterReorder);
    });

    it('new environment added via SSE is appended to colOrder without disturbing existing order', async () => {
      service.matrixData.set({
        generated_at: '2026-06-04T10:00:00Z',
        environments: ['dev', 'staging'],
        rows:         [],
      });
      await TestBed.flushEffects();

      // User reorders: staging first
      service.reorderColumn('staging', 'dev');
      expect(service.matrixColOrder()).toEqual(['staging', 'dev']);

      // SSE adds a new 'prod' environment
      service.matrixData.set({
        generated_at: '2026-06-04T10:01:00Z',
        environments: ['dev', 'staging', 'prod'],
        rows:         [],
      });
      await TestBed.flushEffects();

      // Existing order preserved; 'prod' appended
      expect(service.matrixColOrder()).toEqual(['staging', 'dev', 'prod']);
    });

  });
});

// ── Badge count derivations — TopbarComponent helpers ─────────────────────────

import { MATRIX_FIELDS, SWIMLANE_FIELDS, MatrixField, SwimlaneField, Theme } from '../models/deployment.model';
import { NO_ERRORS_SCHEMA }   from '@angular/core';
import { TopbarComponent }    from '../../shared/topbar/topbar.component';
import { ThemeService }       from './theme.service';
import { RateLimitReport }    from '../models/deployment.model';
import { NotificationPrefsService } from './notification-prefs.service';
import { BrowserNotificationService } from './browser-notification.service';

describe('TopbarComponent — badge counts + Columns picker', () => {
  let component: TopbarComponent;
  let matrixVisibleFields:   ReturnType<typeof signal<Set<MatrixField>>>;
  let swimlaneVisibleFields: ReturnType<typeof signal<Set<SwimlaneField>>>;
  let activeView:            ReturnType<typeof signal<'matrix' | 'swimlanes'>>;
  let matrixColHidden:       ReturnType<typeof signal<Set<string>>>;
  let matrixColOrder:        ReturnType<typeof signal<string[]>>;
  let matrixSvcHidden:       ReturnType<typeof signal<Set<string>>>;
  let matrixData:            ReturnType<typeof signal<{ environments: string[]; rows: { service: string }[] } | null>>;

  beforeEach(async () => {
    localStorage.clear();

    matrixVisibleFields   = signal(new Set<MatrixField>(MATRIX_FIELDS));
    swimlaneVisibleFields = signal(new Set<SwimlaneField>(SWIMLANE_FIELDS));
    activeView            = signal<'matrix' | 'swimlanes'>('matrix');
    matrixColHidden       = signal(new Set<string>());
    matrixColOrder        = signal([] as string[]);
    matrixSvcHidden       = signal(new Set<string>());
    matrixData            = signal(null);

    const mockState: Partial<AppStateService> = {
      activeView,
      serviceFilter:        signal(''),
      failuresOnly:         signal(false),
      matrixVisibleFields,
      swimlaneVisibleFields,
      correlationPredicate: signal('explicit parent' as const),
      timeWindow:           signal('1 day' as const),
      sseConnected:         signal(false),
      kpi:                  signal({ services: 0, environments: 0, inFlight: 0, failed: 0 }) as never,
      rateLimitMap:         signal(new Map<string, RateLimitReport>()),
      matrixData:           matrixData as never,
      matrixColHidden,
      matrixColOrder,
      matrixSvcHidden,
      lastEffectiveEvent:   signal(null) as never,
      collapsedLanes:       signal(new Set<string>()),
      autoScrollOnChange:   signal(true),
      orderedVisibleEnvironments: (_envs: string[]) => [],
      toggleColHidden: (_env: string, _all: string[]) => {},
      resetColumns: (_all: string[]) => {},
      toggleSvcHidden: (_svc: string, _all: string[]) => {},
      resetServices: () => {},
      expandAllLanes:   () => {},
      collapseAllLanes: (_services: string[]) => {},
    };

    const mockTheme: Partial<ThemeService> = {
      theme: signal<Theme>('dark'),
      setTheme: () => {},
    };

    // Minimal stubs for services injected by TopbarComponent that are not
    // under test here — prevents their constructor effects from running.
    const mockNotifPrefs: Partial<NotificationPrefsService> = {
      prefs:        signal({ enabled: false, statuses: [], serviceMode: 'watch-all-except', serviceChips: [], envMode: 'watch-all-except', envChips: [] }) as never,
      updatePrefs:  () => {},
      shouldNotify: () => false,
    };
    const mockNotifService: Partial<BrowserNotificationService> = {
      isSupported:        () => false,
      requestPermission:  () => Promise.resolve('denied' as const),
      currentPermission:  'default' as const,
    };

    await TestBed.configureTestingModule({
      imports:   [TopbarComponent],
      providers: [
        { provide: AppStateService,          useValue: mockState       },
        { provide: ThemeService,             useValue: mockTheme       },
        { provide: NotificationPrefsService, useValue: mockNotifPrefs  },
        { provide: BrowserNotificationService, useValue: mockNotifService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TopbarComponent);
    component     = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  // ── colHiddenCount ────────────────────────────────────────────────────────

  describe('colHiddenCount()', () => {
    it('is 0 when nothing is hidden', () => {
      matrixColHidden.set(new Set());
      expect(priv<() => number>(component, 'colHiddenCount')()).toBe(0);
    });

    it('reflects the count of hidden environments', () => {
      matrixColHidden.set(new Set(['dev', 'prod']));
      expect(priv<() => number>(component, 'colHiddenCount')()).toBe(2);
    });
  });

  // ── fieldsHiddenCount — matrix ────────────────────────────────────────────

  describe('fieldsHiddenCount() — matrix view', () => {
    it('is 0 when all matrix fields are visible', () => {
      activeView.set('matrix');
      matrixVisibleFields.set(new Set<MatrixField>(MATRIX_FIELDS));
      expect(priv<() => number>(component, 'fieldsHiddenCount')()).toBe(0);
    });

    it('counts hidden matrix fields correctly', () => {
      activeView.set('matrix');
      // Hide 3 fields: version, sha, actor
      matrixVisibleFields.set(new Set<MatrixField>(['run_url', 'run_number', 'ref', 'happened_at']));
      expect(priv<() => number>(component, 'fieldsHiddenCount')()).toBe(3);
    });

    it('is MATRIX_FIELDS.length when all fields are hidden', () => {
      activeView.set('matrix');
      matrixVisibleFields.set(new Set<MatrixField>());
      expect(priv<() => number>(component, 'fieldsHiddenCount')()).toBe(MATRIX_FIELDS.length);
    });
  });

  // ── fieldsHiddenCount — swimlanes ─────────────────────────────────────────

  describe('fieldsHiddenCount() — swimlanes view', () => {
    it('is 0 when all swimlane fields are visible', () => {
      activeView.set('swimlanes');
      swimlaneVisibleFields.set(new Set<SwimlaneField>(SWIMLANE_FIELDS));
      expect(priv<() => number>(component, 'fieldsHiddenCount')()).toBe(0);
    });

    it('counts hidden swimlane fields correctly', () => {
      activeView.set('swimlanes');
      // Hide 2 fields: version, actor
      swimlaneVisibleFields.set(
        new Set<SwimlaneField>(['environment', 'run_url', 'sha', 'run_number', 'ref', 'happened_at']),
      );
      expect(priv<() => number>(component, 'fieldsHiddenCount')()).toBe(2);
    });

    it('uses SWIMLANE_FIELDS count (not MATRIX_FIELDS) in swimlanes view', () => {
      activeView.set('swimlanes');
      swimlaneVisibleFields.set(new Set<SwimlaneField>());
      // All SWIMLANE_FIELDS hidden
      expect(priv<() => number>(component, 'fieldsHiddenCount')()).toBe(SWIMLANE_FIELDS.length);
    });
  });

  // ── per-view switching of fieldsHiddenCount ───────────────────────────────

  it('fieldsHiddenCount updates when view switches between matrix and swimlanes', () => {
    activeView.set('matrix');
    matrixVisibleFields.set(new Set<MatrixField>(['version'])); // 6 hidden
    swimlaneVisibleFields.set(new Set<SwimlaneField>(SWIMLANE_FIELDS)); // 0 hidden

    expect(priv<() => number>(component, 'fieldsHiddenCount')()).toBe(MATRIX_FIELDS.length - 1);

    activeView.set('swimlanes');
    expect(priv<() => number>(component, 'fieldsHiddenCount')()).toBe(0);
  });

  // ── columnsBtnTitle ───────────────────────────────────────────────────────

  describe('columnsBtnTitle()', () => {
    it('returns generic title when nothing is hidden', () => {
      matrixColHidden.set(new Set());
      const title = priv<() => string>(component, 'columnsBtnTitle')();
      expect(title).toContain('show/hide');
    });

    it('returns count in title when 1 env is hidden (singular)', () => {
      matrixColHidden.set(new Set(['dev']));
      const title = priv<() => string>(component, 'columnsBtnTitle')();
      expect(title).toContain('1');
      expect(title).toContain('environment hidden');
    });

    it('returns count in title when 2 envs are hidden (plural)', () => {
      matrixColHidden.set(new Set(['dev', 'prod']));
      const title = priv<() => string>(component, 'columnsBtnTitle')();
      expect(title).toContain('2');
      expect(title).toContain('environments hidden');
    });
  });

  // ── svcHiddenCount ────────────────────────────────────────────────────────

  describe('svcHiddenCount()', () => {
    it('is 0 when nothing is hidden', () => {
      matrixSvcHidden.set(new Set());
      matrixData.set({ environments: [], rows: [{ service: 'svc-a' }, { service: 'svc-b' }] } as never);
      expect(priv<() => number>(component, 'svcHiddenCount')()).toBe(0);
    });

    it('counts only hidden services that exist in current data', () => {
      matrixData.set({ environments: [], rows: [{ service: 'svc-a' }, { service: 'svc-b' }] } as never);
      // 'old-svc' is stale — not in the data, must not count
      matrixSvcHidden.set(new Set(['svc-a', 'old-svc']));
      expect(priv<() => number>(component, 'svcHiddenCount')()).toBe(1);
    });

    it('returns correct count when multiple services are hidden', () => {
      matrixData.set({ environments: [], rows: [{ service: 'svc-a' }, { service: 'svc-b' }, { service: 'svc-c' }] } as never);
      matrixSvcHidden.set(new Set(['svc-a', 'svc-c']));
      expect(priv<() => number>(component, 'svcHiddenCount')()).toBe(2);
    });
  });

  // ── servicesBtnTitle ──────────────────────────────────────────────────────

  describe('servicesBtnTitle()', () => {
    it('returns generic title when nothing is hidden', () => {
      matrixSvcHidden.set(new Set());
      matrixData.set({ environments: [], rows: [{ service: 'svc-a' }] } as never);
      const title = priv<() => string>(component, 'servicesBtnTitle')();
      expect(title).toContain('show/hide');
    });

    it('returns count in title when 1 service is hidden (singular)', () => {
      matrixData.set({ environments: [], rows: [{ service: 'svc-a' }, { service: 'svc-b' }] } as never);
      matrixSvcHidden.set(new Set(['svc-a']));
      const title = priv<() => string>(component, 'servicesBtnTitle')();
      expect(title).toContain('1');
      expect(title).toContain('service hidden');
    });

    it('returns count in title when 2 services are hidden (plural)', () => {
      matrixData.set({ environments: [], rows: [{ service: 'svc-a' }, { service: 'svc-b' }, { service: 'svc-c' }] } as never);
      matrixSvcHidden.set(new Set(['svc-a', 'svc-b']));
      const title = priv<() => string>(component, 'servicesBtnTitle')();
      expect(title).toContain('2');
      expect(title).toContain('services hidden');
    });
  });
});
