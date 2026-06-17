import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed }                 from '@angular/core/testing';
import { vi }                      from 'vitest';

import { SwimlanesComponent, SwimLane } from './swimlanes.component';
import { AppStateService }               from '../../core/services/app-state.service';
import {
  CorrelationPredicate,
  DeploymentEvent,
  Matrix,
  MatrixSlot,
  SwimlaneField,
  TimeWindow,
} from '../../core/models/deployment.model';

// ── Minimal test helpers ─────────────────────────────────────────────────────

let _seq = 0;

/**
 * Build a minimal DeploymentEvent.  `happened_at` defaults to "1 minute ago"
 * so events fit within any non-trivial time window.
 */
function mkEv(
  env: string,
  opts: {
    service?:    string;
    status?:     DeploymentEvent['status'];
    parents?:    string[];
    happened_at?: string;
  } = {},
): DeploymentEvent {
  const n = ++_seq;
  return {
    id:                 `id-${n}`,
    deployment_id:      `dep-${n}`,
    service:            opts.service   ?? 'svc',
    environment:        env,
    status:             opts.status    ?? 'success',
    happened_at:        opts.happened_at
                          ?? new Date(Date.now() - 60_000).toISOString(),
    parent_deployments: opts.parents ?? [],
  };
}

/** Build a Matrix from a shorthand slot spec. */
function mkMatrix(
  rows: Array<{ service: string; slots: Record<string, MatrixSlot> }>,
): Matrix {
  const envs = [...new Set(rows.flatMap(r => Object.keys(r.slots)))];
  return {
    generated_at: new Date().toISOString(),
    environments: envs,
    rows,
  };
}

/** Collect every node id across all lanes and all DAGs. */
function allNodeIds(lanes: SwimLane[]): string[] {
  return lanes.flatMap(l => l.dags.flatMap(d => d.nodes.map(n => n.id)));
}

/** Read the protected `lanes` computed directly (avoids template rendering). */
function getLanes(c: SwimlanesComponent): SwimLane[] {
  return (c as unknown as { lanes(): SwimLane[] }).lanes();
}

/** Read the protected `flashingIds` signal. */
function getFlashingIds(c: SwimlanesComponent): Set<string> {
  return (c as unknown as { flashingIds(): Set<string> }).flashingIds();
}

// ── Shared TestBed setup ─────────────────────────────────────────────────────

describe('SwimlanesComponent', () => {
  let component:                  SwimlanesComponent;
  let fixture:                    ReturnType<typeof TestBed.createComponent<SwimlanesComponent>>;
  let matrixSignal:               ReturnType<typeof signal<Matrix | null>>;
  let predSignal:                 ReturnType<typeof signal<CorrelationPredicate>>;
  let twSignal:                   ReturnType<typeof signal<TimeWindow>>;
  let lastEffectiveEventSignal:   ReturnType<typeof signal<DeploymentEvent | null>>;
  /** Reference to the mock AppStateService — used by collapse tests to mutate signals. */
  let mockSvcRef:                 Partial<AppStateService>;

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  beforeEach(async () => {
    _seq                      = 0;
    matrixSignal              = signal<Matrix | null>(null);
    predSignal                = signal<CorrelationPredicate>('explicit parent');
    twSignal                  = signal<TimeWindow>('1 day');
    lastEffectiveEventSignal  = signal<DeploymentEvent | null>(null);

    mockSvcRef = {
      matrixData:             matrixSignal,
      correlationPredicate:   predSignal,
      timeWindow:             twSignal,
      swimlaneVisibleFields:  signal<Set<SwimlaneField>>(new Set()),
      selectedNodeId:         signal<string | null>(null),
      selectedEvent:          signal<DeploymentEvent | null>(null),
      selectedNextEvent:      signal<DeploymentEvent | null>(null),
      sseConnected:           signal(false),
      matrixSvcHidden:        signal(new Set<string>()),
      // #309 collapse/expand + SSE wiring signals
      collapsedLanes:         signal(new Set<string>()),
      autoScrollOnChange:     signal(true),
      lastEffectiveEvent:     lastEffectiveEventSignal,
      initDefaultCollapsed:   () => {},
      toggleLaneCollapsed:    () => {},
      collapseAllLanes:       () => {},
      expandAllLanes:         () => {},
    };

    await TestBed.configureTestingModule({
      imports:   [SwimlanesComponent],
      providers: [{ provide: AppStateService, useValue: mockSvcRef }],
      // NgxGraphModule is aliased to a lightweight stub via vitest.config.ts
      // (resolve.alias → src/testing/ngx-graph.stub.ts) so the real dagre /
      // webcola layout engine is never loaded into the jsdom worker.
      // NO_ERRORS_SCHEMA suppresses template errors for VisCard / InspectorPanel
      // (child components — logic tests do not need their rendered output).
      schemas:   [NO_ERRORS_SCHEMA],
    })
    // Replace the SVG-heavy template with an empty shell so Angular does not
    // JIT-compile ngx-graph / foreignObject / vis-card markup into jsdom DOM.
    // All logic under test (signals, computeds, effects, methods) is unaffected;
    // no test asserts on rendered DOM output.  Combined with maxForks:1 and the
    // swimlanes.logic.spec.ts split, this keeps each fork's peak heap under the
    // NODE_OPTIONS ceiling configured by CI.
    .overrideComponent(SwimlanesComponent, { set: { template: '' } })
    .compileComponents();

    fixture   = TestBed.createComponent(SwimlanesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Node pool (eventsFromMatrix) ─────────────────────────────────────────

  describe('node pool', () => {
    it('returns empty lanes when matrix is null', () => {
      expect(getLanes(component)).toHaveLength(0);
    });

    it('includes the current event for every slot', () => {
      const dev = mkEv('dev');
      const qa  = mkEv('qa');
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: { dev: { current: dev }, qa: { current: qa } },
      }]));

      const ids = allNodeIds(getLanes(component));
      expect(ids).toContain(dev.id);
      expect(ids).toContain(qa.id);
    });

    it('excludes last_successful — it drives box-state only, not swimlane nodes', () => {
      const current  = mkEv('prod', { status: 'in-progress' });
      const lastSucc = mkEv('prod', { status: 'success' }); // older run
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: { prod: { current, last_successful: lastSucc } },
      }]));

      const ids = allNodeIds(getLanes(component));
      expect(ids).toContain(current.id);
      expect(ids).not.toContain(lastSucc.id);
    });

    it('deduplicates when the same id appears across multiple slots', () => {
      // Guard against hypothetical API bugs; `seen` set handles this.
      const ev = mkEv('dev');
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: { dev: { current: ev }, duplicate: { current: ev } },
      }]));

      const ids = allNodeIds(getLanes(component));
      expect(ids.filter(id => id === ev.id)).toHaveLength(1);
    });

    it('produces one lane per service, sorted alphabetically', () => {
      matrixSignal.set(mkMatrix([
        { service: 'zeta', slots: { dev: { current: mkEv('dev', { service: 'zeta' }) } } },
        { service: 'alpha', slots: { dev: { current: mkEv('dev', { service: 'alpha' }) } } },
      ]));

      const names = getLanes(component).map(l => l.service);
      expect(names).toEqual(['alpha', 'zeta']);
    });
  });

  // ── SSE live-change wiring (#309) ────────────────────────────────────────
  //
  // Verifies that:
  // (a) onSseChange() flashes the tip card for the matching lane
  // (b) onSseChange() is a no-op for an unknown service
  // (c) the lastEffectiveEvent effect calls onSseChange for effective events
  // (d) the effect does NOT call onSseChange when the signal is null
  //
  // Note: these tests call onSseChange() directly (or spy on it) to avoid
  // triggering a full ngx-graph re-render inside the effect flush, which
  // causes an OOM in the jsdom vitest environment when loaded alongside the
  // rest of the test suite.

  describe('SSE live-change wiring — onSseChange + lastEffectiveEvent (#309)', () => {
    let svcEv: DeploymentEvent;

    beforeEach(() => {
      svcEv = mkEv('dev', { service: 'svc', status: 'success' });
      matrixSignal.set(mkMatrix([{ service: 'svc', slots: { dev: { current: svcEv } } }]));
    });

    it('onSseChange for the lane service adds its tipId to flashingIds', () => {
      // Confirm no flash initially
      expect(getFlashingIds(component).size).toBe(0);

      // The lane has a single event → it IS the tip
      const lane = getLanes(component).find(l => l.service === 'svc')!;
      expect(lane.tipId).not.toBeNull();

      // flashCard() defers adding the tipId behind two rAF ticks so the
      // new DOM node is painted before the animation class is applied (#309 fix).
      // In jsdom, requestAnimationFrame is not a real paint-tied API —
      // spy on it to call callbacks synchronously so the unit test can verify
      // the signal update without fighting jsdom's rAF polyfill timing.
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((cb) => { cb(0); return 0; });
      try {
        component.onSseChange('svc');
      } finally {
        rafSpy.mockRestore();
      }

      expect(getFlashingIds(component).has(lane.tipId!)).toBe(true);
    });

    it('onSseChange for an unknown service does not flash any id', () => {
      component.onSseChange('no-such-service');
      expect(getFlashingIds(component).size).toBe(0);
    });

    it('onSseChange for a different service does not flash svc tipId', () => {
      matrixSignal.set(mkMatrix([
        { service: 'svc',       slots: { dev:  { current: mkEv('dev',  { service: 'svc'       }) } } },
        { service: 'other-svc', slots: { prod: { current: mkEv('prod', { service: 'other-svc', status: 'failure' }) } } },
      ]));

      component.onSseChange('other-svc');

      const svcLane = getLanes(component).find(l => l.service === 'svc')!;
      if (svcLane.tipId) {
        expect(getFlashingIds(component).has(svcLane.tipId)).toBe(false);
      }
    });

    it('lastEffectiveEvent effect calls onSseChange for effective events', () => {
      const spy = vi.spyOn(component, 'onSseChange');
      spy.mockClear();

      // Set signal to an effective event — the effect must call onSseChange
      lastEffectiveEventSignal.set(mkEv('dev', { service: 'svc', status: 'success' }));
      TestBed.flushEffects();

      expect(spy).toHaveBeenCalledWith('svc');
    });

    it('lastEffectiveEvent effect does NOT call onSseChange when signal is null', () => {
      const spy = vi.spyOn(component, 'onSseChange');
      spy.mockClear();

      lastEffectiveEventSignal.set(null);
      TestBed.flushEffects();

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
