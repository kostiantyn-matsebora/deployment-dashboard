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
 * Strategy: provide a mock AppStateService with writable signals; feed the
 * component reports directly without hitting a real EventSource.
 * NO_ERRORS_SCHEMA skips PrimeNG rendering.
 */
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed }                   from '@angular/core/testing';

import { TopbarComponent }  from './topbar.component';
import { AppStateService }  from '../../core/services/app-state.service';
import { ThemeService }     from '../../core/services/theme.service';
import {
  MatrixField,
  RateLimitReport,
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
      matrixVisibleFields:    signal(new Set<MatrixField>()),
      swimlaneVisibleFields:  signal(new Set<SwimlaneField>()),
      correlationPredicate:   signal('explicit parent' as const),
      timeWindow:             signal('1 day' as const),
      sseConnected,
      kpi:                    signal({ services: 0, environments: 0, inFlight: 0, failed: 0 }) as never,
      rateLimitMap,
    };

    const mockTheme: Partial<ThemeService> = {
      theme: signal<Theme>('dark'),
      setTheme: () => {},
    };

    await TestBed.configureTestingModule({
      imports:   [TopbarComponent],
      providers: [
        { provide: AppStateService, useValue: mockState },
        { provide: ThemeService,    useValue: mockTheme },
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
