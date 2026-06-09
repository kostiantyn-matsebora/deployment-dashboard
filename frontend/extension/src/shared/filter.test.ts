import { describe, it, expect } from 'vitest';
import { isWatched } from './filter';

describe('isWatched — exclude mode (default)', () => {
  const base = { filterMode: 'exclude' as const };

  it('watches everything when both lists are empty', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: [], environments: [] })).toBe(true);
  });

  it('excludes a service that appears in the services list', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: ['svc-a'], environments: [] })).toBe(false);
  });

  it('excludes an environment that appears in the environments list', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: [], environments: ['prod'] })).toBe(false);
  });

  it('watches when service is excluded but environment is not in list', () => {
    expect(isWatched('svc-b', 'staging', { ...base, services: ['svc-a'], environments: [] })).toBe(true);
  });

  it('excludes when both service AND environment are in their respective lists', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: ['svc-a'], environments: ['prod'] })).toBe(false);
  });

  it('watches service not in list even if other services are listed', () => {
    expect(isWatched('svc-b', 'prod', { ...base, services: ['svc-a'], environments: [] })).toBe(true);
  });

  it('excludes when only environment matches', () => {
    expect(isWatched('svc-b', 'prod', { ...base, services: [], environments: ['prod'] })).toBe(false);
  });
});

describe('isWatched — include mode', () => {
  const base = { filterMode: 'include' as const };

  it('watches nothing when both lists are empty', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: [], environments: [] })).toBe(false);
  });

  it('watches nothing when only services list is populated', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: ['svc-a'], environments: [] })).toBe(false);
  });

  it('watches nothing when only environments list is populated', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: [], environments: ['prod'] })).toBe(false);
  });

  it('watches when both service AND environment are in their respective lists', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: ['svc-a'], environments: ['prod'] })).toBe(true);
  });

  it('does not watch when service is included but environment is not', () => {
    expect(isWatched('svc-a', 'staging', { ...base, services: ['svc-a'], environments: ['prod'] })).toBe(false);
  });

  it('does not watch when environment is included but service is not', () => {
    expect(isWatched('svc-b', 'prod', { ...base, services: ['svc-a'], environments: ['prod'] })).toBe(false);
  });

  it('watches multiple services/environments when all listed', () => {
    expect(
      isWatched('svc-b', 'staging', { ...base, services: ['svc-a', 'svc-b'], environments: ['prod', 'staging'] }),
    ).toBe(true);
  });
});
