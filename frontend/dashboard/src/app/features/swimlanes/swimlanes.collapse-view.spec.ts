/**
 * swimlanes.collapse-view.spec.ts — lanesView collapse-filtering tests.
 *
 * One of four spec files in the swimlanes suite; exists to keep per-fork V8
 * heap under 6 GB.  The Angular JIT cache fills ~680 MB per test and never
 * releases, so per-file test count must stay ≤ 5.
 *
 * Covers: lanesView — collapse filtering  (4 tests)
 *
 * buildCollapsedVector tests → swimlanes.logic.spec.ts
 * Edge-building / DAG tests  → swimlanes.edges.spec.ts
 * Node-pool / SSE wiring     → swimlanes.component.spec.ts
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

// ── Minimal test helpers ─────────────────────────────────────────────────────

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

// ── TestBed setup ─────────────────────────────────────────────────────────────

describe('SwimlanesComponent — lanesView collapse filtering (#309)', () => {
  let component:    SwimlanesComponent;
  let fixture:      ReturnType<typeof TestBed.createComponent<SwimlanesComponent>>;
  let matrixSignal: ReturnType<typeof signal<Matrix | null>>;
  let mockSvcRef:   Partial<AppStateService>;

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
      collapsedLanes:         signal(new Set<string>()),
      autoScrollOnChange:     signal(true),
      lastEffectiveEvent:     signal<DeploymentEvent | null>(null),
      initDefaultCollapsed:   () => {},
      toggleLaneCollapsed:    () => {},
      collapseAllLanes:       () => {},
      expandAllLanes:         () => {},
      visibleServices:            (svcs: string[]) => svcs,
      visibleServiceIdentities:   (ids: Array<{ service: string; namespace: string | null | undefined }>) => ids,
    };

    await TestBed.configureTestingModule({
      imports:   [SwimlanesComponent],
      providers: [{ provide: AppStateService, useValue: mockSvcRef }],
      schemas:   [NO_ERRORS_SCHEMA],
    })
    .overrideComponent(SwimlanesComponent, { set: { template: '' } })
    .compileComponents();

    fixture   = TestBed.createComponent(SwimlanesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('when no lane is collapsed lanesView returns the same node sets as lanes', () => {
    const devEv = mkEv('dev', { service: 'svc' });
    const qaEv  = mkEv('qa',  { service: 'svc', parents: [devEv.deployment_id] });
    matrixSignal.set(mkMatrix([{
      service: 'svc',
      slots: { dev: { current: devEv }, qa: { current: qaEv } },
    }]));

    const full = allNodeIds(getLanes(component));
    const view = allNodeIds(getLanesView(component));
    expect(view).toEqual(full);
  });

  it('when a lane is collapsed lanesView restricts to vectorIds (tip chain only)', () => {
    // Two disconnected chains: chain-A (root1→tip) and chain-B (root2 isolated)
    const root1 = mkEv('dev',  { service: 'svc', happened_at: new Date(Date.now() - 300_000).toISOString() });
    const tip   = mkEv('qa',   { service: 'svc', happened_at: new Date(Date.now() -  60_000).toISOString(), parents: [root1.deployment_id] });
    const root2 = mkEv('prod', { service: 'svc', happened_at: new Date(Date.now() - 200_000).toISOString() });

    matrixSignal.set(mkMatrix([{
      service: 'svc',
      slots: {
        dev:  { current: root1 },
        qa:   { current: tip   },
        prod: { current: root2 },
      },
    }]));

    (mockSvcRef as Partial<AppStateService> & { collapsedLanes: ReturnType<typeof signal<Set<string>>> })
      .collapsedLanes.set(new Set(['svc']));

    const viewIds = allNodeIds(getLanesView(component));
    // Only the tip chain (root1, tip) — root2 is excluded
    expect(viewIds).toContain(tip.id);
    expect(viewIds).toContain(root1.id);
    expect(viewIds).not.toContain(root2.id);
  });

  it('toggling collapse back to expanded restores full node set', () => {
    const devEv = mkEv('dev',  { service: 'svc', happened_at: new Date(Date.now() - 100_000).toISOString() });
    const qaEv  = mkEv('qa',   { service: 'svc', happened_at: new Date(Date.now() -  50_000).toISOString(), parents: [devEv.deployment_id] });
    const prod  = mkEv('prod', { service: 'svc', happened_at: new Date(Date.now() - 200_000).toISOString() });

    matrixSignal.set(mkMatrix([{
      service: 'svc',
      slots: { dev: { current: devEv }, qa: { current: qaEv }, prod: { current: prod } },
    }]));

    const mockSvc = (mockSvcRef as Partial<AppStateService> & { collapsedLanes: ReturnType<typeof signal<Set<string>>> });

    // Collapse
    mockSvc.collapsedLanes.set(new Set(['svc']));
    const collapsedIds = allNodeIds(getLanesView(component));

    // Expand
    mockSvc.collapsedLanes.set(new Set());
    const expandedIds = allNodeIds(getLanesView(component));

    expect(expandedIds.length).toBeGreaterThan(collapsedIds.length);
    expect(expandedIds).toContain(prod.id);
  });

  it('single-chain lane is pixel-identical collapsed vs expanded (same node set)', () => {
    // A pure linear chain — no branching
    const devEv = mkEv('dev', { happened_at: new Date(Date.now() - 120_000).toISOString() });
    const qaEv  = mkEv('qa',  { happened_at: new Date(Date.now() -  60_000).toISOString(), parents: [devEv.deployment_id] });

    matrixSignal.set(mkMatrix([{
      service: 'svc',
      slots: { dev: { current: devEv }, qa: { current: qaEv } },
    }]));

    const mockSvc = (mockSvcRef as Partial<AppStateService> & { collapsedLanes: ReturnType<typeof signal<Set<string>>> });

    const expandedIds = allNodeIds(getLanesView(component));

    mockSvc.collapsedLanes.set(new Set(['svc']));
    const collapsedIds = allNodeIds(getLanesView(component));

    expect(collapsedIds.sort()).toEqual(expandedIds.sort());
  });

  it('regression: 3-node linear chain (dev→staging→qa) collapsed equals expanded (#309)', () => {
    // The 2-node single-chain test above only exercises one parent-resolution step.
    // This test exercises TWO steps (qa→staging, staging→dev) to catch the bug
    // where buildCollapsedVector stopped one short at the root on a ≥3 node chain.
    const devEv     = mkEv('dev',     { happened_at: new Date(Date.now() - 300_000).toISOString() });
    const stagingEv = mkEv('staging', { happened_at: new Date(Date.now() - 180_000).toISOString(), parents: [devEv.deployment_id] });
    const qaEv      = mkEv('qa',      { happened_at: new Date(Date.now() -  60_000).toISOString(), parents: [stagingEv.deployment_id] });

    matrixSignal.set(mkMatrix([{
      service: 'svc',
      slots: {
        dev:     { current: devEv },
        staging: { current: stagingEv },
        qa:      { current: qaEv },
      },
    }]));

    const mockSvc = (mockSvcRef as Partial<AppStateService> & { collapsedLanes: ReturnType<typeof signal<Set<string>>> });

    // Expanded: all 3 nodes visible
    const expandedIds = allNodeIds(getLanesView(component)).sort();
    expect(expandedIds).toContain(devEv.id);
    expect(expandedIds).toContain(stagingEv.id);
    expect(expandedIds).toContain(qaEv.id);

    // Collapsed: single chain → vectorIds must equal all 3 nodes (no branches to prune)
    mockSvc.collapsedLanes.set(new Set(['svc']));
    const collapsedIds = allNodeIds(getLanesView(component)).sort();

    expect(collapsedIds).toEqual(expandedIds);
  });
});
