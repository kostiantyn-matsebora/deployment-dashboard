/**
 * Black-box API integration tests for the choreography-driven reset.
 *
 * Spec references:
 *   docs/diagrams/reset-choreography.md — flow + locked decisions
 *   docs/API_SPECIFICATION.md §5 (endpoints), §9 (RESET_* config), §10 phase 11
 *   docs/api/api-guidelines.md §11 (control-plane model)
 *
 * Stack under test: Dashboard.Api + PostgreSQL + demo-driver (no fetcher).
 *   RESET_ACK_TIMEOUT_SECONDS  = 3              (compose/docker-compose.test.yaml)
 *   RESET_EXPECTED_COMPONENTS  = api-test-reset (single synthetic component, CSV)
 *   RESET_GATE_MAX_TTL_SECONDS = 15
 *
 * The real demo-driver is in the compose stack but NOT in ExpectedComponents,
 * so its acks are ignored by the gate.  The test suite drives completion by
 * posting a reset-ack from the synthetic "api-test-reset" component id.
 *
 * Every test isolates its state with resetAll() (full async cycle) before
 * asserting to ensure a clean slate.
 *
 * NOTE: Docker is not available in the development environment — this suite
 * typechecks cleanly (tsc --noEmit) and is discovered by jest --listTests,
 * but executes only in CI where the compose stack is running.
 */

import {
  post,
  getJson,
  ingestEvent,
  resetAll,
  readControlSseUntil,
  collectControlSseUntil,
  sleep,
  API_KEY,
  CONTROL_KEY,
} from './helpers';

// ── Shared ack helper ─────────────────────────────────────────────────────────

/**
 * Post a reset-ack from the synthetic "api-test-reset" component id.
 * This unblocks the orchestrator's ack gate for the current test cycle.
 * The gate keys solely on the X-Correlation-Id header (payload.reset_id retired).
 */
async function postTestAck(correlationId: string): Promise<void> {
  const res = await post(
    '/api/control/events',
    {
      event_type:  'reset-ack',
      state:       'paused',
      occurred_at: new Date().toISOString(),
    },
    { 'X-Api-Key': API_KEY, 'X-Component-Id': 'api-test-reset', 'X-Correlation-Id': correlationId },
  );
  if (res.status !== 204) {
    throw new Error(`reset-ack -> ${res.status}: ${await res.text()}`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Reset choreography — POST /api/control/reset', () => {
  // Ensure idle state before the block runs.
  beforeAll(() => resetAll());

  describe('1. 202 response shape', () => {
    it('returns 202 with correlation_id (uuid), state:"draining", accepted_at', async () => {
      // Open the stream first to unblock ourselves from the draining phase.
      const completedPromise = readControlSseUntil(
        f => f.event === 'reset-completed',
        { timeoutMs: 20_000 },
      );

      const res = await post('/api/control/reset', undefined, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(res.status).toBe(202);

      const body = await res.json() as { correlation_id: string; state: string; accepted_at: string };
      expect(body).toMatchObject({
        correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        state:          'draining',
        accepted_at:    expect.any(String),
      });
      // accepted_at must be a valid ISO timestamp.
      expect(new Date(body.accepted_at).getTime()).not.toBeNaN();

      // Drive to completion so the next test starts clean.
      await postTestAck(body.correlation_id);
      await completedPromise;
    });
  });

  describe('2. SSE event sequence — reset-initiated → reset-started → reset-completed', () => {
    it('emits all three events in order and correlates correlation_id', async () => {
      // Collect from the zero UUID so we don't miss events emitted before our
      // connection is established (Last-Event-ID replay from control_stream_events).
      // We open the collector BEFORE posting the reset.
      const collectorPromise = collectControlSseUntil(
        f => f.event === 'reset-completed',
        { timeoutMs: 25_000 },
      );

      await sleep(300); // Let the SSE connection attach before posting reset.

      const res = await post('/api/control/reset', undefined, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(res.status).toBe(202);
      const { correlation_id: correlationId } = await res.json() as { correlation_id: string };

      // Send ack promptly so the cycle progresses without waiting the full 3 s.
      await postTestAck(correlationId);

      const frames = await collectorPromise;

      // Filter to only the three reset-phase events (ignore any residual pings
      // or frames from a prior cycle captured via the live channel).
      const phaseFrames = frames.filter(
        f => f.event === 'reset-initiated' ||
             f.event === 'reset-started'   ||
             f.event === 'reset-completed',
      );

      // Locate the specific frames for this cycle by correlation_id.
      // reset-initiated: its SSE id field equals correlation_id (id IS the correlation_id).
      const initiated = phaseFrames.find(f => {
        if (f.event !== 'reset-initiated') return false;
        try { return JSON.parse(f.data!).id === correlationId; } catch { return false; }
      });
      const started = phaseFrames.find(f => {
        if (f.event !== 'reset-started') return false;
        try { return JSON.parse(f.data!).correlation_id === correlationId; } catch { return false; }
      });
      const completed = phaseFrames.find(f => {
        if (f.event !== 'reset-completed') return false;
        try { return JSON.parse(f.data!).correlation_id === correlationId; } catch { return false; }
      });

      expect(initiated).toBeDefined();
      expect(started).toBeDefined();
      expect(completed).toBeDefined();

      // Event id correlations (D16 / §10 phase 11):
      //   reset-initiated.data.id === correlationId (the row id IS the correlation_id)
      //   reset-started.data.correlation_id === correlationId
      //   reset-completed.data.correlation_id === correlationId
      const initiatedData = JSON.parse(initiated!.data!);
      const startedData   = JSON.parse(started!.data!);
      const completedData = JSON.parse(completed!.data!);

      expect(initiatedData.id).toBe(correlationId);
      expect(initiatedData.correlation_id).toBe(correlationId);
      expect(initiatedData.component).toBe('*');
      expect(initiatedData.type).toBe('reset-initiated');

      expect(startedData.correlation_id).toBe(correlationId);
      expect(startedData.component).toBe('*');
      expect(startedData.type).toBe('reset-started');

      expect(completedData.correlation_id).toBe(correlationId);
      expect(completedData.component).toBe('*');
      expect(completedData.type).toBe('reset-completed');

      // Frame id (the SSE `id:` field = the control_stream_events row id) must
      // also be a uuid and be present on each frame.
      expect(initiated!.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(started!.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(completed!.id).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });

  describe('3. Ack-driven early completion', () => {
    it('reset-started fires promptly after ack (before AckTimeoutSeconds)', async () => {
      // AckTimeoutSeconds = 3 in the test stack.  We measure elapsed time and
      // assert it is well under 3 s (target: < 2 s) after ack, confirming the
      // gate closed on ack rather than waiting for the full timeout.
      const collectorPromise = collectControlSseUntil(
        f => f.event === 'reset-completed',
        { timeoutMs: 20_000 },
      );
      await sleep(300);

      const res = await post('/api/control/reset', undefined, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(res.status).toBe(202);
      const { correlation_id: correlationId } = await res.json() as { correlation_id: string };

      const ackSentAt = Date.now();
      await postTestAck(correlationId);

      const frames = await collectorPromise;

      // Find the reset-started frame for this cycle.
      const started = frames.find(f => {
        if (f.event !== 'reset-started') return false;
        try { return JSON.parse(f.data!).correlation_id === correlationId; } catch { return false; }
      });
      expect(started).toBeDefined();

      // The started frame's occurred_at must be within 2 s of ack (early completion).
      const startedData = JSON.parse(started!.data!);
      const occurredAt  = new Date(startedData.occurred_at).getTime();
      const elapsed     = occurredAt - ackSentAt;
      // Allow generous 2500 ms for network + CI jitter while staying under the 3 s timeout.
      expect(elapsed).toBeLessThan(2_500);
    });
  });

  describe('4. Timeout backstop', () => {
    it('reset-started and reset-completed arrive after ~AckTimeoutSeconds with no ack posted', async () => {
      // AckTimeoutSeconds = 3.  We post a reset and post NO ack.
      // The orchestrator must still proceed after the timeout.
      const startMs = Date.now();

      const collectorPromise = collectControlSseUntil(
        f => f.event === 'reset-completed',
        { timeoutMs: 20_000 },
      );
      await sleep(300);

      const res = await post('/api/control/reset', undefined, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(res.status).toBe(202);
      const { correlation_id: correlationId } = await res.json() as { correlation_id: string };

      // Deliberately do NOT post a reset-ack.

      const frames = await collectorPromise;

      const completed = frames.find(f => {
        if (f.event !== 'reset-completed') return false;
        try { return JSON.parse(f.data!).correlation_id === correlationId; } catch { return false; }
      });
      expect(completed).toBeDefined();

      // Total elapsed must be >= AckTimeoutSeconds (3 s) since no ack was sent.
      const elapsed = Date.now() - startMs;
      expect(elapsed).toBeGreaterThanOrEqual(2_800); // allow 200 ms jitter under 3 s
    });
  });

  describe('5. 409 when a reset is already in flight', () => {
    it('returns 409 on a concurrent POST /api/control/reset', async () => {
      // We post a first reset and immediately (before it completes) post a second.
      // The second must be rejected with 409.
      const completedPromise = readControlSseUntil(
        f => f.event === 'reset-completed',
        { timeoutMs: 20_000 },
      );
      await sleep(300);

      const first = await post('/api/control/reset', undefined, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(first.status).toBe(202);
      const { correlation_id: correlationId } = await first.json() as { correlation_id: string };

      // Second reset while the first is draining — must be 409.
      const second = await post('/api/control/reset', undefined, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(second.status).toBe(409);

      // Drive the first cycle to completion for test isolation.
      await postTestAck(correlationId);
      await completedPromise;
    });
  });

  describe('6. Data cleared after reset-completed', () => {
    it('ingest before reset is absent after completion, and ingest works again after', async () => {
      // Ingest a unique event.
      const before = await ingestEvent({ service: 'reset-test-svc', environment: 'reset-env' });
      expect(before.id).toBeTruthy();

      // Verify it is present.
      expect((await getJson('/api/deployments')).items.length).toBeGreaterThanOrEqual(1);

      // Run a complete reset cycle.
      await resetAll();

      // Data must be gone.
      const deploymentsAfter = await getJson('/api/deployments');
      expect(deploymentsAfter.items.length).toBe(0);

      const servicesAfter = await getJson('/api/services');
      expect(servicesAfter.items.length).toBe(0);

      // Ingest must work again (201) after reset-completed.
      const afterReset = await ingestEvent({ service: 'post-reset-svc', environment: 'prod' });
      expect(afterReset.id).toBeTruthy();

      // Clean up.
      await resetAll();
    });
  });

  describe('7. Ingest 503 during resetting (opportunistic)', () => {
    it('ingest succeeds again after reset-completed (post-reset ingest gate is open)', async () => {
      // The 503 ingest gate fires during the brief resetting phase (between
      // reset-started and reset-completed).  This window is too short to observe
      // deterministically from a black-box HTTP client in the general case.
      //
      // Deterministic 503 coverage lives in Dashboard.Api.Tests (WebApplicationFactory
      // integration tests with controlled state injection) — see API_SPECIFICATION.md §8.
      //
      // Here we assert only what is observable reliably: after reset-completed the
      // ingest endpoint returns 201 (gate is open).
      await resetAll();
      const res = await ingestEvent({ service: 'gate-check-svc', environment: 'staging' });
      expect(res.id).toBeTruthy();

      // Cleanup.
      await resetAll();
    });
  });
});
