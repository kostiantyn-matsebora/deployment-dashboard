/**
 * Read surface — GET /api/deployments (list + cursor) and GET /api/deployments/{id}.
 * Uses direct writes for deterministic filter/pagination assertions.
 */
import { get, getJson, ingestEvent, resetAll } from './helpers';

describe('GET /api/deployments', () => {
  it('returns 200 with an items[] array', async () => {
    const body = await getJson('/api/deployments');
    expect(Array.isArray(body.items)).toBe(true);
    // next_cursor is nullable and may be omitted on the final page.
    if ('next_cursor' in body && body.next_cursor !== null) {
      expect(typeof body.next_cursor).toBe('string');
    }
  });

  it('a posted event appears with the DeploymentEvent shape', async () => {
    const created = await ingestEvent();
    const body = await getJson(`/api/deployments?deployment_id=${created.deployment_id}`);
    expect(body.items.length).toBe(1);
    const item = body.items[0];
    expect(typeof item.id).toBe('string');
    expect(typeof item.happened_at).toBe('string');
    expect(['in-progress', 'success', 'failure']).toContain(item.status);
  });

  describe('filters', () => {
    it('service filter returns only matching rows', async () => {
      const svc = `svc-${Date.now()}`;
      await ingestEvent({ service: svc });
      const body = await getJson(`/api/deployments?service=${svc}`);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items.every((e: any) => e.service === svc)).toBe(true);
    });

    it('environment filter returns only matching rows', async () => {
      const env = `env-${Date.now()}`;
      await ingestEvent({ environment: env });
      const body = await getJson(`/api/deployments?environment=${env}`);
      expect(body.items.every((e: any) => e.environment === env)).toBe(true);
    });

    it('status filter scoped to one deployment_id', async () => {
      const dep = `st-${Date.now()}`;
      await ingestEvent({ deployment_id: dep, status: 'success' });
      await ingestEvent({ deployment_id: dep, status: 'failure' });
      const body = await getJson(`/api/deployments?deployment_id=${dep}&status=success`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].status).toBe('success');
    });

    it('deployment_id filter returns every row sharing the key', async () => {
      const dep = `dep-${Date.now()}`;
      await ingestEvent({ deployment_id: dep, status: 'in-progress' });
      await ingestEvent({ deployment_id: dep, status: 'success' });
      const body = await getJson(`/api/deployments?deployment_id=${dep}`);
      expect(body.items.length).toBe(2);
      expect(body.items.every((e: any) => e.deployment_id === dep)).toBe(true);
    });

    it('since excludes events older than the threshold', async () => {
      const dep = `since-${Date.now()}`;
      await ingestEvent({ deployment_id: dep, happened_at: '2020-01-01T00:00:00.000Z' });
      const body = await getJson(
        `/api/deployments?deployment_id=${dep}&since=${encodeURIComponent('2030-01-01T00:00:00.000Z')}`);
      expect(body.items.length).toBe(0);
    });

    it('until excludes events at or after the threshold', async () => {
      const dep = `until-${Date.now()}`;
      await ingestEvent({ deployment_id: dep, happened_at: '2030-01-01T00:00:00.000Z' });
      const body = await getJson(
        `/api/deployments?deployment_id=${dep}&until=${encodeURIComponent('2000-01-01T00:00:00.000Z')}`);
      expect(body.items.length).toBe(0);
    });
  });

  describe('pagination', () => {
    it('limit caps the page size', async () => {
      await ingestEvent();
      await ingestEvent();
      const body = await getJson('/api/deployments?limit=1');
      expect(body.items.length).toBe(1);
    });

    it('cursor advances to a non-overlapping page', async () => {
      await resetAll();
      for (let i = 0; i < 4; i++) await ingestEvent();
      const page1 = await getJson('/api/deployments?limit=2');
      expect(page1.items.length).toBe(2);
      expect(page1.next_cursor).toBeTruthy();

      const page2 = await getJson(`/api/deployments?limit=2&cursor=${encodeURIComponent(page1.next_cursor)}`);
      const ids1 = new Set(page1.items.map((e: any) => e.id));
      expect(page2.items.every((e: any) => !ids1.has(e.id))).toBe(true);
    });

    it('newest-first ordering by happened_at', async () => {
      const dep = `ord-${Date.now()}`;
      await ingestEvent({ deployment_id: dep, happened_at: '2026-01-01T00:00:00.000Z' });
      await ingestEvent({ deployment_id: dep, happened_at: '2026-06-01T00:00:00.000Z' });
      const body = await getJson(`/api/deployments?deployment_id=${dep}`);
      expect(body.items[0].happened_at > body.items[1].happened_at).toBe(true);
    });
  });
});

describe('GET /api/deployments/{id}', () => {
  it('returns 200 and the matching row for a known id', async () => {
    const created = await ingestEvent();
    const body = await getJson(`/api/deployments/${created.id}`);
    expect(body.id).toBe(created.id);
  });

  it('returns 404 (problem+json) for an unknown id', async () => {
    const res = await get('/api/deployments/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.status).toBe(404);
    expect(typeof body.title).toBe('string');
  });
});
