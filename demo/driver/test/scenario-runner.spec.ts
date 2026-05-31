import { ScenarioRunner } from '../src/scenarios/scenario-runner';
import { WriteApiClient } from '../src/write-api/write-api.client';

const TEST_REPORTER = 'demo-driver/test';

function makeClient(okResult = true): jest.Mocked<Pick<WriteApiClient, 'postDeployment' | 'progressReporter'>> {
  return {
    postDeployment:   jest.fn().mockResolvedValue({ ok: okResult, status: okResult ? 201 : 422 }),
    progressReporter: TEST_REPORTER,
  };
}

const twoEvents = [
  {
    deployment_id: 'gh-svc-dev-1',
    service:       'svc',
    environment:   'dev',
    status:        'success'     as const,
    elapsed_minutes: 10,
  },
  {
    deployment_id: 'gh-svc-staging-1',
    service:       'svc',
    environment:   'staging',
    status:        'success'     as const,
    elapsed_minutes: 5,
  },
];

describe('ScenarioRunner', () => {
  let runner: ScenarioRunner;

  beforeEach(() => { runner = new ScenarioRunner(); });

  // ── happened_at conversion ────────────────────────────────────────────────

  it('computes happened_at as Date.now() − elapsed_minutes * 60_000', async () => {
    const client = makeClient();
    const before = Date.now();
    await runner.run('test', twoEvents, client as any, 0);
    const after  = Date.now();

    const wire = client.postDeployment.mock.calls[0][0];
    const happenedAt = new Date(wire.happened_at as string).getTime();
    const expected   = 10 * 60_000;

    expect(happenedAt).toBeGreaterThanOrEqual(before - expected - 200);
    expect(happenedAt).toBeLessThanOrEqual(after  - expected + 200);
  });

  it('strips elapsed_minutes from the wire payload', async () => {
    const client = makeClient();
    await runner.run('test', twoEvents, client as any, 0);
    expect(client.postDeployment.mock.calls[0][0]).not.toHaveProperty('elapsed_minutes');
    expect(client.postDeployment.mock.calls[1][0]).not.toHaveProperty('elapsed_minutes');
  });

  // ── POST order ───────────────────────────────────────────────────────────

  it('posts events in array order', async () => {
    const client = makeClient();
    await runner.run('test', twoEvents, client as any, 0);

    expect(client.postDeployment).toHaveBeenCalledTimes(2);
    expect(client.postDeployment.mock.calls[0][0].deployment_id).toBe('gh-svc-dev-1');
    expect(client.postDeployment.mock.calls[1][0].deployment_id).toBe('gh-svc-staging-1');
  });

  // ── Counter accuracy ──────────────────────────────────────────────────────

  it('increments events_sent for each 2xx response', async () => {
    const client = makeClient(true);
    await runner.run('test', twoEvents, client as any, 0);
    expect(runner.status.events_sent).toBe(2);
    expect(runner.status.errors).toBe(0);
  });

  it('increments errors for each non-2xx response', async () => {
    const client = makeClient(false);
    await runner.run('test', twoEvents, client as any, 0);
    expect(runner.status.events_sent).toBe(0);
    expect(runner.status.errors).toBe(2);
  });

  it('sets events_total at run start', () => {
    const client = makeClient();
    const p = runner.run('test', twoEvents, client as any, 0);
    expect(runner.status.events_total).toBe(2);
    return p;
  });

  // ── State transitions ─────────────────────────────────────────────────────

  it('transitions to done after all events attempted', async () => {
    const client = makeClient();
    await runner.run('test', twoEvents, client as any, 0);
    expect(runner.status.state).toBe('done');
    expect(runner.status.finished_at).not.toBeNull();
  });

  it('transitions to failed when stop() is called before next event', async () => {
    const client = makeClient();
    let calls = 0;
    client.postDeployment.mockImplementation(async (wire) => {
      calls++;
      if (calls === 1) runner.stop();          // signal stop after first post
      return { ok: true, status: 201 };
    });

    await runner.run('test', twoEvents, client as any, 0);

    // stop is checked at top of loop, so first event completes, second is skipped
    expect(runner.status.state).toBe('failed');
    expect(client.postDeployment).toHaveBeenCalledTimes(1);
    expect(runner.status.events_sent).toBe(1);
    expect(runner.status.finished_at).not.toBeNull();
  });

  // ── SSE stream frames ──────────────────────────────────────────────────────

  it('emits a posted frame for each successful POST', async () => {
    const frames: Array<{ type: string; data: Record<string, unknown> }> = [];
    runner.stream$.subscribe(f => frames.push(f as any));

    const client = makeClient(true);
    await runner.run('test', twoEvents, client as any, 0);

    expect(frames).toHaveLength(2);
    expect(frames[0].type).toBe('posted');
    expect(frames[0].data.reporter).toBe(TEST_REPORTER);
    expect(frames[1].type).toBe('posted');
    expect(frames[1].data.reporter).toBe(TEST_REPORTER);
  });

  it('emits an error frame for each failed POST', async () => {
    const frames: Array<{ type: string; data: Record<string, unknown> }> = [];
    runner.stream$.subscribe(f => frames.push(f as any));

    const client = makeClient(false);
    await runner.run('test', twoEvents, client as any, 0);

    expect(frames).toHaveLength(2);
    expect(frames[0].type).toBe('error');
    expect(frames[0].data.reporter).toBe(TEST_REPORTER);
    expect(frames[1].type).toBe('error');
    expect(frames[1].data.reporter).toBe(TEST_REPORTER);
  });

  // ── Reset ────────────────────────────────────────────────────────────────

  it('reset() returns state to idle with zeroed counters', async () => {
    const client = makeClient();
    await runner.run('test', twoEvents, client as any, 0);
    runner.reset();
    expect(runner.status).toEqual({
      scenario:     null,
      state:        'idle',
      events_total: 0,
      events_sent:  0,
      errors:       0,
      started_at:   null,
      finished_at:  null,
    });
  });
});
