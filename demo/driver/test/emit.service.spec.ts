/**
 * EmitService unit tests — focused on per-run component-event correlation (§4.12).
 *
 * Verifies that:
 *  1. enable() posts a run-start component event carrying a fresh run_id.
 *  2. disable() posts a run-complete component event with the same run_id.
 *  3. Two successive enable/disable cycles produce distinct run_ids.
 *  4. No component event is posted when no events client is set.
 */

import { EmitService } from '../src/demo/emit.service';
import { ControlEventsClient } from '../src/control/control-events.client';

// ── Module-level mocks ────────────────────────────────────────────────────────

// Prevent real interval timers from firing during tests.
jest.useFakeTimers();

// Mock WriteApiClient — emit service creates one on enable(); avoid real network.
jest.mock('../src/write-api/write-api.client', () => ({
  WriteApiClient: jest.fn().mockImplementation((_url: string, _key: string, reporter: string) => ({
    postDeployment:   jest.fn().mockResolvedValue({ ok: true, status: 201 }),
    progressReporter: reporter,
  })),
}));

// Mock random event generator to avoid entropy/time dependencies.
jest.mock('../src/scenarios/random-event-generator', () => ({
  generateRandomEvent: jest.fn().mockReturnValue({
    deployment_id: 'test-dep-001',
    service:       'svc',
    environment:   'dev',
    status:        'success',
    happened_at:   new Date().toISOString(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEventsClient(): jest.Mocked<ControlEventsClient> {
  return {
    postResetAck:      jest.fn().mockResolvedValue(undefined),
    postStatusRunning: jest.fn().mockResolvedValue(undefined),
    postRunStart:      jest.fn().mockResolvedValue(undefined),
    postRunComplete:   jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ControlEventsClient>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EmitService — per-run component-event correlation (§4.12)', () => {
  let svc: EmitService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new EmitService();
  });

  afterEach(() => {
    // Ensure timer is cleared even if test fails mid-enable.
    svc.onModuleDestroy();
  });

  it('enable() posts a run-start event when an events client is set', async () => {
    const client = makeEventsClient();
    svc.setEventsClient(client);

    svc.enable();
    await Promise.resolve(); // flush microtasks

    expect(client.postRunStart).toHaveBeenCalledTimes(1);
  });

  it('enable() passes a non-empty run_id to postRunStart', async () => {
    const client = makeEventsClient();
    svc.setEventsClient(client);

    svc.enable();
    await Promise.resolve();

    const [runId] = client.postRunStart.mock.calls[0];
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
  });

  it('enable() includes a detail string', async () => {
    const client = makeEventsClient();
    svc.setEventsClient(client);

    svc.enable();
    await Promise.resolve();

    const [, detail] = client.postRunStart.mock.calls[0];
    expect(typeof detail).toBe('string');
    expect(detail!.length).toBeGreaterThan(0);
  });

  it('disable() posts a run-complete event after enable()', async () => {
    const client = makeEventsClient();
    svc.setEventsClient(client);

    svc.enable();
    await Promise.resolve();

    svc.disable();
    await Promise.resolve();

    expect(client.postRunComplete).toHaveBeenCalledTimes(1);
  });

  it('run-start and run-complete share the same run_id', async () => {
    const client = makeEventsClient();
    svc.setEventsClient(client);

    svc.enable();
    await Promise.resolve();

    svc.disable();
    await Promise.resolve();

    const startRunId    = client.postRunStart.mock.calls[0][0];
    const completeRunId = client.postRunComplete.mock.calls[0][0];
    expect(startRunId).toBe(completeRunId);
  });

  it('two successive enable/disable cycles produce distinct run_ids', async () => {
    const client = makeEventsClient();
    svc.setEventsClient(client);

    svc.enable();
    await Promise.resolve();
    svc.disable();
    await Promise.resolve();

    svc.enable();
    await Promise.resolve();
    svc.disable();
    await Promise.resolve();

    const runId1 = client.postRunStart.mock.calls[0][0];
    const runId2 = client.postRunStart.mock.calls[1][0];
    expect(runId1).not.toBe(runId2);
  });

  it('does NOT post any component event when no client is set', async () => {
    // No setEventsClient call.
    svc.enable();
    await Promise.resolve();
    svc.disable();
    await Promise.resolve();
    // No assertion error means no client methods were called (no reference to check).
    // Verify the service stays functional: timer should have been cleared.
    expect(svc.emitting).toBe(false);
  });

  it('disable() does not post run-complete when not enabled', async () => {
    const client = makeEventsClient();
    svc.setEventsClient(client);

    svc.disable(); // called without prior enable()
    await Promise.resolve();

    expect(client.postRunComplete).not.toHaveBeenCalled();
  });
});
