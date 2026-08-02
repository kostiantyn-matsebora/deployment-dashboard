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

  // Free-text `q` search (issue #397). Every case scopes to a fresh
  // deployment_id + unique token so the shared, never-truncated store
  // cannot produce false positives/negatives from unrelated rows.
  describe('q search', () => {
    it('matches a substring in the service field', async () => {
      const token = `qsvc${Date.now()}`;
      const created = await ingestEvent({ service: `svc-${token}-x` });
      const body = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token}`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(created.id);
    });

    it('matches a substring in the namespace field', async () => {
      const token = `qns${Date.now()}`;
      const created = await ingestEvent({ namespace: `ns-${token}-x` });
      const body = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token}`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(created.id);
    });

    it('matches a substring in the environment field', async () => {
      const token = `qenv${Date.now()}`;
      const created = await ingestEvent({ environment: `env-${token}-x` });
      const body = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token}`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(created.id);
    });

    it('matches a substring in the version field', async () => {
      const token = `qver${Date.now()}`;
      const created = await ingestEvent({ version: `v-${token}-x` });
      const body = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token}`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(created.id);
    });

    it('matches the status field', async () => {
      const dep = `qstatus-${Date.now()}`;
      const failed = await ingestEvent({ deployment_id: dep, status: 'failure' });
      await ingestEvent({ deployment_id: dep, status: 'success' });
      const body = await getJson(`/api/deployments?deployment_id=${dep}&q=failure`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(failed.id);
    });

    it('matches a substring in the actor field', async () => {
      const token = `qactor${Date.now()}`;
      const created = await ingestEvent({ actor: `actor-${token}-x` });
      const body = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token}`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(created.id);
    });

    it('matches a substring in the ref field', async () => {
      const token = `qref${Date.now()}`;
      const created = await ingestEvent({ ref: `refs/heads/${token}-x` });
      const body = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token}`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(created.id);
    });

    it('matches a substring in the sha field', async () => {
      const token = `qsha${Date.now()}`;
      const created = await ingestEvent({ sha: `${token}deadbeef` });
      const body = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token}`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(created.id);
    });

    it('matches a substring in the run_number field', async () => {
      const token = `qrun${Date.now()}`;
      const created = await ingestEvent({ run_number: `${token}-42` });
      const body = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token}`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(created.id);
    });

    it('matches a substring in the deployment_id field', async () => {
      const token = `qdep${Date.now()}`;
      const created = await ingestEvent({ deployment_id: `dep-${token}-x` });
      const body = await getJson(`/api/deployments?q=${token}`);
      expect(body.items.some((e: any) => e.id === created.id)).toBe(true);
    });

    it('is case-insensitive', async () => {
      const token = `QCaseMix${Date.now()}`;
      const created = await ingestEvent({ service: `svc-${token}-x` });

      const lower = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token.toLowerCase()}`);
      expect(lower.items.length).toBe(1);
      expect(lower.items[0].id).toBe(created.id);

      const upper = await getJson(`/api/deployments?deployment_id=${created.deployment_id}&q=${token.toUpperCase()}`);
      expect(upper.items.length).toBe(1);
      expect(upper.items[0].id).toBe(created.id);
    });

    it('composes by AND with a structured filter (status)', async () => {
      const dep = `qand-${Date.now()}`;
      const token = `qandtok${Date.now()}`;
      const successEvt = await ingestEvent({ deployment_id: dep, status: 'success', version: `v-${token}` });
      await ingestEvent({ deployment_id: dep, status: 'failure', version: `v-${token}` });

      const body = await getJson(`/api/deployments?deployment_id=${dep}&status=success&q=${token}`);
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(successEvt.id);
    });

    it('empty q is a no-op (identical to omitting the param)', async () => {
      const dep = `qempty-${Date.now()}`;
      await ingestEvent({ deployment_id: dep });
      await ingestEvent({ deployment_id: dep });

      const withoutQ = await getJson(`/api/deployments?deployment_id=${dep}`);
      const withEmptyQ = await getJson(`/api/deployments?deployment_id=${dep}&q=`);
      expect(withEmptyQ.items.length).toBe(withoutQ.items.length);
      expect(withEmptyQ.items.map((e: any) => e.id).sort()).toEqual(withoutQ.items.map((e: any) => e.id).sort());
    });

    it('pagination stays consistent for a fixed q across cursor pages', async () => {
      const token = `qpage${Date.now()}`;
      const dep = `qpage-${Date.now()}`;
      for (let i = 0; i < 4; i++) {
        await ingestEvent({
          deployment_id: dep,
          version:       `v-${token}-${i}`,
          happened_at:   new Date(Date.now() - i * 1000).toISOString(),
        });
      }

      const page1 = await getJson(`/api/deployments?deployment_id=${dep}&q=${token}&limit=2`);
      expect(page1.items.length).toBe(2);
      expect(page1.next_cursor).toBeTruthy();

      const page2 = await getJson(
        `/api/deployments?deployment_id=${dep}&q=${token}&limit=2&cursor=${encodeURIComponent(page1.next_cursor)}`);
      expect(page2.items.length).toBe(2);

      const ids1 = new Set(page1.items.map((e: any) => e.id));
      expect(page2.items.every((e: any) => !ids1.has(e.id))).toBe(true);

      const allIds = new Set([...page1.items, ...page2.items].map((e: any) => e.id));
      expect(allIds.size).toBe(4);
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
