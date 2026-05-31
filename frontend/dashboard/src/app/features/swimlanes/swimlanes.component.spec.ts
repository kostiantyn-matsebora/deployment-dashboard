import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed }                 from '@angular/core/testing';

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

// ── Shared TestBed setup ─────────────────────────────────────────────────────

describe('SwimlanesComponent', () => {
  let component:     SwimlanesComponent;
  let matrixSignal:  ReturnType<typeof signal<Matrix | null>>;
  let predSignal:    ReturnType<typeof signal<CorrelationPredicate>>;
  let twSignal:      ReturnType<typeof signal<TimeWindow>>;

  beforeEach(async () => {
    _seq         = 0;
    matrixSignal = signal<Matrix | null>(null);
    predSignal   = signal<CorrelationPredicate>('explicit parent');
    twSignal     = signal<TimeWindow>('1 day');

    const mockSvc: Partial<AppStateService> = {
      matrixData:             matrixSignal,
      correlationPredicate:   predSignal,
      timeWindow:             twSignal,
      swimlaneVisibleFields:  signal<Set<SwimlaneField>>(new Set()),
      selectedNodeId:         { set: () => {} } as never,
      selectedEvent:          { set: () => {} } as never,
      sseConnected:           signal(false),
    };

    await TestBed.configureTestingModule({
      imports:   [SwimlanesComponent],
      providers: [{ provide: AppStateService, useValue: mockSvc }],
      // Skip rendering of NgxGraph / VisCard / InspectorPanel — logic-only test.
      schemas:   [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(SwimlanesComponent);
    component     = fixture.componentInstance;
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

  // ── Edge building: explicit parent predicate ─────────────────────────────

  describe('buildEdges — explicit parent', () => {
    it('draws an edge from parent to child via parent_deployments', () => {
      const devEv = mkEv('dev');
      const qaEv  = mkEv('qa', { parents: [devEv.deployment_id] });
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: { dev: { current: devEv }, qa: { current: qaEv } },
      }]));

      const links = getLanes(component).flatMap(l => l.dags.flatMap(d => d.links));
      expect(links).toHaveLength(1);
      expect(links[0].source).toBe(devEv.id);
      expect(links[0].target).toBe(qaEv.id);
    });

    it('ignores parent_deployments that reference events not in the node pool', () => {
      const qaEv = mkEv('qa', { parents: ['dep-not-in-matrix'] });
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: { qa: { current: qaEv } },
      }]));

      const links = getLanes(component).flatMap(l => l.dags.flatMap(d => d.links));
      expect(links).toHaveLength(0);
    });

    it('supports fan-out: one node with two downstream children', () => {
      const devEv     = mkEv('dev');
      const stagingEv = mkEv('staging', { parents: [devEv.deployment_id] });
      const qaEv      = mkEv('qa',      { parents: [devEv.deployment_id] });
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: {
          dev:     { current: devEv },
          staging: { current: stagingEv },
          qa:      { current: qaEv },
        },
      }]));

      const links = getLanes(component).flatMap(l => l.dags.flatMap(d => d.links));
      expect(links).toHaveLength(2);
      expect(links.every(l => l.source === devEv.id)).toBe(true);
    });

    it('supports fan-in: one node with two parents (merge node)', () => {
      const stagingEv = mkEv('staging');
      const qaEv      = mkEv('qa');
      const preprodEv = mkEv('preprod', {
        parents: [stagingEv.deployment_id, qaEv.deployment_id],
      });
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: {
          staging: { current: stagingEv },
          qa:      { current: qaEv },
          preprod: { current: preprodEv },
        },
      }]));

      const links = getLanes(component).flatMap(l => l.dags.flatMap(d => d.links));
      expect(links).toHaveLength(2);
      expect(links.every(l => l.target === preprodEv.id)).toBe(true);
    });
  });

  // ── DAG partitioning ─────────────────────────────────────────────────────

  describe('partitionDags', () => {
    it('places connected events in the same DAG', () => {
      const devEv = mkEv('dev');
      const qaEv  = mkEv('qa', { parents: [devEv.deployment_id] });
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: { dev: { current: devEv }, qa: { current: qaEv } },
      }]));

      const lane = getLanes(component).find(l => l.service === 'svc')!;
      expect(lane.dags).toHaveLength(1);
    });

    it('splits disconnected events into separate DAGs', () => {
      const devEv  = mkEv('dev');
      const prodEv = mkEv('prod'); // no link to devEv
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: { dev: { current: devEv }, prod: { current: prodEv } },
      }]));

      const lane = getLanes(component).find(l => l.service === 'svc')!;
      expect(lane.dags).toHaveLength(2);
    });
  });

  // ── Regression: last_successful orphan nodes ─────────────────────────────

  describe('regression — last_successful orphan nodes (GitHub bug)', () => {
    it('does not produce orphan nodes when last_successful references history outside the matrix', () => {
      // Reproduces the prod/preprod double-node bug:
      //   slot.current  = run-A in-progress  (becomes the current node ✓)
      //   slot.last_successful = run-B success, parent=[dep-from-run-B-history]
      //     → dep-from-run-B-history is NOT in the matrix
      //     → before the fix: last_successful became an orphan disconnected node
      //     → after the fix: last_successful is excluded entirely
      const current  = mkEv('prod', { status: 'in-progress' });
      const lastSucc = mkEv('prod', {
        status: 'success',
        parents: ['dep-historical-outside-matrix'],
      });
      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: { prod: { current, last_successful: lastSucc } },
      }]));

      const lanes = getLanes(component);
      const ids   = allNodeIds(lanes);

      // Only the current node — no orphan.
      expect(ids).toEqual([current.id]);

      // Single DAG containing only the current node.
      const lane = lanes.find(l => l.service === 'svc')!;
      expect(lane.dags).toHaveLength(1);
      expect(lane.dags[0].nodes).toHaveLength(1);
      expect(lane.dags[0].links).toHaveLength(0);
    });

    it('same-service slots with last_successful each produce exactly one node', () => {
      // Multiple envs where each has a non-success current + last_successful
      const prodCurrent  = mkEv('prod',   { status: 'failure' });
      const prodLast     = mkEv('prod',   { status: 'success', parents: ['external-1'] });
      const preprodCurrent = mkEv('preprod', { status: 'failure' });
      const preprodLast    = mkEv('preprod', { status: 'success', parents: ['external-2'] });

      matrixSignal.set(mkMatrix([{
        service: 'svc',
        slots: {
          prod:   { current: prodCurrent,   last_successful: prodLast },
          preprod: { current: preprodCurrent, last_successful: preprodLast },
        },
      }]));

      const ids = allNodeIds(getLanes(component));
      expect(ids).toContain(prodCurrent.id);
      expect(ids).toContain(preprodCurrent.id);
      expect(ids).not.toContain(prodLast.id);
      expect(ids).not.toContain(preprodLast.id);
      expect(ids).toHaveLength(2);
    });
  });
});
