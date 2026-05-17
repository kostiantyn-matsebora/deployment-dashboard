// FR-02 / FR-12 — attribute vocabulary + per-view caps.
//
// Locks the SAD §7 "Layout views (FR-12)" table:
//   Detailed cap 7, Compact cap 5, Glance cap 1, Focus cap 5
// and the canonical seven attribute keys:
//   status, version, run, ago, actor, ref, sha
//
// Per the SAD §7 "Null-render invariant for nullable attributes" + §7
// "Load-time hardening rules" the known-key set must accept all seven.

import {
  ATTRIBUTES,
  CAPS,
  DEFAULT_ATTRS,
  DEFAULT_LAYOUT,
  LAYOUTS,
  VALID_ATTR_KEYS,
  VALID_LAYOUT_IDS,
  isAttrKey,
  isLayoutId,
  type AttrKey
} from './view-config';

describe('view-config — FR-02 attribute vocabulary', () => {
  const expectedKeys: readonly AttrKey[] =
    ['status', 'version', 'run', 'ago', 'actor', 'ref', 'sha'];

  it('exposes exactly the seven canonical attribute keys', () => {
    expect(ATTRIBUTES.map(a => a.key)).toEqual(expectedKeys);
    expect(VALID_ATTR_KEYS).toEqual(expectedKeys);
  });

  it('isAttrKey accepts the new ref + sha keys', () => {
    expect(isAttrKey('ref')).toBeTrue();
    expect(isAttrKey('sha')).toBeTrue();
  });

  it('isAttrKey rejects unknown keys', () => {
    expect(isAttrKey('parents')).toBeFalse();
    expect(isAttrKey('')).toBeFalse();
    expect(isAttrKey(null)).toBeFalse();
  });

  it('every attribute carries a label + description for the picker', () => {
    for (const a of ATTRIBUTES) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
    }
  });

  it('the ref + sha descriptions document their nullability', () => {
    const ref = ATTRIBUTES.find(a => a.key === 'ref')!;
    const sha = ATTRIBUTES.find(a => a.key === 'sha')!;
    expect(ref.description.toLowerCase()).toContain('nullable');
    expect(sha.description.toLowerCase()).toContain('nullable');
  });
});

describe('view-config — FR-12 per-view caps', () => {
  it('matches the SAD §7 Layout views table (Detailed 7, Compact 5, Glance 1, Focus 5)', () => {
    expect(CAPS.detailed).toBe(7);
    expect(CAPS.compact).toBe(5);
    expect(CAPS.glance).toBe(1);
    expect(CAPS.focus).toBe(5);
  });

  it('per-view defaults stay within the cap', () => {
    for (const v of ['detailed', 'compact', 'glance', 'focus'] as const) {
      expect(DEFAULT_ATTRS[v].length).toBeLessThanOrEqual(CAPS[v]);
    }
  });

  it('per-view default attributes are subset of the known-key set', () => {
    for (const v of ['detailed', 'compact', 'glance', 'focus'] as const) {
      for (const k of DEFAULT_ATTRS[v]) {
        expect(VALID_ATTR_KEYS).toContain(k);
      }
    }
  });
});

describe('view-config — FR-13 layout axis (Matrix deferred to Phase 2.0)', () => {
  it('exposes exactly Swim-lane + Workflow-rows (Matrix dropped)', () => {
    expect(LAYOUTS.map(l => l.id)).toEqual(['swim-lane', 'workflow-rows']);
    expect(VALID_LAYOUT_IDS).toEqual(['swim-lane', 'workflow-rows']);
  });

  it('defaults to Swim-lane on first visit', () => {
    expect(DEFAULT_LAYOUT).toBe('swim-lane');
  });

  it('isLayoutId rejects the legacy "matrix" value so persisted values migrate', () => {
    expect(isLayoutId('matrix')).toBeFalse();
    expect(isLayoutId('swim-lane')).toBeTrue();
    expect(isLayoutId('workflow-rows')).toBeTrue();
    expect(isLayoutId('galaxy-graph')).toBeFalse();
  });
});
