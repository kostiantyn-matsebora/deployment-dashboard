import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

import { AnalyticsComponent } from './analytics.component';
import {
  AnalyticsDora,
  AnalyticsFrequency,
  AnalyticsChangeFailureRate,
  AnalyticsDurationHistogram,
  AnalyticsPromotionFunnel,
  AnalyticsStatusDistribution,
  AnalyticsHeatmap,
  AnalyticsTopDeployers,
  AnalyticsIncidents,
  AnalyticsWindow,
} from '../../core/models/deployment.model';
import { DeploymentApiService } from '../../core/services/deployment-api.service';
import { of } from 'rxjs';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const WINDOW: AnalyticsWindow = {
  days: 14,
  from: '2026-05-27T00:00:00Z',
  to:   '2026-06-10T00:00:00Z',
  retention_days: 365,
  clamped: false,
};

const DORA_FIXTURE: AnalyticsDora = {
  window: WINDOW,
  deployment_frequency: { value: 9.2, unit: 'per_day', classification: 'elite', trend_delta: 0.12, sparkline: [7,9,6,11,8], approximated: false },
  lead_time:            { value: 2.1, unit: 'hours',   classification: 'high',  trend_delta: -0.05, sparkline: [3,2.5,2.1,2.3,2], approximated: true },
  change_failure_rate:  { value: 0.08, unit: 'ratio',  classification: 'elite', trend_delta: -0.03, sparkline: [0.1,0.09,0.08], approximated: false },
  time_to_restore:      { value: 42,   unit: 'minutes',classification: 'high',  trend_delta: null,  sparkline: [50,45,42], approximated: false },
};

const FREQ_FIXTURE: AnalyticsFrequency = {
  window: WINDOW,
  buckets: [
    { date: '2026-06-01', success: 8, failure: 1 },
    { date: '2026-06-02', success: 6, failure: 0 },
  ],
};

const CFR_FIXTURE: AnalyticsChangeFailureRate = {
  window: WINDOW,
  elite_threshold: 0.15,
  buckets: [
    { date: '2026-06-01', rate: 0.11 },
    { date: '2026-06-02', rate: 0.0 },
  ],
};

const DUR_FIXTURE: AnalyticsDurationHistogram = {
  window: WINDOW,
  bins: [
    { label: '0-10',  lower_minutes: 0,  upper_minutes: 10,   count: 5 },
    { label: '10-30', lower_minutes: 10, upper_minutes: 30,   count: 12 },
    { label: '30+',   lower_minutes: 30, upper_minutes: null, count: 3 },
  ],
  p50_minutes: 15,
  p95_minutes: 35,
};

const FUNNEL_FIXTURE: AnalyticsPromotionFunnel = {
  window: WINDOW,
  stages: [
    { environment: 'dev',     count: 50, conversion: 0.82 },
    { environment: 'staging', count: 41, conversion: 0.78 },
    { environment: 'qa',      count: 32, conversion: 0.90 },
    { environment: 'preprod', count: 29, conversion: 0.86 },
    { environment: 'prod',    count: 25, conversion: null },
  ],
};

const STATUS_FIXTURE: AnalyticsStatusDistribution = {
  window: WINDOW,
  statuses: [
    { status: 'pending',     count: 3 },
    { status: 'queued',      count: 2 },
    { status: 'waiting',     count: 1 },
    { status: 'in-progress', count: 4 },
    { status: 'success',     count: 100 },
    { status: 'failure',     count: 8 },
    { status: 'cancelled',   count: 2 },
    { status: 'rejected',    count: 1 },
  ],
};

const HEATMAP_FIXTURE: AnalyticsHeatmap = {
  window: WINDOW,
  cells: [
    { day_of_week: 1, hour: 10, count: 5 },
    { day_of_week: 3, hour: 14, count: 8 },
  ],
};

const DEPLOYERS_FIXTURE: AnalyticsTopDeployers = {
  window: WINDOW,
  deployers: [
    { actor: 'alice', count: 42 },
    { actor: 'bob',   count: 17 },
  ],
};

const INCIDENTS_FIXTURE: AnalyticsIncidents = {
  window: WINDOW,
  incidents: [
    { service: 'checkout', environment: 'prod', failed_at: '2026-06-08T14:02:00Z', restored_at: null,                      duration_minutes: null, severity: 'critical' },
    { service: 'auth',     environment: 'prod', failed_at: '2026-06-07T09:10:00Z', restored_at: '2026-06-07T10:05:00Z',  duration_minutes: 55,   severity: 'medium' },
  ],
};

// ── Mock API ──────────────────────────────────────────────────────────────────

function mockApi(): Partial<DeploymentApiService> {
  return {
    getAnalyticsDora:              () => of(DORA_FIXTURE),
    getAnalyticsFrequency:         () => of(FREQ_FIXTURE),
    getAnalyticsChangeFailureRate: () => of(CFR_FIXTURE),
    getAnalyticsDurationHistogram: () => of(DUR_FIXTURE),
    getAnalyticsPromotionFunnel:   () => of(FUNNEL_FIXTURE),
    getAnalyticsStatusDistribution:() => of(STATUS_FIXTURE),
    getAnalyticsHeatmap:           () => of(HEATMAP_FIXTURE),
    getAnalyticsTopDeployers:      () => of(DEPLOYERS_FIXTURE),
    getAnalyticsIncidents:         () => of(INCIDENTS_FIXTURE),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnalyticsComponent', () => {
  let fixture: ComponentFixture<AnalyticsComponent>;
  let component: AnalyticsComponent;

  beforeEach(async () => {
    // jsdom does not implement ResizeObserver; polyfill it before rendering
    // the component so NgxEchartsDirective does not throw.
    if (typeof (globalThis as Record<string, unknown>)['ResizeObserver'] === 'undefined') {
      (globalThis as Record<string, unknown>)['ResizeObserver'] = class {
        observe()   { /* noop */ }
        unobserve() { /* noop */ }
        disconnect(){ /* noop */ }
      };
    }

    await TestBed.configureTestingModule({
      imports: [AnalyticsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DeploymentApiService, useValue: mockApi() },
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(AnalyticsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders 4 DORA KPI cards', () => {
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.an-kpi-card');
    expect(cards.length).toBe(4);
  });

  it('default period is 14d', () => {
    const active: HTMLElement = fixture.nativeElement.querySelector('.an-period-btn.is-active');
    expect(active?.textContent?.trim()).toBe('14d');
  });

  it('switches period on button click', () => {
    const buttons: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.an-period-btn');
    const btn7d = Array.from(buttons).find(b => b.textContent?.trim() === '7d') as HTMLButtonElement;
    btn7d.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.an-period-btn.is-active')?.textContent?.trim()).toBe('7d');
  });

  it('renders KPI value for deployment_frequency', () => {
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.an-kpi-value');
    const values = Array.from(cards).map(c => c.textContent?.trim());
    expect(values).toContain('9.2');
  });

  it('renders classification chip "elite" for deployment_frequency', () => {
    const chips: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.an-class-chip.elite');
    expect(chips.length).toBeGreaterThanOrEqual(1);
  });

  it('renders CFR as percentage (ratio unit)', () => {
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.an-kpi-value');
    const values = Array.from(cards).map(c => c.textContent?.trim());
    expect(values).toContain('8.0%');
  });

  it('renders incidents list with 2 rows', () => {
    const rows: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.an-incident-row');
    expect(rows.length).toBe(2);
  });

  it('renders unresolved incident duration as em-dash', () => {
    const durs: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.an-inc-dur');
    const texts = Array.from(durs).map(d => d.textContent?.trim());
    expect(texts[0]).toBe('—');
  });

  it('renders 8 donut legend rows for all statuses', () => {
    const rows: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.an-legend-row');
    expect(rows.length).toBe(8);
  });

  it('renders 3 period buttons', () => {
    const btns: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.an-period-btn');
    expect(btns.length).toBe(3);
  });

  it('sparklinePath returns empty string for empty array', () => {
    expect((component as unknown as { sparklinePath: (v: number[]) => string }).sparklinePath([])).toBe('');
  });

  it('sparklinePath returns a path string for non-empty array', () => {
    const path = (component as unknown as { sparklinePath: (v: number[]) => string }).sparklinePath([1, 2, 3]);
    expect(path).toMatch(/^M /);
  });

  it('formatDuration returns minutes below 60', () => {
    const fn = (component as unknown as { formatDuration: (m: number | null) => string }).formatDuration;
    expect(fn(42)).toBe('42 min');
  });

  it('formatDuration returns hours for >= 60', () => {
    const fn = (component as unknown as { formatDuration: (m: number | null) => string }).formatDuration;
    expect(fn(90)).toBe('1.5 h');
  });

  it('formatDuration returns em-dash for null', () => {
    const fn = (component as unknown as { formatDuration: (m: number | null) => string }).formatDuration;
    expect(fn(null)).toBe('—');
  });

  it('loading indicator is absent once all 9 requests have resolved', () => {
    // The mock API returns synchronous observables (of()), so all 9 requests
    // resolve before detectChanges returns — the counter drops to 0.
    expect(fixture.nativeElement.querySelector('.an-loading-bar')).toBeNull();
  });

  it('subtitleText omits retention clause when not clamped', () => {
    // WINDOW fixture has clamped: false — subtitle must NOT contain "retention".
    const sub: HTMLElement = fixture.nativeElement.querySelector('.an-sub');
    expect(sub?.textContent).not.toContain('retention');
  });

  it('subtitleText computed includes retention clause when clamped', () => {
    // Test the computed value directly without DOM re-render (avoids jsdom canvas churn).
    const c = component as unknown as {
      frequency: { set(v: typeof FREQ_FIXTURE | null): void };
      dora: { set(v: typeof DORA_FIXTURE | null): void };
      subtitleText: () => string;
    };
    const clampedWindow: AnalyticsWindow = { ...WINDOW, clamped: true };
    c.dora.set(null);
    c.frequency.set({ ...FREQ_FIXTURE, window: clampedWindow });
    expect(c.subtitleText()).toContain('retention');
  });
});
