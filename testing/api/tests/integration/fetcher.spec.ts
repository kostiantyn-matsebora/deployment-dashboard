/**
 * Fetcher state — GET/PUT /api/fetcher/state/{adapter} (openapi.yaml §fetcher).
 * Opaque, latest-write-wins, X-Api-Key gated, 8 KiB cap.
 */
import { get, put, getJson, API_KEY } from './helpers';

describe('GET /api/fetcher/state/{adapter}', () => {
  it('401 without X-Api-Key', async () => {
    expect((await get('/api/fetcher/state/github-actions')).status).toBe(401);
  });

  it('401 with a wrong X-Api-Key', async () => {
    expect((await get('/api/fetcher/state/github-actions', { 'X-Api-Key': 'nope' })).status).toBe(401);
  });

  it('404 (problem+json) when no state stored for the adapter', async () => {
    const res = await get(`/api/fetcher/state/never-stored-${Date.now()}`, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.status).toBe(404);
    expect(typeof body.title).toBe('string');
  });
});

describe('PUT /api/fetcher/state/{adapter}', () => {
  it('401 without X-Api-Key', async () => {
    expect((await put('/api/fetcher/state/github-actions', { cursor: 'x' })).status).toBe(401);
  });

  it('204 on a valid cursor, then GET round-trips it', async () => {
    const adapter = `it-adapter-${Date.now()}`;
    const putRes = await put(`/api/fetcher/state/${adapter}`, { cursor: 'cursor-abc-123' }, { 'X-Api-Key': API_KEY });
    expect(putRes.status).toBe(204);

    const body = await getJson(`/api/fetcher/state/${adapter}`, { 'X-Api-Key': API_KEY });
    expect(body.adapter).toBe(adapter);
    expect(body.cursor).toBe('cursor-abc-123');
    expect(typeof body.updated_at).toBe('string');
  });

  it('latest write wins', async () => {
    const adapter = `it-lww-${Date.now()}`;
    await put(`/api/fetcher/state/${adapter}`, { cursor: 'first' }, { 'X-Api-Key': API_KEY });
    await put(`/api/fetcher/state/${adapter}`, { cursor: 'second' }, { 'X-Api-Key': API_KEY });
    const body = await getJson(`/api/fetcher/state/${adapter}`, { 'X-Api-Key': API_KEY });
    expect(body.cursor).toBe('second');
  });

  it('413 when the cursor exceeds 8 KiB', async () => {
    const res = await put('/api/fetcher/state/github-actions', { cursor: 'x'.repeat(8 * 1024 + 1) }, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(413);
  });
});
