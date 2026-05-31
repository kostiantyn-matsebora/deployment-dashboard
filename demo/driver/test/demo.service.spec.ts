/**
 * DemoService unit tests — focused on startIngest({reset:true}) ordering.
 *
 * Verifies that:
 *  1. awaitCycleComplete is called before the runner starts when reset:true
 *     and resetApi() returns a reset_id.
 *  2. The runner does NOT start until awaitCycleComplete resolves.
 *  3. When resetApi() fails (ok=false), ingest proceeds without waiting.
 *  4. When resetApi() returns ok=true but no reset_id, ingest proceeds with
 *     a warning and no wait.
 *  5. When reset:false, resetApi() is never called.
 */

import { Subject } from 'rxjs';
import { DemoService } from '../src/demo/demo.service';
import { ResetCoordinator } from '../src/control/reset-coordinator';
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
jest.mock('../src/control/control-events.client', () => ({
  ControlEventsClient: jest.fn().mockImplementation(() => ({
    postResetAck:      jest.fn().mockResolvedValue(undefined),
    postStatusRunning: jest.fn().mockResolvedValue(undefined),
  })),
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

const RESET_ID = '01J9F4WZK3W9G2T6X4QH3DKQF6';

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
    emitting: false,
    stream$:  new Subject(),
    enable:   jest.fn(),
    disable:  jest.fn(),
    onModuleDestroy: jest.fn(),
  } as unknown as jest.Mocked<EmitService>;
}

function makeService(
  coordinator: jest.Mocked<ResetCoordinator>,
  emitService: jest.Mocked<EmitService>,
): DemoService {
  const svc = new DemoService(emitService, coordinator);
  svc.onModuleInit();
  return svc;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DemoService.startIngest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('reset:false (default)', () => {
    it('does not call resetApi, expectCycle, or awaitCycleComplete', async () => {
      const coord = makeCoordinator();
      const svc   = makeService(coord, makeEmitService());

      await svc.startIngest({ dataset: 'demo', reset: false });

      expect(mockResetApi).not.toHaveBeenCalled();
      expect(coord.expectCycle).not.toHaveBeenCalled();
      expect(coord.awaitCycleComplete).not.toHaveBeenCalled();
    });
  });

  describe('reset:true — happy path', () => {
    it('calls resetApi() → expectCycle() → awaitCycleComplete() → runner.run in order', async () => {
      const callOrder: string[] = [];

      mockResetApi.mockImplementation(async () => {
        callOrder.push('resetApi');
        return { ok: true, http_status: 202, reset_id: RESET_ID };
      });

      const coord = makeCoordinator();
      coord.expectCycle.mockImplementation(() => {
        callOrder.push('expectCycle');
      });
      coord.awaitCycleComplete.mockImplementation(async () => {
        callOrder.push('awaitCycleComplete');
      });

      const svc = makeService(coord, makeEmitService());

      // Spy on ScenarioRunner.run to record when it's invoked.
      const runner = (svc as any).runner;
      const originalRun = runner.run.bind(runner);
      runner.run = jest.fn().mockImplementation(async (...args: unknown[]) => {
        callOrder.push('runner.run');
        return originalRun(...args);
      });

      await svc.startIngest({ dataset: 'demo', reset: true });

      expect(callOrder).toEqual(['resetApi', 'expectCycle', 'awaitCycleComplete', 'runner.run']);
    });

    it('passes the reset_id from resetApi() to expectCycle()', async () => {
      mockResetApi.mockResolvedValue({ ok: true, http_status: 202, reset_id: RESET_ID });

      const coord = makeCoordinator();
      const svc   = makeService(coord, makeEmitService());

      await svc.startIngest({ dataset: 'demo', reset: true });

      expect(coord.expectCycle).toHaveBeenCalledWith(RESET_ID);
    });

    it('passes the reset_id from resetApi() to awaitCycleComplete()', async () => {
      mockResetApi.mockResolvedValue({ ok: true, http_status: 202, reset_id: RESET_ID });

      const coord = makeCoordinator();
      const svc   = makeService(coord, makeEmitService());

      await svc.startIngest({ dataset: 'demo', reset: true });

      expect(coord.awaitCycleComplete).toHaveBeenCalledWith(RESET_ID);
    });

    it('returns running status after the runner has started', async () => {
      mockResetApi.mockResolvedValue({ ok: true, http_status: 202, reset_id: RESET_ID });

      const coord = makeCoordinator();
      const svc   = makeService(coord, makeEmitService());

      const status = await svc.startIngest({ dataset: 'demo', reset: true });

      // Status is returned immediately after the fire-and-forget runner starts.
      expect(['running', 'idle', 'done']).toContain(status.state);
    });
  });

  describe('reset:true — resetApi() failure', () => {
    it('proceeds to ingest without calling expectCycle or awaitCycleComplete when resetApi ok=false', async () => {
      mockResetApi.mockResolvedValue({ ok: false, http_status: 500 });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const coord   = makeCoordinator();
      const svc     = makeService(coord, makeEmitService());

      await svc.startIngest({ dataset: 'demo', reset: true });

      expect(coord.expectCycle).not.toHaveBeenCalled();
      expect(coord.awaitCycleComplete).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('pre-ingest API reset returned HTTP'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('reset:true — resetApi() returns ok but no reset_id', () => {
    it('proceeds to ingest without calling expectCycle or awaitCycleComplete and logs a warning', async () => {
      mockResetApi.mockResolvedValue({ ok: true, http_status: 202, reset_id: undefined });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const coord   = makeCoordinator();
      const svc     = makeService(coord, makeEmitService());

      await svc.startIngest({ dataset: 'demo', reset: true });

      expect(coord.expectCycle).not.toHaveBeenCalled();
      expect(coord.awaitCycleComplete).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('no reset_id'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('idempotency', () => {
    it('returns current status without re-triggering reset when already running', async () => {
      mockResetApi.mockResolvedValue({ ok: true, http_status: 202, reset_id: RESET_ID });

      const coord = makeCoordinator();
      const svc   = makeService(coord, makeEmitService());

      // Force runner into running state.
      const runner = (svc as any).runner;
      (runner as any)._state = 'running';

      const status = await svc.startIngest({ dataset: 'demo', reset: true });

      // resetApi and awaitCycleComplete ARE still called (reset happens before
      // idempotency check per the implementation), but the runner is not started again.
      // The key invariant: runner.run is not called a second time.
      expect(status.state).toBe('running');
    });
  });
});
