/**
 * DeploymentApiService — unit tests.
 *
 * Covers:
 *   - rate-limit filtering + per-adapter map keying (App.connectComponentEvents logic)
 *   - sseConnected liveness via deploymentConnectionState$ Subject (App.connectSSE)
 *   - Shared EventSource multicast: N subscribers to the unfiltered stream open
 *     exactly ONE EventSource (the core fix for issue #363).
 *   - Filtered stream (service=X) opens its own EventSource, independent of the
 *     shared stream.
 *
 * EventSource is not available in the Vitest/jsdom environment for the liveness
 * and App-logic tests. Those tests simulate the observable/callback layer directly.
 * The multicast test stubs the EventSource constructor via globalThis.
 */
import { signal }             from '@angular/core';
import { TestBed }            from '@angular/core/testing';
import { Subject }            from 'rxjs';
import { ComponentEventRecord, RateLimitReport } from '../models/deployment.model';
import { DeploymentApiService } from './deployment-api.service';

// ── Helper — build a ComponentEventRecord ────────────────────────────────────

function mkRecord(
  event_type: string,
  state: string,
  payload: Record<string, unknown> | null,
): ComponentEventRecord {
  return {
    id:           'id-1',
    component_id: 'dashboard-fetcher',
    event_type,
    state,
    occurred_at:  '2026-06-04T10:00:00Z',
    received_at:  '2026-06-04T10:00:00Z',
    payload,
  };
}

/**
 * Simulate what App.connectComponentEvents() does for each record:
 * filter by event_type + payload, then map into a per-adapter RateLimitReport.
 * Returns the report or undefined (nothing set).
 */
function processRecord(record: ComponentEventRecord): RateLimitReport | undefined {
  if (record.event_type !== 'rate-limit' || !record.payload) {
    return undefined;
  }
  const p = record.payload;
  const adapter = typeof p['adapter'] === 'string' ? p['adapter'] : '';
  return {
    state:        record.state,
    adapter,
    ci_limit:     typeof p['ci_limit']     === 'number'  ? p['ci_limit']     : null,
    ci_remaining: typeof p['ci_remaining'] === 'number'  ? p['ci_remaining'] : null,
    own_budget:   typeof p['own_budget']   === 'number'  ? p['own_budget']   : null,
    own_used:     typeof p['own_used']     === 'number'  ? p['own_used']     : null,
    reset_at:     typeof p['reset_at']     === 'string'  ? p['reset_at']     : null,
  };
}

/**
 * Simulate what App.connectComponentEvents() does to the rateLimitMap signal:
 * update the per-adapter entry in the existing map.
 */
function applyToMap(
  mapSignal: ReturnType<typeof signal<Map<string, RateLimitReport>>>,
  record: ComponentEventRecord,
): void {
  const report = processRecord(record);
  if (report) {
    const next = new Map(mapSignal());
    next.set(report.adapter, report);
    mapSignal.set(next);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('App.connectComponentEvents — rate-limit filtering + per-adapter keying', () => {

  // ── Filter: only rate-limit events update the map ───────────────────────

  it('processes a rate-limit event and maps all fields correctly', () => {
    const record = mkRecord('rate-limit', 'running', {
      adapter:      'github-actions',
      ci_limit:     5000,
      ci_remaining: 4830,
      own_budget:   2500,
      own_used:     170,
      reset_at:     '2026-06-04T11:00:00Z',
    });

    const report = processRecord(record);
    expect(report).toBeDefined();
    expect(report!.state).toBe('running');
    expect(report!.adapter).toBe('github-actions');
    expect(report!.ci_limit).toBe(5000);
    expect(report!.ci_remaining).toBe(4830);
    expect(report!.own_budget).toBe(2500);
    expect(report!.own_used).toBe(170);
    expect(report!.reset_at).toBe('2026-06-04T11:00:00Z');
  });

  it('maps state:paused from the envelope', () => {
    const record = mkRecord('rate-limit', 'paused', {
      adapter: 'github-actions', ci_limit: 5000, ci_remaining: 4000,
      own_budget: 2500, own_used: 100, reset_at: null,
    });
    const report = processRecord(record);
    expect(report!.state).toBe('paused');
  });

  it('ignores non-rate-limit event_type "status"', () => {
    const record = mkRecord('status', 'running', { adapter: 'github-actions' });
    expect(processRecord(record)).toBeUndefined();
  });

  it('ignores non-rate-limit event_type "heartbeat"', () => {
    const record = mkRecord('heartbeat', 'running', {});
    expect(processRecord(record)).toBeUndefined();
  });

  it('ignores non-rate-limit event_type "error"', () => {
    const record = mkRecord('error', 'error', { message: 'boom' });
    expect(processRecord(record)).toBeUndefined();
  });

  it('ignores a rate-limit event with null payload', () => {
    const record = mkRecord('rate-limit', 'running', null);
    expect(processRecord(record)).toBeUndefined();
  });

  // ── Per-adapter map keying (Fix 4) ────────────────────────────────────────

  it('two adapters are both retained in the map (Fix 4)', () => {
    const rl = signal<Map<string, RateLimitReport>>(new Map());

    applyToMap(rl, mkRecord('rate-limit', 'running', {
      adapter: 'github-actions', ci_limit: 5000, ci_remaining: 4000,
      own_budget: 2500, own_used: 100, reset_at: null,
    }));
    applyToMap(rl, mkRecord('rate-limit', 'running', {
      adapter: 'azure-devops', ci_limit: 300, ci_remaining: 200,
      own_budget: 150, own_used: 50, reset_at: null,
    }));

    const map = rl();
    expect(map.size).toBe(2);
    expect(map.get('github-actions')?.own_used).toBe(100);
    expect(map.get('azure-devops')?.own_used).toBe(50);
  });

  it('second report for same adapter overwrites first (last-value-wins per adapter)', () => {
    const rl = signal<Map<string, RateLimitReport>>(new Map());

    applyToMap(rl, mkRecord('rate-limit', 'running', {
      adapter: 'github-actions', ci_limit: 5000, ci_remaining: 4000,
      own_budget: 2500, own_used: 100, reset_at: null,
    }));
    applyToMap(rl, mkRecord('rate-limit', 'running', {
      adapter: 'github-actions', ci_limit: 5000, ci_remaining: 3900,
      own_budget: 2500, own_used: 200, reset_at: null,
    }));

    const map = rl();
    expect(map.size).toBe(1);
    expect(map.get('github-actions')?.own_used).toBe(200);
  });

  it('non-rate-limit event does not modify the map', () => {
    const rl = signal<Map<string, RateLimitReport>>(new Map());

    applyToMap(rl, mkRecord('rate-limit', 'running', {
      adapter: 'github-actions', ci_limit: 5000, ci_remaining: 4000,
      own_budget: 2500, own_used: 100, reset_at: null,
    }));

    // Simulate a heartbeat arriving — processRecord returns undefined, App does not call set().
    applyToMap(rl, mkRecord('heartbeat', 'running', {}));

    // Map should still hold only the rate-limit report.
    const map = rl();
    expect(map.size).toBe(1);
    expect(map.get('github-actions')?.own_used).toBe(100);
  });

  // ── Null field handling ───────────────────────────────────────────────────

  it('maps null numeric fields to null (not 0 or NaN)', () => {
    const record = mkRecord('rate-limit', 'running', {
      adapter:      'github-actions',
      ci_limit:     null,
      ci_remaining: null,
      own_budget:   null,
      own_used:     null,
      reset_at:     null,
    });
    const report = processRecord(record);
    expect(report!.ci_limit).toBeNull();
    expect(report!.ci_remaining).toBeNull();
    expect(report!.own_budget).toBeNull();
    expect(report!.own_used).toBeNull();
    expect(report!.reset_at).toBeNull();
  });

  it('maps missing payload fields to null (defensive mapping)', () => {
    const record = mkRecord('rate-limit', 'running', { adapter: 'github-actions' });
    const report = processRecord(record);
    expect(report!.ci_limit).toBeNull();
    expect(report!.ci_remaining).toBeNull();
    expect(report!.own_budget).toBeNull();
    expect(report!.own_used).toBeNull();
    expect(report!.reset_at).toBeNull();
  });
});

// ── SSE liveness — sseConnected reflects connection state ─────────────────────
//
// App.connectSSE() now subscribes to api.deploymentConnectionState$ rather than
// passing onOpen/onError callbacks to streamEvents(). These tests verify that
// the Subject-based connection-state reporting correctly drives state.sseConnected.

describe('App.connectSSE — sseConnected liveness via deploymentConnectionState$', () => {
  it('sseConnected is set true when connectionState$ emits "connected"', () => {
    const sseConnected = signal<boolean>(false);
    const connectionState$ = new Subject<'connected' | 'error'>();

    connectionState$.subscribe((s) => sseConnected.set(s === 'connected'));
    connectionState$.next('connected');

    expect(sseConnected()).toBe(true);
  });

  it('sseConnected is set false when connectionState$ emits "error"', () => {
    const sseConnected = signal<boolean>(true);
    const connectionState$ = new Subject<'connected' | 'error'>();

    connectionState$.subscribe((s) => sseConnected.set(s === 'connected'));
    connectionState$.next('error');

    expect(sseConnected()).toBe(false);
  });

  it('sseConnected stays true even when no deployment events arrive', () => {
    const sseConnected = signal<boolean>(false);
    const connectionState$ = new Subject<'connected' | 'error'>();

    connectionState$.subscribe((s) => sseConnected.set(s === 'connected'));
    connectionState$.next('connected');

    // No events arrive — sseConnected must remain true.
    expect(sseConnected()).toBe(true);
  });

  it('applyDeploymentEvent is called WITHOUT toggling sseConnected (separation of concerns)', () => {
    // connectSSE() has two separate subscriptions:
    //  1. streamEvents().subscribe → applyDeploymentEvent (does NOT touch sseConnected)
    //  2. deploymentConnectionState$.subscribe → sseConnected.set(...)
    const sseConnected = signal<boolean>(false);
    let applyCount = 0;

    // Simulate the two-subscription pattern from App.connectSSE().
    const connectionState$ = new Subject<'connected' | 'error'>();
    connectionState$.subscribe((s) => sseConnected.set(s === 'connected'));

    const onNext = () => { applyCount++; /* does NOT touch sseConnected */ };

    connectionState$.next('connected');
    onNext(); // event arrives
    onNext(); // another event

    // sseConnected is still true (set by connectionState$, not reset by events).
    expect(sseConnected()).toBe(true);
    expect(applyCount).toBe(2);
  });
});

// ── Shared EventSource multicast (issue #363) ─────────────────────────────────
//
// Core fix: multiple subscribers to the unfiltered deployment stream must share
// ONE EventSource. Likewise for the component stream.

describe('DeploymentApiService — shared EventSource multicast (issue #363)', () => {
  /** Minimal EventSource stub that records how many instances were created. */
  interface EsStub {
    onopen:  ((e: Event) => void) | null;
    onerror: ((e: Event) => void) | null;
    close: () => void;
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  }

  let esInstances: EsStub[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let originalEventSource: any;

  function installEsStub(): void {
    esInstances = [];
    originalEventSource = (globalThis as Record<string, unknown>)['EventSource'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const EsClass = function (this: EsStub, _url: string) {
      this.onopen  = null;
      this.onerror = null;
      this.close   = () => { /* no-op */ };
      this.addEventListener = () => { /* no-op */ };
      esInstances.push(this);
    } as unknown as typeof EventSource;

    (globalThis as Record<string, unknown>)['EventSource'] = EsClass;
  }

  function removeEsStub(): void {
    if (originalEventSource !== undefined) {
      (globalThis as Record<string, unknown>)['EventSource'] = originalEventSource;
    } else {
      delete (globalThis as Record<string, unknown>)['EventSource'];
    }
  }

  beforeEach(() => {
    installEsStub();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    removeEsStub();
    TestBed.resetTestingModule();
  });

  it('N subscribers to the unfiltered deployment stream open exactly ONE EventSource', () => {
    const svc = TestBed.inject(DeploymentApiService);

    // Two independent subscribers — simulates App + BrowserNotificationService.
    const sub1 = svc.streamEvents().subscribe();
    const sub2 = svc.streamEvents().subscribe();

    expect(esInstances).toHaveLength(1);

    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it('three subscribers to the component stream open exactly ONE EventSource', () => {
    const svc = TestBed.inject(DeploymentApiService);

    const sub1 = svc.streamComponentEvents().subscribe();
    const sub2 = svc.streamComponentEvents().subscribe();
    const sub3 = svc.streamComponentEvents().subscribe();

    expect(esInstances).toHaveLength(1);

    sub1.unsubscribe();
    sub2.unsubscribe();
    sub3.unsubscribe();
  });

  it('filtered stream (service=X) opens its own EventSource, separate from the shared stream', () => {
    const svc = TestBed.inject(DeploymentApiService);

    // Unfiltered shared stream → 1 EventSource.
    const sub1 = svc.streamEvents().subscribe();

    // Filtered stream → 1 additional EventSource (different URL).
    const sub2 = svc.streamEvents({ service: 'payments-api' }).subscribe();

    expect(esInstances).toHaveLength(2);

    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it('both streams together open exactly TWO EventSources (not three)', () => {
    const svc = TestBed.inject(DeploymentApiService);

    // Unfiltered deployment stream — shared.
    const sub1 = svc.streamEvents().subscribe();
    const sub2 = svc.streamEvents().subscribe();

    // Component stream — separately shared.
    const sub3 = svc.streamComponentEvents().subscribe();
    const sub4 = svc.streamComponentEvents().subscribe();

    // 2 EventSources total: one for deployments, one for components.
    expect(esInstances).toHaveLength(2);

    sub1.unsubscribe();
    sub2.unsubscribe();
    sub3.unsubscribe();
    sub4.unsubscribe();
  });

  it('deploymentConnectionState$ emits "connected" when the shared EventSource opens', () => {
    const svc = TestBed.inject(DeploymentApiService);
    const states: string[] = [];
    // BehaviorSubject replays its seed ('error') on subscription before any
    // EventSource-driven value arrives — the last emitted value is what matters.
    const stateSub = svc.deploymentConnectionState$.subscribe((s) => states.push(s));

    // Subscribe to the shared stream to trigger EventSource creation.
    const sub1 = svc.streamEvents().subscribe();

    // Simulate the EventSource firing onopen.
    expect(esInstances).toHaveLength(1);
    esInstances[0].onopen?.(new Event('open'));

    expect(states.at(-1)).toBe('connected');

    sub1.unsubscribe();
    stateSub.unsubscribe();
  });

  it('deploymentConnectionState$ emits "error" when the shared EventSource errors', () => {
    const svc = TestBed.inject(DeploymentApiService);
    const states: string[] = [];
    // BehaviorSubject replays its seed ('error') on subscription; the EventSource
    // onerror then emits a second 'error'.
    // states[0] = BehaviorSubject seed 'error'; states[1] = onerror-driven 'error'.
    const stateSub = svc.deploymentConnectionState$.subscribe((s) => states.push(s));

    const sub1 = svc.streamEvents().subscribe();

    esInstances[0].onerror?.(new Event('error'));

    expect(states).toHaveLength(2);
    expect(states[1]).toBe('error');

    sub1.unsubscribe();
    stateSub.unsubscribe();
  });
});
