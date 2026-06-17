/**
 * Unit tests for glob.util — globMatch, matchesAny, applyGlobFilter.
 */
import { describe, it, expect } from 'vitest';
import { globMatch, matchesAny, applyGlobFilter } from './glob.util';

describe('globMatch', () => {
  it('matches an exact string', () => {
    expect(globMatch('auth-svc', 'auth-svc')).toBe(true);
  });

  it('does not match a different string', () => {
    expect(globMatch('auth-svc', 'order-svc')).toBe(false);
  });

  it('* matches any substring', () => {
    expect(globMatch('*-api', 'payments-api')).toBe(true);
    expect(globMatch('*-api', 'order-api')).toBe(true);
    expect(globMatch('*-api', 'auth-svc')).toBe(false);
  });

  it('* matches empty substring', () => {
    expect(globMatch('*-api', '-api')).toBe(true);
  });

  it('* at start matches any prefix', () => {
    expect(globMatch('*api', 'payments-api')).toBe(true);
  });

  it('* at end matches any suffix', () => {
    expect(globMatch('pay*', 'payments-api')).toBe(true);
    expect(globMatch('pay*', 'order-api')).toBe(false);
  });

  it('? matches exactly one character', () => {
    expect(globMatch('auth?svc', 'auth-svc')).toBe(true);
    expect(globMatch('auth?svc', 'authsvc')).toBe(false);
    expect(globMatch('auth?svc', 'auth--svc')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(globMatch('Auth-Svc', 'auth-svc')).toBe(true);
    expect(globMatch('*-API', 'payments-api')).toBe(true);
  });

  it('escapes regex special chars in the pattern', () => {
    expect(globMatch('a.b', 'a.b')).toBe(true);
    expect(globMatch('a.b', 'axb')).toBe(false);  // dot is literal, not regex .
  });

  it('escapes + in pattern', () => {
    expect(globMatch('a+b', 'a+b')).toBe(true);
    expect(globMatch('a+b', 'ab')).toBe(false);
  });

  it('handles combined * and ?', () => {
    expect(globMatch('*-?vc', 'auth-svc')).toBe(true);
    expect(globMatch('*-?vc', 'auth-service')).toBe(false);
  });
});

describe('matchesAny', () => {
  it('returns false for empty patterns', () => {
    expect(matchesAny('auth-svc', [])).toBe(false);
  });

  it('returns true when at least one pattern matches', () => {
    expect(matchesAny('auth-svc', ['order-svc', 'auth-svc'])).toBe(true);
  });

  it('returns false when no pattern matches', () => {
    expect(matchesAny('auth-svc', ['order-svc', '*-api'])).toBe(false);
  });

  it('matches via glob', () => {
    expect(matchesAny('payments-api', ['*-api'])).toBe(true);
  });
});

describe('applyGlobFilter', () => {
  const items = ['auth-svc', 'payments-api', 'order-api', 'frontend'];

  it('returns all items when patterns list is empty (exclude)', () => {
    expect(applyGlobFilter(items, 'exclude', [])).toEqual(items);
  });

  it('returns all items when patterns list is empty (include)', () => {
    expect(applyGlobFilter(items, 'include', [])).toEqual(items);
  });

  it('exclude mode hides matching items', () => {
    const result = applyGlobFilter(items, 'exclude', ['*-api']);
    expect(result).toEqual(['auth-svc', 'frontend']);
  });

  it('include mode shows only matching items', () => {
    const result = applyGlobFilter(items, 'include', ['*-api']);
    expect(result).toEqual(['payments-api', 'order-api']);
  });

  it('exclude with exact pattern', () => {
    const result = applyGlobFilter(items, 'exclude', ['auth-svc']);
    expect(result).toEqual(['payments-api', 'order-api', 'frontend']);
  });

  it('include with multiple patterns', () => {
    const result = applyGlobFilter(items, 'include', ['auth-svc', '*-api']);
    expect(result).toEqual(['auth-svc', 'payments-api', 'order-api']);
  });

  it('last-visible guard: returns all items when exclude hides everything', () => {
    const result = applyGlobFilter(['only-svc'], 'exclude', ['only-svc']);
    expect(result).toEqual(['only-svc']);
  });

  it('last-visible guard: returns all items when include matches nothing', () => {
    const result = applyGlobFilter(items, 'include', ['nonexistent-*']);
    expect(result).toEqual(items);
  });

  it('returns a copy (not the original array)', () => {
    const result = applyGlobFilter(items, 'exclude', []);
    expect(result).not.toBe(items);
  });
});
