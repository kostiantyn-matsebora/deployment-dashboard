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
import { Router, RouterModule }      from '@angular/router';
import { vi }                        from 'vitest';

import { TopbarComponent }  from './topbar.component';
import { AppStateService }  from '../../core/services/app-state.service';
import { ThemeService }     from '../../core/services/theme.service';
import { NotificationPrefsService, NotifPrefs } from '../../core/services/notification-prefs.service';
import { BrowserNotificationService } from '../../core/services/browser-notification.service';
import { PresetsService }   from '../../core/services/presets.service';
import {
  Matrix,
  MatrixField,
  ProvidedPreset,
  RateLimitReport,
  Status,
  SwimlaneField,
  Theme,
} from '../../core/models/deployment.model';
import { ServiceIdentity } from '../../core/services/app-state.service';

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
      visibleServices:            (svcs: string[]) => svcs,
      visibleServiceIdentities:   (ids: Array<{ service: string; namespace: string | null | undefined }>) => ids,
      buildServiceSuggestions:    (rows: Array<{ service: string }>) => rows.map(r => r.service),
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
      visibleServices:            (svcs: string[]) => svcs,
      visibleServiceIdentities:   (ids: Array<{ service: string; namespace: string | null | undefined }>) => ids,
      buildServiceSuggestions:    (rows: Array<{ service: string }>) => rows.map(r => r.service),
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
      visibleServices:            (svcs: string[]) => svcs,
      visibleServiceIdentities:   (ids: Array<{ service: string; namespace: string | null | undefined }>) => ids,
      buildServiceSuggestions:    (rows: Array<{ service: string }>) => rows.map(r => r.service),
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

// ── TopbarComponent — svcHiddenCount / servicesCaption namespace identity (#353) ─
//
// Validates that badge count and caption text use distinct matrix-row identities
// (namespace|service pairs) as the denominator, NOT the autocomplete suggestion list
// which also contains bare names + namespaces + composites.

describe('TopbarComponent — svcHiddenCount / servicesCaption namespace identity (#353)', () => {
  let matrixDataSignal: ReturnType<typeof signal<Matrix | null>>;
  let servicePatternsSignal: ReturnType<typeof signal<string[]>>;
  let visibleServiceIdentitiesFn: (ids: ServiceIdentity[]) => ServiceIdentity[];
  let component: TopbarComponent;

  /** Build a minimal Matrix with namespaced rows. */
  function mkMatrix(rows: Array<{ service: string; namespace?: string | null }>): Matrix {
    return {
      generated_at: '2026-06-18T00:00:00Z',
      environments: ['dev'],
      rows: rows.map(r => ({ ...r, slots: {} })),
    };
  }

  async function buildComponent(
    matrixRows: Array<{ service: string; namespace?: string | null }>,
    patterns: string[],
    filterMode: 'exclude' | 'include',
    identitiesFilter: (ids: ServiceIdentity[]) => ServiceIdentity[],
  ): Promise<TopbarComponent> {
    matrixDataSignal        = signal<Matrix | null>(mkMatrix(matrixRows));
    servicePatternsSignal   = signal<string[]>(patterns);
    visibleServiceIdentitiesFn = identitiesFilter;

    const mockState: Partial<AppStateService> = {
      activeView:                 signal('matrix' as const),
      serviceFilter:              signal(''),
      failuresOnly:               signal(false),
      serviceFilterMode:          signal(filterMode),
      servicePatterns:            servicePatternsSignal,
      visibleServices:            (svcs: string[]) => svcs,
      visibleServiceIdentities:   identitiesFilter,
      buildServiceSuggestions:    (rows: Array<{ service: string }>) => rows.map(r => r.service),
      matrixVisibleFields:        signal(new Set<MatrixField>()),
      swimlaneVisibleFields:      signal(new Set<SwimlaneField>()),
      correlationPredicate:       signal('explicit parent' as const),
      timeWindow:                 signal('1 day' as const),
      sseConnected:               signal(false),
      kpi:                        signal({ services: 0, environments: 0, inFlight: 0, failed: 0 }) as never,
      rateLimitMap:               signal(new Map()),
      matrixData:                 matrixDataSignal,
      matrixColHidden:            signal(new Set<string>()),
      matrixColOrder:             signal([] as string[]),
      collapsedLanes:             signal(new Set<string>()),
      autoScrollOnChange:         signal(true),
      lastEffectiveEvent:         signal(null) as never,
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
      imports:   [TopbarComponent, RouterModule.forRoot([])],
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
    return component;
  }

  afterEach(() => TestBed.resetTestingModule());

  // ── (a) distinct identity count ──────────────────────────────────────────

  it('svcHiddenCount uses matrix-row count as denominator, not suggestion list length', async () => {
    // 2 rows: same service name "api" under two namespaces (team-a, team-b).
    // Include filter matches only team-a/api → 1 visible, 1 hidden.
    // A broken impl using allServiceNames would inflate the denominator by
    // counting bare "api", "team-a", "team-b", and "team-a/api", "team-b/api".
    const c = await buildComponent(
      [
        { service: 'api', namespace: 'team-a' },
        { service: 'api', namespace: 'team-b' },
      ],
      ['team-a/api'],
      'include',
      (ids: ServiceIdentity[]) => ids.filter(i => i.namespace === 'team-a'),
    );

    const hidden = priv<() => number>(c, 'svcHiddenCount')();
    // denominator = 2 rows; visible = 1 → hidden = 1
    expect(hidden).toBe(1);
  });

  it('svcHiddenCount is 0 when all rows are visible (no patterns)', async () => {
    const c = await buildComponent(
      [
        { service: 'api', namespace: 'team-a' },
        { service: 'api', namespace: 'team-b' },
      ],
      [],
      'exclude',
      (ids: ServiceIdentity[]) => ids,
    );

    expect(priv<() => number>(c, 'svcHiddenCount')()).toBe(0);
  });

  // ── (b) servicesCaption text ─────────────────────────────────────────────

  it('servicesCaption reports correct counts from row identities in exclude mode', async () => {
    const c = await buildComponent(
      [
        { service: 'api',  namespace: 'team-a' },
        { service: 'api',  namespace: 'team-b' },
        { service: 'auth', namespace: 'team-a' },
      ],
      ['team-a/*'],
      'exclude',
      // exclude team-a: only team-b/api remains visible
      (ids: ServiceIdentity[]) => ids.filter(i => i.namespace !== 'team-a'),
    );

    const caption = priv<() => string>(c, 'servicesCaption')();
    // 3 total rows; 1 visible; hidden = 2
    expect(caption).toBe('Hiding 2 of 3 · showing 1');
  });

  it('servicesCaption reports correct counts from row identities in include mode', async () => {
    const c = await buildComponent(
      [
        { service: 'api',  namespace: 'team-a' },
        { service: 'api',  namespace: 'team-b' },
        { service: 'auth', namespace: 'team-a' },
      ],
      ['team-a/*'],
      'include',
      // include team-a: 2 rows visible
      (ids: ServiceIdentity[]) => ids.filter(i => i.namespace === 'team-a'),
    );

    const caption = priv<() => string>(c, 'servicesCaption')();
    // 3 total rows; 2 visible
    expect(caption).toBe('Showing 2 of 3 services');
  });

  it('servicesCaption shows "all N services" when no patterns are set', async () => {
    const c = await buildComponent(
      [
        { service: 'alpha', namespace: null },
        { service: 'beta',  namespace: null },
      ],
      [],
      'exclude',
      (ids: ServiceIdentity[]) => ids,
    );

    const caption = priv<() => string>(c, 'servicesCaption')();
    expect(caption).toBe('Showing all 2 services');
  });
});

// ── Provided presets (issue #391) ────────────────────────────────────────────
//
// Covers:
//   - providedPresets()/hasProvidedPresets() reflect PresetsService.providedPresets()
//   - attributionLabel(): "provided by {source}" formatting
//   - applyProvidedPreset(): drives PresetsService.apply() via providedToEnvelope()
//   - cloneProvidedPreset(): drives PresetsService.clone() into a new local preset
//   - isProvidedPresetActive(): last-applied badge spans local + provided lists
//
// Strategy: same mock AppStateService/ThemeService/NotificationPrefsService as the
// rate-limit indicator suite above. PresetsService itself is REAL (providedIn: 'root')
// — its providedPresets signal is seeded directly (bypassing HTTP), matching how
// PresetsService's own loader is already covered by presets.service.spec.ts.

describe('TopbarComponent — provided presets (issue #391)', () => {
  let component:     TopbarComponent;
  let presetsService: PresetsService;

  function mkProvided(overrides: Partial<ProvidedPreset> = {}): ProvidedPreset {
    return {
      source:     'acme/web',
      name:       'ci-defaults',
      version:    1,
      settings:   { theme: 'dark', failOnly: true },
      fetched_at: '2026-07-01T10:00:00Z',
      ...overrides,
    };
  }

  beforeEach(async () => {
    const mockState: Partial<AppStateService> = {
      // Widened beyond the literal 'matrix' default so the resetAllSettings()
      // navigation tests below can seed a non-matrix starting view.
      activeView:             signal<'matrix' | 'swimlanes' | 'analytics'>('matrix'),
      serviceFilter:          signal(''),
      failuresOnly:           signal(false),
      serviceFilterMode:      signal('exclude' as const),
      servicePatterns:        signal([] as string[]),
      visibleServices:            (svcs: string[]) => svcs,
      visibleServiceIdentities:   (ids: Array<{ service: string; namespace: string | null | undefined }>) => ids,
      buildServiceSuggestions:    (rows: Array<{ service: string }>) => rows.map(r => r.service),
      matrixVisibleFields:    signal(new Set<MatrixField>()),
      swimlaneVisibleFields:  signal(new Set<SwimlaneField>()),
      correlationPredicate:   signal('explicit parent' as const),
      timeWindow:             signal('1 day' as const),
      sseConnected:            signal(false),
      kpi:                    signal({ services: 0, environments: 0, inFlight: 0, failed: 0 }) as never,
      rateLimitMap:            signal(new Map()),
      matrixData:              signal(null),
      matrixColHidden:         signal(new Set<string>()),
      matrixColOrder:          signal([] as string[]),
      collapsedLanes:          signal(new Set<string>()),
      autoScrollOnChange:      signal(true),
      lastEffectiveEvent:      signal(null) as never,
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
    component      = fixture.componentInstance;
    presetsService = TestBed.inject(PresetsService);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('providedPresets() / hasProvidedPresets()', () => {
    it('hasProvidedPresets() is false before any provided preset has loaded', () => {
      expect(priv<() => boolean>(component, 'hasProvidedPresets')()).toBe(false);
    });

    it('providedPresets() reflects PresetsService.providedPresets() once seeded', () => {
      const item = mkProvided();
      presetsService.providedPresets.set([item]);

      const list = priv<() => ProvidedPreset[]>(component, 'providedPresets')();
      expect(list).toEqual([item]);
      expect(priv<() => boolean>(component, 'hasProvidedPresets')()).toBe(true);
    });
  });

  describe('attributionLabel()', () => {
    it('formats "provided by {source}"', () => {
      const label = priv<(p: ProvidedPreset) => string>(component, 'attributionLabel')(
        mkProvided({ source: 'octo-org/service-b' }),
      );
      expect(label).toBe('provided by octo-org/service-b');
    });
  });

  describe('applyProvidedPreset() — apply-provided', () => {
    it('applies the settings and sets activePresetName to the provided preset\'s name', () => {
      const item = mkProvided({ name: 'from-ci', settings: { theme: 'light', failOnly: true } });
      presetsService.providedPresets.set([item]);

      priv<(p: ProvidedPreset) => void>(component, 'applyProvidedPreset').call(component, item);

      expect(presetsService.activePresetName()).toBe('from-ci');
    });

    it('does not add the provided preset to the local presets() store', () => {
      const item = mkProvided();
      presetsService.providedPresets.set([item]);

      priv<(p: ProvidedPreset) => void>(component, 'applyProvidedPreset').call(component, item);

      expect(presetsService.presets()).toEqual([]);
    });
  });

  describe('cloneProvidedPreset() — clone-provided-to-local', () => {
    it('creates a new local preset named "{name} (copy)" with the same settings', () => {
      const item = mkProvided({ name: 'ci-defaults', settings: { theme: 'light' } });
      presetsService.providedPresets.set([item]);

      priv<(p: ProvidedPreset) => void>(component, 'cloneProvidedPreset').call(component, item);

      const local = presetsService.presets();
      expect(local).toHaveLength(1);
      expect(local[0].name).toBe('ci-defaults (copy)');
      expect(local[0].settings).toEqual({ theme: 'light' });
    });

    it('the cloned local preset is independent of the source provided preset', () => {
      const item = mkProvided({ settings: { theme: 'dark' } });
      presetsService.providedPresets.set([item]);

      priv<(p: ProvidedPreset) => void>(component, 'cloneProvidedPreset').call(component, item);

      presetsService.presets()[0].settings.theme = 'light';
      expect(item.settings['theme']).toBe('dark');
    });
  });

  describe('isProvidedPresetActive() — active badge spans local + provided lists', () => {
    it('is false before the provided preset has been applied', () => {
      const item = mkProvided();
      presetsService.providedPresets.set([item]);

      expect(priv<(p: ProvidedPreset) => boolean>(component, 'isProvidedPresetActive').call(component, item)).toBe(false);
    });

    it('is true after applying the provided preset', () => {
      const item = mkProvided({ name: 'ci-defaults' });
      presetsService.providedPresets.set([item]);

      priv<(p: ProvidedPreset) => void>(component, 'applyProvidedPreset').call(component, item);

      expect(priv<(p: ProvidedPreset) => boolean>(component, 'isProvidedPresetActive').call(component, item)).toBe(true);
    });

    it('applying a LOCAL preset with the same name also marks the provided row active (name-keyed, matching local-vs-local behavior)', () => {
      const item = mkProvided({ name: 'shared-name' });
      presetsService.providedPresets.set([item]);
      presetsService.save('shared-name');
      const local = presetsService.presets().find((p) => p.name === 'shared-name')!;

      presetsService.apply(local);

      expect(priv<(p: ProvidedPreset) => boolean>(component, 'isProvidedPresetActive').call(component, item)).toBe(true);
    });
  });

  // ── applyEnvelope() router re-alignment (bug fix) ────────────────────────
  //
  // The rendered view is route-driven (App.syncActiveView maps URL →
  // state.activeView); PresetsService.apply()/resetAllSettings() only set
  // the signal, so a preset/reset that changes the view must also navigate
  // or the view switcher flips while RouterOutlet keeps rendering the
  // previous view.
  describe('applyProvidedPreset() — navigates when the preset changes the view', () => {
    it('navigates to the new view when the applied settings include view', () => {
      const router      = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const item = mkProvided({ name: 'swimlanes-preset', settings: { view: 'swimlanes' } });
      presetsService.providedPresets.set([item]);

      priv<(p: ProvidedPreset) => void>(component, 'applyProvidedPreset').call(component, item);

      expect(navigateSpy).toHaveBeenCalledWith(['/swimlanes']);
    });

    it('does not navigate when the applied settings do not include view', () => {
      const router      = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const item = mkProvided({ name: 'theme-only', settings: { theme: 'light' } });
      presetsService.providedPresets.set([item]);

      priv<(p: ProvidedPreset) => void>(component, 'applyProvidedPreset').call(component, item);

      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });

  describe('resetAllSettings() — navigates when reset changes the view', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('navigates to /matrix when the current view is not matrix', () => {
      const router      = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const state = TestBed.inject(AppStateService);
      state.activeView.set('swimlanes');

      priv<() => void>(component, 'resetAllSettings').call(component);

      expect(navigateSpy).toHaveBeenCalledWith(['/matrix']);
    });

    it('does not navigate when already on matrix', () => {
      const router      = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      priv<() => void>(component, 'resetAllSettings').call(component);

      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });
});

// ── TopbarComponent — importPresetsFromUrl handler ────────────────────────────
//
// Covers:
//   - blank URL → presetsMsg set to a prompt, presetUrlImporting stays false
//   - successful import → presetsMsg shows count, presetImportUrl cleared
//   - service returns string error → presetsMsg shows error
//   - presetUrlImporting is true during the async call and false after

describe('TopbarComponent — importPresetsFromUrl()', () => {
  let component: TopbarComponent;
  let importFromUrlSpy: ReturnType<typeof vi.fn>;

  function buildMockState(): Partial<AppStateService> {
    return {
      activeView:               signal('matrix' as const),
      serviceFilter:            signal(''),
      failuresOnly:             signal(false),
      serviceFilterMode:        signal('exclude' as const),
      servicePatterns:          signal([] as string[]),
      visibleServices:          (svcs: string[]) => svcs,
      visibleServiceIdentities: (ids: Array<{ service: string; namespace: string | null | undefined }>) => ids,
      buildServiceSuggestions:  (rows: Array<{ service: string }>) => rows.map(r => r.service),
      matrixVisibleFields:      signal(new Set()),
      swimlaneVisibleFields:    signal(new Set()),
      correlationPredicate:     signal('explicit parent' as const),
      timeWindow:               signal('1 day' as const),
      sseConnected:             signal(false),
      kpi:                      signal({ services: 0, environments: 0, inFlight: 0, failed: 0 }) as never,
      rateLimitMap:             signal(new Map()),
      matrixData:               signal(null),
      matrixColHidden:          signal(new Set<string>()),
      matrixColOrder:           signal([] as string[]),
      collapsedLanes:           signal(new Set<string>()),
      autoScrollOnChange:       signal(true),
      lastEffectiveEvent:       signal(null) as never,
    };
  }

  beforeEach(async () => {
    importFromUrlSpy = vi.fn();

    const mockPresetsService: Partial<PresetsService> = {
      presets:          signal([]) as never,
      activePresetName: signal(null) as never,
      providedPresets:  signal([]) as never,
      importFromUrl:    importFromUrlSpy as unknown as PresetsService['importFromUrl'],
    };

    const mockTheme: Partial<ThemeService> = {
      theme:    signal<Theme>('dark'),
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
      imports:   [TopbarComponent, RouterModule.forRoot([])],
      providers: [
        { provide: AppStateService,            useValue: buildMockState()   },
        { provide: ThemeService,               useValue: mockTheme           },
        { provide: NotificationPrefsService,   useValue: mockNotifPrefs      },
        { provide: BrowserNotificationService, useValue: mockNotifService    },
        { provide: PresetsService,             useValue: mockPresetsService  },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TopbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('sets presetsMsg when URL is blank and does not call importFromUrl', async () => {
    (component as unknown as Record<string, unknown>)['presetImportUrl'] = '   ';
    await priv<() => Promise<void>>(component, 'importPresetsFromUrl').call(component);
    expect(importFromUrlSpy).not.toHaveBeenCalled();
    expect(priv<() => string | null>(component, 'presetsMsg')()).toBeTruthy();
  });

  it('calls importFromUrl with the trimmed URL', async () => {
    importFromUrlSpy.mockResolvedValue({ imported: ['My Preset'] });
    (component as unknown as Record<string, unknown>)['presetImportUrl'] = '  https://example.com/p.json  ';
    await priv<() => Promise<void>>(component, 'importPresetsFromUrl').call(component);
    expect(importFromUrlSpy).toHaveBeenCalledWith('https://example.com/p.json');
  });

  it('sets presetsMsg to import count on success', async () => {
    importFromUrlSpy.mockResolvedValue({ imported: ['A', 'B'] });
    (component as unknown as Record<string, unknown>)['presetImportUrl'] = 'https://example.com/bundle.json';
    await priv<() => Promise<void>>(component, 'importPresetsFromUrl').call(component);
    const msg = priv<() => string | null>(component, 'presetsMsg')();
    expect(msg).toContain('2');
  });

  it('clears presetImportUrl on success', async () => {
    importFromUrlSpy.mockResolvedValue({ imported: ['X'] });
    (component as unknown as Record<string, unknown>)['presetImportUrl'] = 'https://example.com/x.json';
    await priv<() => Promise<void>>(component, 'importPresetsFromUrl').call(component);
    expect((component as unknown as Record<string, unknown>)['presetImportUrl']).toBe('');
  });

  it('sets presetsMsg to error string when service returns an error', async () => {
    importFromUrlSpy.mockResolvedValue('HTTP 404 — the server returned an error for that URL.');
    (component as unknown as Record<string, unknown>)['presetImportUrl'] = 'https://example.com/missing.json';
    await priv<() => Promise<void>>(component, 'importPresetsFromUrl').call(component);
    const msg = priv<() => string | null>(component, 'presetsMsg')();
    expect(typeof msg).toBe('string');
    expect(msg).toContain('404');
  });

  it('presetUrlImporting is false after a successful import', async () => {
    importFromUrlSpy.mockResolvedValue({ imported: ['Done'] });
    (component as unknown as Record<string, unknown>)['presetImportUrl'] = 'https://example.com/done.json';
    await priv<() => Promise<void>>(component, 'importPresetsFromUrl').call(component);
    expect(priv<() => boolean>(component, 'presetUrlImporting')()).toBe(false);
  });

  it('presetUrlImporting is false after a failed import (error path)', async () => {
    importFromUrlSpy.mockResolvedValue('Some error');
    (component as unknown as Record<string, unknown>)['presetImportUrl'] = 'https://example.com/fail.json';
    await priv<() => Promise<void>>(component, 'importPresetsFromUrl').call(component);
    expect(priv<() => boolean>(component, 'presetUrlImporting')()).toBe(false);
  });
});
