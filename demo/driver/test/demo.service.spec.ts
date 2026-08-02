/**
 * DemoService unit tests — focused on startIngest ordering and per-run correlation.
 *
 * Verifies that:
 *  1. startIngest generates a run_id and posts run-start + run-complete events.
 *  2. Two distinct startIngest calls produce two distinct run_ids.
 *  3. Ingest does NOT trigger a reset (no resetApi call).
 */

import { Subject } from 'rxjs';
import { DemoService, MAX_EMIT_DELAY_MS } from '../src/demo/demo.service';
import { ResetCoordinator } from '../src/control/reset-coordinator';
import { RecoverAckHandler } from '../src/control/recover-ack-handler';
import { EmitService } from '../src/demo/emit.service';

// ── Module-level mocks ────────────────────────────────────────────────────────

// Mock ControlApiClient so we control what resetApi() returns without network.
const mockResetApi = jest.fn();
jest.mock('../src/write-api/control-api.client', () => ({
  ControlApiClient: jest.fn().mockImplementation(() => ({
    resetApi: mockResetApi,
  })),
}));

// Mock ControlEventsClient (registered in onModuleInit — must be constructible).
// Track the last constructed instance so tests can inspect calls.
let mockEventsClientInstance: {
  postResetAck:      jest.Mock;
  postStatusRunning: jest.Mock;
  postRunStart:      jest.Mock;
  postRunComplete:   jest.Mock;
} | null = null;

jest.mock('../src/control/control-events.client', () => ({
  ControlEventsClient: jest.fn().mockImplementation(() => {
    mockEventsClientInstance = {
      postResetAck:      jest.fn().mockResolvedValue(undefined),
      postStatusRunning: jest.fn().mockResolvedValue(undefined),
      postRunStart:      jest.fn().mockResolvedValue(undefined),
      postRunComplete:   jest.fn().mockResolvedValue(undefined),
    };
    return mockEventsClientInstance;
  }),
}));

// Mock scenario-loader so no filesystem access is required.
jest.mock('../src/scenarios/scenario-loader', () => ({
  loadScenarios: jest.fn().mockReturnValue([
    {
      name:   'demo-set',
      events: [
        {
          deployment_id:  'gh-svc-dev-001',
          service:        'svc',
          environment:    'dev',
          status:         'success',
          elapsed_minutes: 5,
        },
      ],
    },
  ]),
}));

// Mock WriteApiClient so no network calls happen during runner.run().
jest.mock('../src/write-api/write-api.client', () => ({
  WriteApiClient: jest.fn().mockImplementation((_url: string, _key: string, reporter: string) => ({
    postDeployment:   jest.fn().mockResolvedValue({ ok: true, status: 201 }),
    progressReporter: reporter,
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCoordinator(): jest.Mocked<ResetCoordinator> {
  return {
    resetState:           'idle',
    resetId:              null,
    registerParticipant:  jest.fn(),
    registerEventsClient: jest.fn(),
    onResetInitiated:     jest.fn().mockResolvedValue(undefined),
    onResetStarted:       jest.fn(),
    onResetCompleted:     jest.fn().mockResolvedValue(undefined),
    expectCycle:          jest.fn(),
    awaitCycleComplete:   jest.fn().mockResolvedValue(undefined),
    onModuleDestroy:      jest.fn(),
  } as unknown as jest.Mocked<ResetCoordinator>;
}

function makeEmitService(): jest.Mocked<EmitService> {
  return {
    emitting:        false,
    stream$:         new Subject(),
    enable:          jest.fn(),
    disable:         jest.fn(),
    setEventsClient: jest.fn(),
    onModuleDestroy: jest.fn(),
  } as unknown as jest.Mocked<EmitService>;
}

function makeService(
  coordinator: jest.Mocked<ResetCoordinator>,
  emitService: jest.Mocked<EmitService>,
): DemoService {
  // RecoverAckHandler has no dependencies of its own — use a real instance
  // rather than a mock (registerEventsClient is a plain setter).
  const svc = new DemoService(emitService, coordinator, new RecoverAckHandler());
  svc.onModuleInit();
  return svc;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DemoService.startIngest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ingest never triggers a reset (#9)', () => {
    it('does not call resetApi, expectCycle, or awaitCycleComplete', async () => {
      const coord = makeCoordinator();
      const svc   = makeService(coord, makeEmitService());

      await svc.startIngest({ dataset: 'demo' });

      expect(mockResetApi).not.toHaveBeenCalled();
      expect(coord.expectCycle).not.toHaveBeenCalled();
      expect(coord.awaitCycleComplete).not.toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    it('returns current status without re-starting when already running', async () => {
      const coord = makeCoordinator();
      const svc   = makeService(coord, makeEmitService());

      // Force runner into running state.
      const runner = (svc as any).runner;
      (runner as any)._state = 'running';

      const status = await svc.startIngest({ dataset: 'demo' });

      expect(status.state).toBe('running');
    });
  });
});

describe('DemoService — emit delay clamping (CodeQL js/resource-exhaustion)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Replace runner.run/runWire with capturing spies so no events are posted. */
  function spyOnRunner(svc: DemoService): jest.Mock {
    const runner = (svc as unknown as { runner: { run: jest.Mock; runWire: jest.Mock } }).runner;
    const spy = jest.fn().mockResolvedValue(undefined);
    runner.run     = spy;
    runner.runWire = spy;
    return spy;
  }

  // The delay is the 4th positional arg to runner.run / runner.runWire.
  const delayArg = (spy: jest.Mock) => spy.mock.calls[0][3] as number;

  it('clamps an excessive delay_ms (startIngest) down to MAX_EMIT_DELAY_MS', async () => {
    const svc = makeService(makeCoordinator(), makeEmitService());
    const spy = spyOnRunner(svc);

    await svc.startIngest({ dataset: 'demo', delay_ms: 10_000_000 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(delayArg(spy)).toBe(MAX_EMIT_DELAY_MS);
  });

  it('clamps a negative delay_ms (startIngest) up to 0', async () => {
    const svc = makeService(makeCoordinator(), makeEmitService());
    const spy = spyOnRunner(svc);

    await svc.startIngest({ dataset: 'demo', delay_ms: -500 });

    expect(delayArg(spy)).toBe(0);
  });

  it('collapses a non-finite delay_ms (NaN) to 0', async () => {
    const svc = makeService(makeCoordinator(), makeEmitService());
    const spy = spyOnRunner(svc);

    await svc.startIngest({ dataset: 'demo', delay_ms: Number.NaN });

    expect(delayArg(spy)).toBe(0);
  });

  it('clamps an excessive delayMs on the legacy start() path', async () => {
    const svc = makeService(makeCoordinator(), makeEmitService());
    const spy = spyOnRunner(svc);

    await svc.start('demo-set', Number.MAX_SAFE_INTEGER);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(delayArg(spy)).toBe(MAX_EMIT_DELAY_MS);
  });

  it('passes a legitimate in-range delay through unchanged', async () => {
    const svc = makeService(makeCoordinator(), makeEmitService());
    const spy = spyOnRunner(svc);

    await svc.startIngest({ dataset: 'demo', delay_ms: 250 });

    expect(delayArg(spy)).toBe(250);
  });
});

describe('DemoService — per-run component-event correlation (§4.12)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventsClientInstance = null;
  });

  it('posts a run-start event before the runner completes', async () => {
    const svc = makeService(makeCoordinator(), makeEmitService());

    await svc.startIngest({ dataset: 'demo' });

    // Allow microtasks to drain so fire-and-forget postRunStart resolves.
    await new Promise(resolve => setImmediate(resolve));

    expect(mockEventsClientInstance!.postRunStart).toHaveBeenCalledTimes(1);
    const [runId, detail] = mockEventsClientInstance!.postRunStart.mock.calls[0];
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
    expect(detail).toContain('ingest');
  });

  it('posts a run-complete event after the runner finishes', async () => {
    const svc = makeService(makeCoordinator(), makeEmitService());

    await svc.startIngest({ dataset: 'demo' });

    // Allow the runner's async run to complete and trigger postRunComplete.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    expect(mockEventsClientInstance!.postRunComplete).toHaveBeenCalledTimes(1);
  });

  it('run-start and run-complete share the same run_id (carried in X-Correlation-Id)', async () => {
    const svc = makeService(makeCoordinator(), makeEmitService());

    await svc.startIngest({ dataset: 'demo' });

    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    const startRunId    = mockEventsClientInstance!.postRunStart.mock.calls[0][0];
    const completeRunId = mockEventsClientInstance!.postRunComplete.mock.calls[0][0];
    expect(startRunId).toBe(completeRunId);
  });

  it('two distinct startIngest calls produce two distinct run_ids', async () => {
    const svc = makeService(makeCoordinator(), makeEmitService());

    // First run: must reach done before second can start (idempotency guard).
    await svc.startIngest({ dataset: 'demo' });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    // Force runner back to idle so second startIngest is not rejected.
    const runner = (svc as any).runner;
    runner._state = 'idle';

    const runId1 = mockEventsClientInstance!.postRunStart.mock.calls[0][0];

    await svc.startIngest({ dataset: 'demo' });
    await new Promise(resolve => setImmediate(resolve));

    const runId2 = mockEventsClientInstance!.postRunStart.mock.calls[1][0];

    expect(runId1).not.toBe(runId2);
  });
});
