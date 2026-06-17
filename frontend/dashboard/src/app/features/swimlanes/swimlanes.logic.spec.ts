/**
 * swimlanes.logic.spec.ts — buildCollapsedVector tests for SwimlanesComponent.
 *
 * One of four spec files in the swimlanes suite; exists to keep per-fork V8
 * heap under 6 GB.  The Angular JIT cache fills ~680 MB per test and never
 * releases, so per-file test count must stay ≤ 5.
 *
 * Covers: buildCollapsedVector  (5 tests)
 *
 * lanesView collapse tests  → swimlanes.collapse-view.spec.ts
 * Edge-building / DAG tests → swimlanes.edges.spec.ts
 * Node-pool / SSE wiring    → swimlanes.component.spec.ts
 */
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed }                 from '@angular/core/testing';

import { SwimlanesComponent, SwimLane } from './swimlanes.component';
import { AppStateService }               from '../../core/services/app-state.service';
import {
  DeploymentEvent,
  Matrix,
  MatrixSlot,
  SwimlaneField,
  TimeWindow,
  CorrelationPredicate,
} from '../../core/models/deployment.model';

// ── Minimal test helpers (duplicated from swimlanes.component.spec.ts) ───────

let _seq = 0;

function mkEv(
  env: string,
  opts: {
    service?:     string;
    status?:      DeploymentEvent['status'];
    parents?:     string[];
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

function allNodeIds(lanes: SwimLane[]): string[] {
  return lanes.flatMap(l => l.dags.flatMap(d => d.nodes.map(n => n.id)));
}

function getLanes(c: SwimlanesComponent): SwimLane[] {
  return (c as unknown as { lanes(): SwimLane[] }).lanes();
}

function getLanesView(c: SwimlanesComponent): SwimLane[] {
  return (c as unknown as { lanesView(): SwimLane[] }).lanesView();
}

function buildCollapsedVector(
  c: SwimlanesComponent,
  events: DeploymentEvent[],
  nodeById: Map<string, DeploymentEvent>,
  links: Array<{ id: string; source: string; target: string }>,
): { vectorIds: Set<string>; tipId: string | null } {
  return (c as unknown as {
    buildCollapsedVector(
      events:  DeploymentEvent[],
      nodeById: Map<string, DeploymentEvent>,
      links:   Array<{ id: string; source: string; target: string }>,
    ): { vectorIds: Set<string>; tipId: string | null };
  }).buildCollapsedVector(events, nodeById, links);
}

// ── TestBed setup ─────────────────────────────────────────────────────────────

describe('SwimlanesComponent — pure logic', () => {
  let component:                 SwimlanesComponent;
  let fixture:                   ReturnType<typeof TestBed.createComponent<SwimlanesComponent>>;
  let matrixSignal:              ReturnType<typeof signal<Matrix | null>>;
  let mockSvcRef:                Partial<AppStateService>;

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  beforeEach(async () => {
    _seq         = 0;
    matrixSignal = signal<Matrix | null>(null);

    mockSvcRef = {
      matrixData:             matrixSignal,
      correlationPredicate:   signal<CorrelationPredicate>('explicit parent'),
      timeWindow:             signal<TimeWindow>('1 day'),
      swimlaneVisibleFields:  signal<Set<SwimlaneField>>(new Set()),
      selectedNodeId:         signal<string | null>(null),
      selectedEvent:          signal<DeploymentEvent | null>(null),
      selectedNextEvent:      signal<DeploymentEvent | null>(null),
      sseConnected:           signal(false),
      matrixSvcHidden:        signal(new Set<string>()),
      collapsedLanes:         signal(new Set<string>()),
      autoScrollOnChange:     signal(true),
      lastEffectiveEvent:     signal<DeploymentEvent | null>(null),
      initDefaultCollapsed:   () => {},
      toggleLaneCollapsed:    () => {},
      collapseAllLanes:       () => {},
      expandAllLanes:         () => {},
    };

    await TestBed.configureTestingModule({
      imports:   [SwimlanesComponent],
      providers: [{ provide: AppStateService, useValue: mockSvcRef }],
      schemas:   [NO_ERRORS_SCHEMA],
      teardown:  { destroyAfterEach: true, rethrowErrors: true },
    })
    // Empty template: no DOM rendering needed for pure-logic tests.
    .overrideComponent(SwimlanesComponent, { set: { template: '' } })
    .compileComponents();

    fixture   = TestBed.createComponent(SwimlanesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Collapse / Expand (#309) ────────────────────────────────────────────────

  describe('buildCollapsedVector (#309)', () => {
    it('returns empty vectorIds and null tipId for an empty event list', () => {
      const result = buildCollapsedVector(component, [], new Map(), []);
      expect(result.vectorIds.size).toBe(0);
      expect(result.tipId).toBeNull();
    });

    it('returns the single node as tip and vector for an isolated event', () => {
      const ev       = mkEv('dev');
      const nodeById = new Map([[ev.id, ev]]);
      // No parents → no links
      const result = buildCollapsedVector(component, [ev], nodeById, []);
      expect(result.tipId).toBe(ev.id);
      expect(result.vectorIds).toEqual(new Set([ev.id]));
    });

    it('walks backward to root: tip + its chain are in vectorIds', () => {
      const devEv = mkEv('dev', { happened_at: new Date(Date.now() - 120_000).toISOString() });
      const qaEv  = mkEv('qa',  { happened_at: new Date(Date.now() -  60_000).toISOString() });
      const nodeById = new Map([[devEv.id, devEv], [qaEv.id, qaEv]]);
      // devEv → qaEv edge (parent→child)
      const links = [{ id: `${devEv.id}--${qaEv.id}`, source: devEv.id, target: qaEv.id }];

      const result = buildCollapsedVector(component, [devEv, qaEv], nodeById, links);
      // tip = qaEv (newest); chain = [devEv, qaEv]
      expect(result.tipId).toBe(qaEv.id);
      expect(result.vectorIds).toEqual(new Set([devEv.id, qaEv.id]));
    });

    it('at a merge follows the parent with the newest happened_at', () => {
      const older = mkEv('staging', { happened_at: new Date(Date.now() - 200_000).toISOString() });
      const newer = mkEv('qa',      { happened_at: new Date(Date.now() - 100_000).toISOString() });
      const merge = mkEv('prod',    { happened_at: new Date(Date.now() -  30_000).toISOString() });
      const nodeById = new Map([[older.id, older], [newer.id, newer], [merge.id, merge]]);
      // Two edges converging into merge
      const links = [
        { id: `${older.id}--${merge.id}`, source: older.id, target: merge.id },
        { id: `${newer.id}--${merge.id}`, source: newer.id, target: merge.id },
      ];

      const result = buildCollapsedVector(component, [older, newer, merge], nodeById, links);
      // tip = merge; at merge follows newer (higher happened_at); chain = [newer, merge]
      expect(result.tipId).toBe(merge.id);
      expect(result.vectorIds).toEqual(new Set([newer.id, merge.id]));
      // older branch is excluded
      expect(result.vectorIds.has(older.id)).toBe(false);
    });

    it('finds the tip as the newest-happened_at event even when out of insertion order', () => {
      const old  = mkEv('dev',  { happened_at: new Date(Date.now() - 300_000).toISOString() });
      const mid  = mkEv('qa',   { happened_at: new Date(Date.now() - 200_000).toISOString() });
      const tip  = mkEv('prod', { happened_at: new Date(Date.now() -  10_000).toISOString() });
      // Events intentionally in non-chronological order; no edges (disconnected)
      const events   = [tip, old, mid];
      const nodeById = new Map(events.map(e => [e.id, e]));

      const result = buildCollapsedVector(component, events, nodeById, []);
      expect(result.tipId).toBe(tip.id);
    });
  });

});


