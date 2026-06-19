/**
 * Unit tests for glob.util — globMatch, matchesAny, applyGlobFilter,
 * matchesComposite, applyCompositeGlobFilter.
 */
import { describe, it, expect } from 'vitest';
import {
  globMatch,
  matchesAny,
  applyGlobFilter,
  matchesComposite,
  applyCompositeGlobFilter,
} from './glob.util';

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

  it('escapes ( ) in pattern — literal grouping chars', () => {
    expect(globMatch('a(b)', 'a(b)')).toBe(true);
    expect(globMatch('a(b)', 'ab')).toBe(false);   // parentheses are not a regex group
  });

  it('escapes [ ] in pattern — literal bracket chars', () => {
    expect(globMatch('a[b]', 'a[b]')).toBe(true);
    expect(globMatch('a[b]', 'ab')).toBe(false);   // brackets are not a character class
  });

  it('escapes | in pattern — literal pipe, not alternation', () => {
    expect(globMatch('a|b', 'a|b')).toBe(true);
    expect(globMatch('a|b', 'a')).toBe(false);     // pipe does not mean "or"
    expect(globMatch('a|b', 'b')).toBe(false);
  });

  it('escapes { } in pattern — literal brace chars', () => {
    expect(globMatch('a{2}', 'a{2}')).toBe(true);
    expect(globMatch('a{2}', 'aa')).toBe(false);   // braces are not a quantifier
  });

  it('escapes ^ in pattern — literal caret', () => {
    expect(globMatch('^start', '^start')).toBe(true);
    expect(globMatch('^start', 'start')).toBe(false);
  });

  it('escapes $ in pattern — literal dollar', () => {
    expect(globMatch('end$', 'end$')).toBe(true);
    expect(globMatch('end$', 'end')).toBe(false);
  });

  it('anchors pattern: does not match a longer string (no implicit wildcard)', () => {
    expect(globMatch('api', 'api')).toBe(true);
    expect(globMatch('api', 'apixyz')).toBe(false);   // no suffix wildcard
    expect(globMatch('api', 'prefixapi')).toBe(false); // no prefix wildcard
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

describe('matchesComposite', () => {
  it('slashless pattern matches the bare service name (no namespace)', () => {
    expect(matchesComposite('auth-bff', null, ['auth-bff'])).toBe(true);
    expect(matchesComposite('auth-bff', null, ['order-svc'])).toBe(false);
  });

  it('slashless pattern matches service with a namespace — namespace-agnostic', () => {
    expect(matchesComposite('auth-bff', 'org-a', ['auth-bff'])).toBe(true);
    expect(matchesComposite('auth-bff', 'org-b', ['auth-bff'])).toBe(true);
  });

  it('slashless glob pattern matches service segment across any namespace', () => {
    expect(matchesComposite('payments-api', 'org-a', ['*-api'])).toBe(true);
    expect(matchesComposite('payments-api', null,    ['*-api'])).toBe(true);
    expect(matchesComposite('auth-svc',     'org-a', ['*-api'])).toBe(false);
  });

  it('slashed pattern matches full composite (namespace/service)', () => {
    expect(matchesComposite('auth-bff', 'org-a', ['org-a/auth-bff'])).toBe(true);
    expect(matchesComposite('auth-bff', 'org-b', ['org-a/auth-bff'])).toBe(false);
  });

  it('slashed glob pattern matches full composite with wildcards', () => {
    expect(matchesComposite('payments-api', 'org-a', ['org-a/*'])).toBe(true);
    expect(matchesComposite('order-svc',    'org-b', ['org-a/*'])).toBe(false);
    expect(matchesComposite('any-svc',      'org-a', ['*/any-svc'])).toBe(true);
    expect(matchesComposite('other-svc',    'org-a', ['*/any-svc'])).toBe(false);
  });

  it('slashed pattern against null-namespace: matches bare service as the composite', () => {
    // null namespace → composite is just the service name; a slashed pattern requires a slash
    expect(matchesComposite('auth-bff', null, ['*/auth-bff'])).toBe(false);
    expect(matchesComposite('auth-bff', null, ['auth-bff'])).toBe(true);
  });

  it('matching is case-insensitive', () => {
    expect(matchesComposite('Auth-BFF', 'ORG-A', ['org-a/auth-bff'])).toBe(true);
    expect(matchesComposite('Auth-BFF', 'org-a', ['ORG-A/*'])).toBe(true);
  });

  it('returns false for empty patterns', () => {
    expect(matchesComposite('auth-bff', 'org-a', [])).toBe(false);
  });

  it('mixed slashed + slashless patterns — any match returns true', () => {
    // slashless pattern matches service regardless of namespace
    expect(matchesComposite('gateway', 'org-a', ['org-b/*', 'gateway'])).toBe(true);
    // slashed pattern targeting the specific namespace
    expect(matchesComposite('gateway', 'org-b', ['org-b/gateway', 'other'])).toBe(true);
  });
});

describe('applyCompositeGlobFilter', () => {
  const ids = [
    { service: 'auth-bff',   namespace: 'org-a' },
    { service: 'auth-bff',   namespace: 'org-b' },
    { service: 'gateway',    namespace: null     },
    { service: 'order-svc',  namespace: 'org-a' },
  ];

  it('returns all when patterns empty (exclude)', () => {
    expect(applyCompositeGlobFilter(ids, 'exclude', [])).toEqual(ids);
  });

  it('returns all when patterns empty (include)', () => {
    expect(applyCompositeGlobFilter(ids, 'include', [])).toEqual(ids);
  });

  it('exclude mode: hides items matching a slashless pattern across all namespaces', () => {
    const result = applyCompositeGlobFilter(ids, 'exclude', ['auth-bff']);
    expect(result).toEqual([
      { service: 'gateway',   namespace: null    },
      { service: 'order-svc', namespace: 'org-a' },
    ]);
  });

  it('include mode: shows only items matching a slashed pattern', () => {
    const result = applyCompositeGlobFilter(ids, 'include', ['org-a/*']);
    expect(result).toEqual([
      { service: 'auth-bff',  namespace: 'org-a' },
      { service: 'order-svc', namespace: 'org-a' },
    ]);
  });

  it('include mode: slashed pattern does not match null-namespace rows', () => {
    const result = applyCompositeGlobFilter(ids, 'include', ['org-a/*', 'org-b/*']);
    expect(result).not.toContainEqual({ service: 'gateway', namespace: null });
  });

  it('last-visible guard: returns all when exclude hides everything', () => {
    const single = [{ service: 'only', namespace: null }];
    const result = applyCompositeGlobFilter(single, 'exclude', ['only']);
    expect(result).toEqual(single);
  });

  it('last-visible guard: returns all when include matches nothing', () => {
    const result = applyCompositeGlobFilter(ids, 'include', ['nonexistent/*']);
    expect(result).toEqual(ids);
  });
});
