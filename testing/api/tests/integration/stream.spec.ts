/**
 * Stream — GET /api/events/stream (openapi.yaml §stream).
 * Routed through the gateway's dedicated SSE block (no buffering).
 */
import { ingestEvent, readSseUntil, sleep } from './helpers';

describe('GET /api/events/stream', () => {
  it('pushes a `deployment` frame for a newly ingested event', async () => {
    const dep = `sse-${Date.now()}`;

    // Open the stream, then ingest once the subscription is attached.
    const framePromise = readSseUntil(
      '/api/events/stream',
      f => f.event === 'deployment' && !!f.data && f.data.includes(dep),
      { timeoutMs: 20_000 },
    );
    await sleep(750);
    const created = await ingestEvent({ deployment_id: dep });

    const frame = await framePromise;
    expect(frame.id).toBeTruthy();
    const data = JSON.parse(frame.data as string);
    expect(data.deployment_id).toBe(dep);
    expect(data.id).toBe(created.id);
  });

  it('replays events strictly after Last-Event-ID on reconnect', async () => {
    const a = await ingestEvent({ deployment_id: `sse-a-${Date.now()}` });
    const b = await ingestEvent({ deployment_id: `sse-b-${Date.now()}` });

    // Reconnect from a's id — b must be replayed without any new ingest.
    const frame = await readSseUntil(
      '/api/events/stream',
      f => f.event === 'deployment' && !!f.data && f.data.includes(b.deployment_id),
      { headers: { 'Last-Event-ID': a.id }, timeoutMs: 20_000 },
    );
    const data = JSON.parse(frame.data as string);
    expect(data.id).toBe(b.id);
  });
});
