// Unit tests for the services / environments discovery-endpoint envelope parsing.
// The API returns { items: string[] } — NOT a bare array.
// These tests mirror the real openapi examples and guard against regression.
//
// The shared unwrapItems helper lives in shared/deployments.ts and is used by
// both options.ts (loadFilterLists) and popup.ts.

import { describe, it, expect } from 'vitest';
import { unwrapItems } from '../shared/deployments';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('services/environments response envelope unwrapping', () => {
  it('unwraps { items: [...] } to a string array', () => {
    const body = { items: ['service-a', 'service-b', 'checkout-api'] };
    expect(unwrapItems(body)).toEqual(['service-a', 'service-b', 'checkout-api']);
  });

  it('matches the openapi /api/services example', () => {
    // openapi example: { items: ["service-a", "service-b", "checkout-api"] }
    const body = { items: ['service-a', 'service-b', 'checkout-api'] };
    const result = unwrapItems(body);
    expect(result).toHaveLength(3);
    expect(result).toContain('service-a');
    expect(result).toContain('checkout-api');
  });

  it('matches the openapi /api/environments example', () => {
    // openapi example: { items: ["dev", "qa", "uat", "prod"] }
    const body = { items: ['dev', 'qa', 'uat', 'prod'] };
    const result = unwrapItems(body);
    expect(result).toHaveLength(4);
    expect(result[3]).toBe('prod');
  });

  it('returns [] defensively when items key is absent', () => {
    expect(unwrapItems({})).toEqual([]);
  });

  it('returns [] when body is an unexpected non-object (falsy path guarded by svcRes.ok)', () => {
    // In production loadFilterLists, the .ok guard prevents calling unwrap on error bodies.
    expect(unwrapItems({ noItemsHere: true })).toEqual([]);
  });

  it('bare array (old broken shape) does NOT work — confirms the bug was real', () => {
    // A bare array has no .items property; unwrapItems returns [].
    const oldBrokenShape = ['service-a', 'service-b'];
    expect(unwrapItems(oldBrokenShape)).toEqual([]);
  });

  it('empty items array is returned as-is', () => {
    expect(unwrapItems({ items: [] as string[] })).toEqual([]);
  });

  it('returns [] for null body', () => {
    expect(unwrapItems(null)).toEqual([]);
  });
});
