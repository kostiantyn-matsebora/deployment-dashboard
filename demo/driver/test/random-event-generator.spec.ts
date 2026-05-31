import { generateRandomEvent, generateRandomEvents } from '../src/scenarios/random-event-generator';

describe('generateRandomEvent', () => {
  it('returns an object with all required DeploymentEventIngest fields', () => {
    const ev = generateRandomEvent();
    expect(ev).toMatchObject({
      deployment_id: expect.any(String),
      service:       expect.any(String),
      environment:   expect.any(String),
      status:        expect.any(String),
      happened_at:   expect.any(String),
    });
  });

  it('status is a valid enum value', () => {
    const valid = ['in-progress', 'success', 'failure'];
    for (let i = 0; i < 30; i++) {
      expect(valid).toContain(generateRandomEvent().status);
    }
  });

  it('happened_at is a valid ISO 8601 date in the past (within 2 h)', () => {
    const before = Date.now();
    const { happened_at } = generateRandomEvent();
    const ts = new Date(happened_at as string).getTime();
    expect(ts).toBeLessThanOrEqual(before);
    expect(ts).toBeGreaterThan(before - 2 * 60 * 60 * 1_000);
  });

  it('deployment_id is unique across consecutive calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateRandomEvent().deployment_id));
    expect(ids.size).toBe(50);
  });

  it('does not include elapsed_minutes in the payload', () => {
    const ev = generateRandomEvent();
    expect(ev).not.toHaveProperty('elapsed_minutes');
  });
});

describe('generateRandomEvents', () => {
  it('returns exactly count items', () => {
    expect(generateRandomEvents(5)).toHaveLength(5);
    expect(generateRandomEvents(1)).toHaveLength(1);
    expect(generateRandomEvents(0)).toHaveLength(0);
  });

  it('every item has all required fields', () => {
    for (const ev of generateRandomEvents(10)) {
      expect(ev.deployment_id).toBeTruthy();
      expect(ev.service).toBeTruthy();
      expect(ev.environment).toBeTruthy();
      expect(ev.status).toBeTruthy();
      expect(ev.happened_at).toBeTruthy();
    }
  });
});
