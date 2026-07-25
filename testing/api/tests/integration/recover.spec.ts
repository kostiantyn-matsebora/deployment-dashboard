/**
 * Black-box API integration + contract tests for the non-destructive recover choreography
 * (issue #423, `POST /api/control/recover`) — mirrors `reset-choreography.spec.ts` structurally.
 *
 * Spec references:
 *   docs/api/openapi.yaml — RecoverRequest / RecoverAccepted / ControlStreamEvent (contract,
 *     wins on any conflict). This file's job is to assert the WIRE response actually conforms:
 *     RecoverAccepted requires [correlation_id, state, since]; correlation_id is a uuid;
 *     state is the ResetState enum value "draining"; since is a date-time echoing the resolved
 *     rewind point; the 422 body is a Problem (`application/problem+json`) on the since XOR
 *     days_back violation.
 *   docs/API_SPECIFICATION.md §5 (endpoints), §8 (testing) — recover choreography.
 *
 * Stack under test: Dashboard.Api + PostgreSQL + demo-driver (no fetcher).
 *   RESET_ACK_TIMEOUT_SECONDS  = 3              (compose/docker-compose.test.yaml)
 *   RESET_EXPECTED_COMPONENTS  = api-test-reset (single synthetic component, CSV)
 *   RESET_GATE_MAX_TTL_SECONDS = 15
 *
 * Recover shares reset's single-flight row/advisory lock and ExpectedComponents (D12) — the
 * synthetic "api-test-reset" component drives completion here exactly as it does for reset.
 *
 * NOTE: Docker is not available in the development environment — this suite typechecks
 * cleanly (tsc --noEmit) and is discovered by jest --listTests, but executes only in CI
 * where the compose stack is running.
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

// ── Recover-specific helpers ────────────────────────────────────────────────────

/**
 * Post a recover-ack from the synthetic "api-test-reset" component id — the recover-saga
 * counterpart of reset's postTestAck (same ExpectedComponents, same X-Correlation-Id gate key).
 */
async function postTestRecoverAck(correlationId: string): Promise<void> {
  const res = await post(
    '/api/control/events',
    {
      event_type:  'recover-ack',
      state:       'paused',
      occurred_at: new Date().toISOString(),
    },
    { 'X-Api-Key': API_KEY, 'X-Component-Id': 'api-test-reset', 'X-Correlation-Id': correlationId },
  );
  if (res.status !== 204) {
    throw new Error(`recover-ack -> ${res.status}: ${await res.text()}`);
  }
}

interface RecoverAccepted {
  correlation_id: string;
  state: string;
  since: string;
  accepted_at: string;
}

/**
 * Drive a full recover cycle (days_back-based) to completion, returning the accepted body.
 * Mirrors resetAll()'s shape but for the non-destructive saga — does NOT clear any data.
 */
async function recoverAll(daysBack = 1): Promise<RecoverAccepted> {
  const completedPromise = readControlSseUntil(
    f => f.event === 'recover-completed',
    { timeoutMs: 20_000 },
  );

  const res = await post('/api/control/recover', { days_back: daysBack }, {
    'X-Control-API-Key': CONTROL_KEY,
  });
  if (res.status !== 202) {
    throw new Error(`control recover -> ${res.status}: ${await res.text()}`);
  }
  const body = await res.json() as RecoverAccepted;

  await postTestRecoverAck(body.correlation_id);
  await completedPromise;
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Recover choreography — POST /api/control/recover', () => {
  // Ensure idle state before the block runs (recover shares reset's single-flight slot).
  beforeAll(() => resetAll());

  describe('1. 202 response shape — RecoverAccepted contract conformance', () => {
    it('returns 202 with correlation_id (uuid), state:"draining", since, accepted_at', async () => {
      const completedPromise = readControlSseUntil(
        f => f.event === 'recover-completed',
        { timeoutMs: 20_000 },
      );

      const res = await post('/api/control/recover', { days_back: 2 }, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(res.status).toBe(202);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);

      const body = await res.json() as RecoverAccepted;
      // RecoverAccepted required: [correlation_id, state, since] (openapi.yaml).
      expect(body).toMatchObject({
        correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        state:          'draining',
        since:          expect.any(String),
        accepted_at:    expect.any(String),
      });
      // `since` and `accepted_at` must be valid ISO date-time strings (openapi format: date-time).
      expect(new Date(body.since).getTime()).not.toBeNaN();
      expect(new Date(body.accepted_at).getTime()).not.toBeNaN();

      await postTestRecoverAck(body.correlation_id);
      await completedPromise;
    });

    it('days_back resolves server-side to since = now - N days (within tolerance)', async () => {
      const before = Date.now();
      const completedPromise = readControlSseUntil(
        f => f.event === 'recover-completed',
        { timeoutMs: 20_000 },
      );

      const res = await post('/api/control/recover', { days_back: 3 }, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(res.status).toBe(202);
      const body = await res.json() as RecoverAccepted;

      const expectedSinceMs = before - 3 * 24 * 60 * 60 * 1000;
      const actualSinceMs   = new Date(body.since).getTime();
      // Allow generous 10 s tolerance for request latency + CI jitter.
      expect(Math.abs(actualSinceMs - expectedSinceMs)).toBeLessThan(10_000);

      await postTestRecoverAck(body.correlation_id);
      await completedPromise;
    });

    it('absolute since is echoed verbatim', async () => {
      const since = '2026-07-14T00:00:00.000Z';
      const completedPromise = readControlSseUntil(
        f => f.event === 'recover-completed',
        { timeoutMs: 20_000 },
      );

      const res = await post('/api/control/recover', { since }, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(res.status).toBe(202);
      const body = await res.json() as RecoverAccepted;
      expect(new Date(body.since).toISOString()).toBe(since);

      await postTestRecoverAck(body.correlation_id);
      await completedPromise;
    });
  });

  describe('2. SSE event sequence — recover-initiated → recover-started → recover-completed', () => {
    it('emits all three events in order, correlates correlation_id, carries since in payload', async () => {
      const collectorPromise = collectControlSseUntil(
        f => f.event === 'recover-completed',
        { timeoutMs: 25_000 },
      );

      await sleep(300); // Let the SSE connection attach before posting recover.

      const since = '2026-07-14T00:00:00.000Z';
      const res = await post('/api/control/recover', { since }, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(res.status).toBe(202);
      const { correlation_id: correlationId } = await res.json() as RecoverAccepted;

      await postTestRecoverAck(correlationId);

      const frames = await collectorPromise;
      const phaseFrames = frames.filter(
        f => f.event === 'recover-initiated' ||
             f.event === 'recover-started'   ||
             f.event === 'recover-completed',
      );

      const initiated = phaseFrames.find(f => {
        if (f.event !== 'recover-initiated') return false;
        try { return JSON.parse(f.data!).id === correlationId; } catch { return false; }
      });
      const started = phaseFrames.find(f => {
        if (f.event !== 'recover-started') return false;
        try { return JSON.parse(f.data!).correlation_id === correlationId; } catch { return false; }
      });
      const completed = phaseFrames.find(f => {
        if (f.event !== 'recover-completed') return false;
        try { return JSON.parse(f.data!).correlation_id === correlationId; } catch { return false; }
      });

      expect(initiated).toBeDefined();
      expect(started).toBeDefined();
      expect(completed).toBeDefined();

      const initiatedData = JSON.parse(initiated!.data!);
      const startedData   = JSON.parse(started!.data!);
      const completedData = JSON.parse(completed!.data!);

      expect(initiatedData.id).toBe(correlationId);
      expect(initiatedData.correlation_id).toBe(correlationId);
      expect(initiatedData.component).toBe('*');
      expect(initiatedData.type).toBe('recover-initiated');

      expect(startedData.correlation_id).toBe(correlationId);
      expect(startedData.component).toBe('*');
      expect(startedData.type).toBe('recover-started');

      expect(completedData.correlation_id).toBe(correlationId);
      expect(completedData.component).toBe('*');
      expect(completedData.type).toBe('recover-completed');

      // The resolved `since` must be carried in `payload` on recover-completed
      // (openapi.yaml ControlStreamEvent.payload: `{"since":"…"}` on recover-* frames).
      expect(completedData.payload).toBeDefined();
      expect(new Date(completedData.payload.since).toISOString()).toBe(since);

      // Every frame id is a uuid (SSE cursor).
      expect(initiated!.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(started!.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(completed!.id).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });

  describe('3. 409 mutual exclusion — recover vs recover, AND recover vs reset', () => {
    it('a second POST /api/control/recover while the first is in flight returns 409', async () => {
      const completedPromise = readControlSseUntil(
        f => f.event === 'recover-completed',
        { timeoutMs: 20_000 },
      );
      await sleep(300);

      const first = await post('/api/control/recover', { days_back: 1 }, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(first.status).toBe(202);
      const { correlation_id: correlationId } = await first.json() as RecoverAccepted;

      const second = await post('/api/control/recover', { days_back: 1 }, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(second.status).toBe(409);
      expect(second.headers.get('content-type')).toMatch(/application\/problem\+json/);

      await postTestRecoverAck(correlationId);
      await completedPromise;
    });

    it('POST /api/control/reset while a recover is in flight returns 409', async () => {
      const completedPromise = readControlSseUntil(
        f => f.event === 'recover-completed',
        { timeoutMs: 20_000 },
      );
      await sleep(300);

      const recoverRes = await post('/api/control/recover', { days_back: 1 }, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(recoverRes.status).toBe(202);
      const { correlation_id: correlationId } = await recoverRes.json() as RecoverAccepted;

      const resetRes = await post('/api/control/reset', undefined, {
        'X-Control-API-Key': CONTROL_KEY,
      });
      expect(resetRes.status).toBe(409);

      await postTestRecoverAck(correlationId);
      await completedPromise;
    });
  });

  describe('4. 422 — since XOR days_back validation', () => {
    it('both since and days_back supplied -> 422 problem+json', async () => {
      const res = await post('/api/control/recover',
        { since: new Date().toISOString(), days_back: 1 },
        { 'X-Control-API-Key': CONTROL_KEY });
      expect(res.status).toBe(422);
      expect(res.headers.get('content-type')).toMatch(/application\/problem\+json/);
    });

    it('neither since nor days_back supplied -> 422', async () => {
      const res = await post('/api/control/recover', {}, { 'X-Control-API-Key': CONTROL_KEY });
      expect(res.status).toBe(422);
    });

    it('days_back = 0 -> 422 (must be >= 1)', async () => {
      const res = await post('/api/control/recover', { days_back: 0 }, { 'X-Control-API-Key': CONTROL_KEY });
      expect(res.status).toBe(422);
    });

    it('unknown field -> 422 (D5: unmapped write fields rejected)', async () => {
      const res = await post('/api/control/recover',
        { days_back: 1, bogus_field: 'x' },
        { 'X-Control-API-Key': CONTROL_KEY });
      expect(res.status).toBe(422);
    });
  });

  describe('5. Auth — X-Control-API-Key required (least privilege)', () => {
    it('401 without a control key', async () => {
      expect((await post('/api/control/recover', { days_back: 1 })).status).toBe(401);
    });

    it('401 when the write key is presented as the control key', async () => {
      const res = await post('/api/control/recover', { days_back: 1 }, { 'X-Control-API-Key': API_KEY });
      expect(res.status).toBe(401);
    });
  });

  describe('6. Non-destructive — data survives a full recover cycle', () => {
    it('deployments ingested before recover are still present after recover-completed', async () => {
      const before = await ingestEvent({ service: 'recover-test-svc', environment: 'recover-env' });
      expect(before.id).toBeTruthy();

      await recoverAll(1);

      // Unlike reset (which clears deployment_events + fetcher_state, D14), recover clears
      // NOTHING — the ingested event must still be retrievable.
      const deploymentsAfter = await getJson('/api/deployments?service=recover-test-svc');
      expect(deploymentsAfter.items.length).toBeGreaterThanOrEqual(1);

      // Clean up via a real reset so later specs in the suite start clean.
      await resetAll();
    });
  });
});
