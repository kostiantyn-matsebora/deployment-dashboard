/**
 * Discovery — GET /api/services, GET /api/environments (openapi.yaml §discovery).
 */
import { getJson, ingestEvent, resetAll } from './helpers';

describe('GET /api/services', () => {
  it('returns 200 with an items string array', async () => {
    const body = await getJson('/api/services');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('a newly posted service appears, distinct, sorted ascending', async () => {
    await resetAll();
    await ingestEvent({ service: 'zzz-service' });
    await ingestEvent({ service: 'aaa-service' });
    await ingestEvent({ service: 'aaa-service' });   // duplicate -> still one entry
    const { items } = await getJson('/api/services');
    expect(items).toEqual(['aaa-service', 'zzz-service']);
  });
});

describe('GET /api/environments', () => {
  it('returns 200 with an items string array', async () => {
    const { items } = await getJson('/api/environments');
    expect(Array.isArray(items)).toBe(true);
  });

  it('distinct environments from stored events appear exactly once', async () => {
    await resetAll();
    await ingestEvent({ environment: 'dev' });
    await ingestEvent({ environment: 'prod' });
    await ingestEvent({ environment: 'prod' });
    const { items } = await getJson('/api/environments');
    expect(items).toContain('dev');
    expect(items).toContain('prod');
    expect(items.filter((e: string) => e === 'prod').length).toBe(1);
  });
});
