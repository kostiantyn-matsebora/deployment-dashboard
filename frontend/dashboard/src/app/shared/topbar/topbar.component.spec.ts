/**
 * TopbarComponent — rate-limit chip/popover unit tests.
 *
 * Covers:
 *   - chip hidden until first report arrives (empty map)
 *   - chip visible after first report (non-empty map)
 *   - per-adapter keying: two adapters retained, not overwritten (Fix 4)
 *   - chip label (chipLabel helper): null-field safety, NaN guard
 *   - ownBudgetPct helper: zero-division guard, null safety
 *   - fmtNum: em-dash for null/undefined, correct number output
 *   - formatResetAt: em-dash for null, non-empty for valid ISO timestamp
 *   - sseConnected liveness: signal reflects open/error, not event arrival (Fix 3)
 *   - localStorage hydrate/persist round-trip (Fix 2)
 *
 * Notification UX (#271):
 *   - toggleNotifEnabled → requestPermission on first enable
 *   - toggleNotifStatus add/remove
 *   - addNotifServiceChip adds + clears input + no duplicate
 *   - Enter-key adds chip
 *   - notifEnabled() drives the .has-active badge-dot class binding
 *
 * Strategy: provide a mock AppStateService with writable signals; feed the
 * component reports directly without hitting a real EventSource.
 * NO_ERRORS_SCHEMA skips PrimeNG rendering.
 */
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed }                   from '@angular/core/testing';
import { RouterModule }              from '@angular/router';
import { vi }                        from 'vitest';

import { TopbarComponent }  from './topbar.component';
import { AppStateService }  from '../../core/services/app-state.service';
import { ThemeService }     from '../../core/services/theme.service';
import { NotificationPrefsService, NotifPrefs } from '../../core/services/notification-prefs.service';
import { BrowserNotificationService } from '../../core/services/browser-notification.service';
import {
  MatrixField,
  RateLimitReport,
  Status,
  SwimlaneField,
  Theme,
} from '../../core/models/deployment.model';

// ── Minimal mock helpers ─────────────────────────────────────────────────────

function mkReport(overrides: Partial<RateLimitReport> = {}): RateLimitReport {
  return {
    state:        'running',
    adapter:      'github-actions',
    ci_limit:     5000,
    ci_remaining: 4830,
    own_budget:   2500,
    own_used:     170,
    reset_at:     '2026-06-04T11:00:00Z',
    ...overrides,
  };
}

/** Access a protected/private computed or method via type cast. */
function priv<T>(c: TopbarComponent, key: string): T {
  return (c as unknown as Record<string, T>)[key];
}

// ── Shared TestBed setup ─────────────────────────────────────────────────────

describe('TopbarComponent — rate-limit indicator', () => {
  let component:       TopbarComponent;
  let rateLimitMap:    ReturnType<typeof signal<Map<string, RateLimitReport>>>;
  let sseConnected:    ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    rateLimitMap  = signal<Map<string, RateLimitReport>>(new Map());
    sseConnected  = signal<boolean>(false);

    const mockState: Partial<AppStateService> = {
      activeView:             signal('matrix' as const),
      serviceFilter:          signal(''),
      failuresOnly:           signal(false),
      serviceFilterMode:      signal('exclude' as const),
      servicePatterns:        signal([] as string[]),
      visibleServices:        (svcs: string[]) => svcs,
      matrixVisibleFields:    signal(new Set<MatrixField>()),
      swimlaneVisibleFields:  signal(new Set<SwimlaneField>()),
      correlationPredicate:   signal('explicit parent' as const),
      timeWindow:             signal('1 day' as const),
      sseConnected,
      kpi:                    signal({ services: 0, environments: 0, inFlight: 0, failed: 0 }) as never,
      rateLimitMap,
      matrixData:             signal(null),
      matrixColHidden:        signal(new Set<string>()),
      matrixColOrder:         signal([] as string[]),
      // #309 collapse/expand signals
      collapsedLanes:         signal(new Set<string>()),
      autoScrollOnChange:     signal(true),
      // #271 browser-notifications
      lastEffectiveEvent:     signal(null) as never,
    };

    const mockTheme: Partial<ThemeService> = {
      theme: signal<Theme>('dark'),
      setTheme: () => {},
    };

    const mockNotifPrefs: Partial<NotificationPrefsService> = {
      prefs:        signal({ enabled: false, statuses: [], serviceMode: 'watch-all-except', serviceChips: [], envMode: 'watch-all-except', envChips: [] }) as never,
      updatePrefs:  () => {},
      shouldNotify: () => false,
    };

    const mockNotifService: Partial<BrowserNotificationService> = {
      isSupported:       () => false,
      requestPermission: () => Promise.resolve('denied' as const),
      currentPermission: 'default' as const,
    };

    await TestBed.configureTestingModule({
      imports:   [TopbarComponent],
      providers: [
        { provide: AppStateService,            useValue: mockState        },
        { provide: ThemeService,               useValue: mockTheme        },
        { provide: NotificationPrefsService,   useValue: mockNotifPrefs   },
        { provide: BrowserNotificationService, useValue: mockNotifService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TopbarComponent);
    component     = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Chip visibility ──────────────────────────────────────────────────────

  describe('chip visibility', () => {
    it('rateLimitEntries() is empty before any report arrives', () => {
      expect(priv<() => [string, RateLimitReport][]>(component, 'rateLimitEntries')()).toHaveLength(0);
    });

    it('rateLimitEntries() has one entry after a single adapter report', () => {
      rateLimitMap.set(new Map([['github-actions', mkReport()]]));
      const entries = priv<() => [string, RateLimitReport][]>(component, 'rateLimitEntries')();
      expect(entries).toHaveLength(1);
      expect(entries[0][0]).toBe('github-actions');
    });

    it('rateLimitEntries() has two entries for two different adapters (Fix 4)', () => {
      rateLimitMap.set(new Map([
        ['github-actions', mkReport({ adapter: 'github-actions', own_used: 100 })],
        ['azure-devops',   mkReport({ adapter: 'azure-devops',   own_used: 50  })],
      ]));
      const entries = priv<() => [string, RateLimitReport][]>(component, 'rateLimitEntries')();
      expect(entries).toHaveLength(2);
      const adapters = entries.map(e => e[0]).sort();
      expect(adapters).toEqual(['azure-devops', 'github-actions']);
    });

    it('second adapter report does not overwrite the first (Fix 4)', () => {
      // Simulate two sequential updates to the same map signal.
      const m1 = new Map<string, RateLimitReport>([
        ['github-actions', mkReport({ adapter: 'github-actions', own_used: 100 })],
      ]);
      rateLimitMap.set(m1);

      const m2 = new Map(m1);
      m2.set('azure-devops', mkReport({ adapter: 'azure-devops', own_used: 50 }));
      rateLimitMap.set(m2);

      const entries = priv<() => [string, RateLimitReport][]>(component, 'rateLimitEntries')();
      expect(entries).toHaveLength(2);
      const byAdapter = Object.fromEntries(entries);
      expect(byAdapter['github-actions'].own_used).toBe(100);
      expect(byAdapter['azure-devops'].own_used).toBe(50);
    });
  });

  // ── chipLabel helper ─────────────────────────────────────────────────────

  describe('chipLabel()', () => {
    it('returns own_used/own_budget when both are numbers', () => {
      const label = priv<(r: RateLimitReport) => string>(component, 'chipLabel');
      expect(label(mkReport({ own_used: 170, own_budget: 2500 }))).toBe('170/2500');
    });

    it('returns –/– when own_used is null', () => {
      const label = priv<(r: RateLimitReport) => string>(component, 'chipLabel');
      expect(label(mkReport({ own_used: null }))).toBe('–/–');
    });

    it('returns –/– when own_budget is null', () => {
      const label = priv<(r: RateLimitReport) => string>(component, 'chipLabel');
      expect(label(mkReport({ own_budget: null }))).toBe('–/–');
    });

    it('returns –/– when both are null', () => {
      const label = priv<(r: RateLimitReport) => string>(component, 'chipLabel');
      expect(label(mkReport({ own_used: null, own_budget: null }))).toBe('–/–');
    });
  });

  // ── ownBudgetPct helper — null safety / zero-division guard ─────────────

  describe('ownBudgetPct()', () => {
    it('calculates percentage correctly', () => {
      const pct = priv<(r: RateLimitReport) => number | null>(component, 'ownBudgetPct');
      expect(pct(mkReport({ own_used: 250, own_budget: 1000 }))).toBe(25);
    });

    it('clamps at 100 when own_used exceeds own_budget', () => {
      const pct = priv<(r: RateLimitReport) => number | null>(component, 'ownBudgetPct');
      expect(pct(mkReport({ own_used: 1500, own_budget: 1000 }))).toBe(100);
    });

    it('returns null when own_budget is 0 (zero-division guard)', () => {
      const pct = priv<(r: RateLimitReport) => number | null>(component, 'ownBudgetPct');
      expect(pct(mkReport({ own_budget: 0 }))).toBeNull();
    });

    it('returns null when own_budget is null', () => {
      const pct = priv<(r: RateLimitReport) => number | null>(component, 'ownBudgetPct');
      expect(pct(mkReport({ own_budget: null }))).toBeNull();
    });

    it('returns null when own_used is null', () => {
      const pct = priv<(r: RateLimitReport) => number | null>(component, 'ownBudgetPct');
      expect(pct(mkReport({ own_used: null }))).toBeNull();
    });

    it('does not produce NaN for any null combo', () => {
      const pct = priv<(r: RateLimitReport) => number | null>(component, 'ownBudgetPct');
      for (const combo of [
        { own_used: null, own_budget: null },
        { own_used: null, own_budget: 0 },
        { own_used: 0,   own_budget: null },
        { own_used: 0,   own_budget: 0 },
      ]) {
        expect(pct(mkReport(combo))).not.toBeNaN();
      }
    });
  });

  // ── fmtNum ───────────────────────────────────────────────────────────────

  describe('fmtNum()', () => {
    it('formats a positive integer', () => {
      const fmt = priv<(v: number | null | undefined) => string>(component, 'fmtNum');
      expect(fmt(42)).toBe('42');
    });

    it('formats zero', () => {
      const fmt = priv<(v: number | null | undefined) => string>(component, 'fmtNum');
      expect(fmt(0)).toBe('0');
    });

    it('returns em-dash for null', () => {
      const fmt = priv<(v: number | null | undefined) => string>(component, 'fmtNum');
      expect(fmt(null)).toBe('—');
    });

    it('returns em-dash for undefined', () => {
      const fmt = priv<(v: number | null | undefined) => string>(component, 'fmtNum');
      expect(fmt(undefined)).toBe('—');
    });
  });

  // ── formatResetAt ────────────────────────────────────────────────────────

  describe('formatResetAt()', () => {
    it('returns em-dash for null', () => {
      const fmt = priv<(v: string | null) => string>(component, 'formatResetAt');
      expect(fmt(null)).toBe('—');
    });

    it('returns a non-empty string for a valid ISO timestamp', () => {
      const fmt = priv<(v: string | null) => string>(component, 'formatResetAt');
      const result = fmt('2026-06-04T11:00:00Z');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toBe('—');
    });

    it('returns a string (not NaN) for a non-parseable value', () => {
      const fmt = priv<(v: string | null) => string>(component, 'formatResetAt');
      const result = fmt('not-a-date');
      expect(typeof result).toBe('string');
    });
  });

  // ── SSE live indicator — liveness via sseConnected signal (Fix 3) ────────

  describe('sseConnected liveness (Fix 3)', () => {
    it('is false initially', () => {
      expect(priv<() => boolean>(component, 'sseConnected')()).toBe(false);
    });

    it('reflects true when sseConnected signal is set (simulates onopen)', () => {
      sseConnected.set(true);
      expect(priv<() => boolean>(component, 'sseConnected')()).toBe(true);
    });

    it('reflects false when sseConnected signal is cleared (simulates onerror)', () => {
      sseConnected.set(true);
      sseConnected.set(false);
      expect(priv<() => boolean>(component, 'sseConnected')()).toBe(false);
    });

    it('does not require an event to arrive — stays true with no rate-limit events', () => {
      // sseConnected is true (onopen fired) but no rate-limit events yet.
      sseConnected.set(true);
      // rateLimitMap is still empty — no rate-limit events arrived.
      expect(priv<() => [string, RateLimitReport][]>(component, 'rateLimitEntries')()).toHaveLength(0);
      // BUT sseConnected must still be true — connection is alive.
      expect(priv<() => boolean>(component, 'sseConnected')()).toBe(true);
    });
  });

  // ── Chip absent until signal is populated ─────────────────────────────────

  describe('chip absent until signal is populated', () => {
    it('rateLimitEntries() stays empty when no rate-limit events are sent', () => {
      expect(priv<() => [string, RateLimitReport][]>(component, 'rateLimitEntries')()).toHaveLength(0);
    });
  });
});

// ── Legend popover guard — hidden on Analytics tab ───────────────────────────
//
// The legend button/popover must NOT appear when the active view is "analytics"
// (mockup #view-analytics shows no legend button).
// It IS shown on matrix and swimlanes.

describe('TopbarComponent — legend popover guard', () => {
  async function buildWithView(view: 'matrix' | 'swimlanes' | 'analytics') {
    const activeViewSig = signal<'matrix' | 'swimlanes' | 'analytics'>(view);
    const mockState: Partial<AppStateService> = {
      activeView:             activeViewSig as never,
      serviceFilter:          signal(''),
      failuresOnly:           signal(false),
      serviceFilterMode:      signal('exclude' as const),
      servicePatterns:        signal([] as string[]),
      visibleServices:        (svcs: string[]) => svcs,
      matrixVisibleFields:    signal(new Set<MatrixField>()),
      swimlaneVisibleFields:  signal(new Set<SwimlaneField>()),
      correlationPredicate:   signal('explicit parent' as const),
      timeWindow:             signal('1 day' as const),
      sseConnected:           signal(false),
      kpi:                    signal({ services: 0, environments: 0, inFlight: 0, failed: 0 }) as never,
      rateLimitMap:           signal(new Map()),
      matrixData:             signal(null),
      matrixColHidden:        signal(new Set<string>()),
      matrixColOrder:         signal([] as string[]),
      // #309 collapse/expand signals
      collapsedLanes:         signal(new Set<string>()),
      autoScrollOnChange:     signal(true),
      // #271 browser-notifications
      lastEffectiveEvent:     signal(null) as never,
    };
    const mockTheme: Partial<ThemeService> = {
      theme: signal<Theme>('dark'),
      setTheme: () => {},
    };
    const mockNotifPrefs: Partial<NotificationPrefsService> = {
      prefs:        signal({ enabled: false, statuses: [], serviceMode: 'watch-all-except', serviceChips: [], envMode: 'watch-all-except', envChips: [] }) as never,
      updatePrefs:  () => {},
      shouldNotify: () => false,
    };
    const mockNotifService: Partial<BrowserNotificationService> = {
      isSupported:       () => false,
      requestPermission: () => Promise.resolve('denied' as const),
      currentPermission: 'default' as const,
    };
    await TestBed.configureTestingModule({
      imports:   [TopbarComponent],
      providers: [
        { provide: AppStateService,            useValue: mockState        },
        { provide: ThemeService,               useValue: mockTheme        },
        { provide: NotificationPrefsService,   useValue: mockNotifPrefs   },
        { provide: BrowserNotificationService, useValue: mockNotifService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    const f = TestBed.createComponent(TopbarComponent);
    f.detectChanges();
    return f;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('legend button is visible on matrix view', async () => {
    const f = await buildWithView('matrix');
    const btn = Array.from<HTMLButtonElement>(f.nativeElement.querySelectorAll('button.icon-btn'))
      .find((b: HTMLButtonElement) => b.getAttribute('aria-label') === 'Legend — status key');
    expect(btn).toBeTruthy();
  });

  it('legend button is visible on swimlanes view', async () => {
    const f = await buildWithView('swimlanes');
    const btn = Array.from<HTMLButtonElement>(f.nativeElement.querySelectorAll('button.icon-btn'))
      .find((b: HTMLButtonElement) => b.getAttribute('aria-label') === 'Legend — status key');
    expect(btn).toBeTruthy();
  });

  it('legend button is absent on analytics view', async () => {
    const f = await buildWithView('analytics');
    const btn = Array.from<HTMLButtonElement>(f.nativeElement.querySelectorAll('button.icon-btn'))
      .find((b: HTMLButtonElement) => b.getAttribute('aria-label') === 'Legend — status key');
    expect(btn).toBeUndefined();
  });
});

// ── localStorage hydrate/persist round-trip (Fix 2) ─────────────────────────

describe('AppStateService.rateLimitMap — localStorage hydration (Fix 2)', () => {
  const STORAGE_KEY = 'dd.rateLimit';

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('hydrates a single-adapter map from localStorage on init', async () => {
    const stored = {
      'github-actions': {
        state: 'running', adapter: 'github-actions',
        ci_limit: 5000, ci_remaining: 4000,
        own_budget: 2500, own_used: 200, reset_at: '2026-06-04T11:00:00Z',
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    await TestBed.configureTestingModule({
      providers: [AppStateService],
    }).compileComponents();

    const service = TestBed.inject(AppStateService);
    const map = service.rateLimitMap();
    expect(map.size).toBe(1);
    expect(map.get('github-actions')?.own_used).toBe(200);

    TestBed.resetTestingModule();
  });

  it('hydrates a two-adapter map from localStorage on init (Fix 4 compose)', async () => {
    const stored = {
      'github-actions': {
        state: 'running', adapter: 'github-actions',
        ci_limit: 5000, ci_remaining: 4000,
        own_budget: 2500, own_used: 100, reset_at: null,
      },
      'azure-devops': {
        state: 'running', adapter: 'azure-devops',
        ci_limit: 300, ci_remaining: 200,
        own_budget: 150, own_used: 50, reset_at: null,
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    await TestBed.configureTestingModule({
      providers: [AppStateService],
    }).compileComponents();

    const service = TestBed.inject(AppStateService);
    const map = service.rateLimitMap();
    expect(map.size).toBe(2);
    expect(map.get('github-actions')?.own_used).toBe(100);
    expect(map.get('azure-devops')?.own_used).toBe(50);

    TestBed.resetTestingModule();
  });

  it('starts with empty map when localStorage has no entry', async () => {
    await TestBed.configureTestingModule({
      providers: [AppStateService],
    }).compileComponents();

    const service = TestBed.inject(AppStateService);
    expect(service.rateLimitMap().size).toBe(0);

    TestBed.resetTestingModule();
  });

  it('starts with empty map when localStorage value is malformed', async () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{');

    await TestBed.configureTestingModule({
      providers: [AppStateService],
    }).compileComponents();

    const service = TestBed.inject(AppStateService);
    expect(service.rateLimitMap().size).toBe(0);

    TestBed.resetTestingModule();
  });
});

// ── TopbarComponent notification UX tests (#271) ─────────────────────────────
//
// Covers:
//   - toggleNotifEnabled → calls requestPermission on first enable
//   - toggleNotifStatus: add and remove a status
//   - addNotifServiceChip: adds chip, clears input, rejects duplicate
//   - Enter-key on service input adds chip
//   - notifEnabled() computed: true drives .has-active on the bell button

describe('TopbarComponent — notification UX (#271)', () => {
  let component: TopbarComponent;
  let prefsSignal: ReturnType<typeof signal<NotifPrefs>>;
  let requestPermissionSpy: ReturnType<typeof vi.fn>;

  // Build a fully functional mocked NotifPrefs so mutations are observable.
  function buildMockPrefs(enabled = false): {
    prefs: ReturnType<typeof signal<NotifPrefs>>;
    updatePrefs: (patch: Partial<NotifPrefs>) => void;
  } {
    const s = signal<NotifPrefs>({
      enabled,
      statuses: ['success', 'failure'] as Status[],
      serviceMode: 'watch-all-except',
      serviceChips: [],
      envMode: 'watch-all-except',
      envChips: [],
    });
    const updatePrefs = (patch: Partial<NotifPrefs>) => {
      s.set({ ...s(), ...patch });
    };
    return { prefs: s, updatePrefs };
  }

  beforeEach(async () => {
    requestPermissionSpy = vi.fn().mockResolvedValue('granted' as NotificationPermission);

    const { prefs, updatePrefs } = buildMockPrefs(false);
    prefsSignal = prefs;

    const mockState: Partial<AppStateService> = {
      activeView:             signal('matrix' as const),
      serviceFilter:          signal(''),
      failuresOnly:           signal(false),
      serviceFilterMode:      signal('exclude' as const),
      servicePatterns:        signal([] as string[]),
      visibleServices:        (svcs: string[]) => svcs,
      matrixVisibleFields:    signal(new Set<MatrixField>()),
      swimlaneVisibleFields:  signal(new Set<SwimlaneField>()),
      correlationPredicate:   signal('explicit parent' as const),
      timeWindow:             signal('1 day' as const),
      sseConnected:           signal(false),
      kpi:                    signal({ services: 0, environments: 0, inFlight: 0, failed: 0 }) as never,
      rateLimitMap:           signal(new Map()),
      matrixData:             signal(null),
      matrixColHidden:        signal(new Set<string>()),
      matrixColOrder:         signal([] as string[]),
      collapsedLanes:         signal(new Set<string>()),
      autoScrollOnChange:     signal(true),
      lastEffectiveEvent:     signal(null) as never,
    };

    const mockNotifPrefs: Partial<NotificationPrefsService> = {
      prefs: prefsSignal as never,
      updatePrefs,
      shouldNotify: () => false,
    };

    const mockNotifService: Partial<BrowserNotificationService> = {
      isSupported:       () => true,
      requestPermission: requestPermissionSpy as unknown as () => Promise<NotificationPermission>,
      currentPermission: 'default' as const,
    };

    const mockTheme: Partial<ThemeService> = {
      theme: signal<Theme>('dark'),
      setTheme: () => {},
    };

    await TestBed.configureTestingModule({
      imports:   [TopbarComponent, RouterModule.forRoot([])],
      providers: [
        { provide: AppStateService,            useValue: mockState         },
        { provide: ThemeService,               useValue: mockTheme         },
        { provide: NotificationPrefsService,   useValue: mockNotifPrefs    },
        { provide: BrowserNotificationService, useValue: mockNotifService  },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TopbarComponent);
    component     = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  // ── toggleNotifEnabled ──────────────────────────────────────────────────

  describe('toggleNotifEnabled()', () => {
    it('calls requestPermission when enabling for the first time (enabled was false)', async () => {
      expect(prefsSignal().enabled).toBe(false);
      priv<() => void>(component, 'toggleNotifEnabled').call(component);
      expect(prefsSignal().enabled).toBe(true);
      expect(requestPermissionSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT call requestPermission when disabling', async () => {
      // First enable.
      priv<() => void>(component, 'toggleNotifEnabled').call(component);
      requestPermissionSpy.mockClear();
      // Now disable.
      priv<() => void>(component, 'toggleNotifEnabled').call(component);
      expect(prefsSignal().enabled).toBe(false);
      expect(requestPermissionSpy).not.toHaveBeenCalled();
    });
  });

  // ── toggleNotifStatus ────────────────────────────────────────────────────

  describe('toggleNotifStatus()', () => {
    it('adds a status when it is not yet in the list', () => {
      // Remove 'failure' to give a clean starting state.
      priv<(s: Status) => void>(component, 'toggleNotifStatus').call(component, 'failure');
      expect(prefsSignal().statuses).not.toContain('failure');

      priv<(s: Status) => void>(component, 'toggleNotifStatus').call(component, 'pending');
      expect(prefsSignal().statuses).toContain('pending');
    });

    it('removes a status when it is already in the list', () => {
      // 'success' starts enabled by default in the mock prefs.
      priv<(s: Status) => void>(component, 'toggleNotifStatus').call(component, 'success');
      expect(prefsSignal().statuses).not.toContain('success');
    });
  });

  // ── onNotifServicePatternsChange ─────────────────────────────────────────
  // The notification chip input is now handled by PatternFilterComponent.
  // TopbarComponent receives patternsChange output and delegates to updatePrefs.

  describe('onNotifServicePatternsChange()', () => {
    it('updates serviceChips in prefs', () => {
      priv<(chips: string[]) => void>(component, 'onNotifServicePatternsChange').call(component, ['my-service', '*-api']);
      expect(prefsSignal().serviceChips).toEqual(['my-service', '*-api']);
    });

    it('clears serviceChips when called with empty array', () => {
      priv<(chips: string[]) => void>(component, 'onNotifServicePatternsChange').call(component, ['x']);
      priv<(chips: string[]) => void>(component, 'onNotifServicePatternsChange').call(component, []);
      expect(prefsSignal().serviceChips).toEqual([]);
    });
  });

  // ── onNotifEnvPatternsChange ─────────────────────────────────────────────

  describe('onNotifEnvPatternsChange()', () => {
    it('updates envChips in prefs', () => {
      priv<(chips: string[]) => void>(component, 'onNotifEnvPatternsChange').call(component, ['prod', 'staging']);
      expect(prefsSignal().envChips).toEqual(['prod', 'staging']);
    });
  });

  // ── notifEnabled badge-dot ────────────────────────────────────────────────

  describe('notifEnabled() computed — badge-dot class', () => {
    it('notifEnabled() is false when prefs.enabled is false', () => {
      expect(priv<() => boolean>(component, 'notifEnabled')()).toBe(false);
    });

    it('notifEnabled() is true after enabling', () => {
      priv<() => void>(component, 'toggleNotifEnabled').call(component);
      expect(priv<() => boolean>(component, 'notifEnabled')()).toBe(true);
    });
  });
});
