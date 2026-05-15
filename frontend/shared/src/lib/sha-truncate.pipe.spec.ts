// FR-05 — sha-truncate pipe: renders the conventional Git short form
// (first 7 chars + ellipsis) and honours the SAD §7 null-render invariant
// for nullable attributes.

import { ShaTruncatePipe, shaTruncate } from './sha-truncate.pipe';

describe('shaTruncate (pure helper)', () => {
  it('returns the empty string for null / undefined / empty input', () => {
    expect(shaTruncate(null)).toBe('');
    expect(shaTruncate(undefined)).toBe('');
    expect(shaTruncate('')).toBe('');
  });

  it('passes values up to 7 characters through unchanged (no ellipsis)', () => {
    expect(shaTruncate('a')).toBe('a');
    expect(shaTruncate('abc123')).toBe('abc123');
    expect(shaTruncate('1234567')).toBe('1234567');
  });

  it('truncates longer values to the first 7 characters + ellipsis', () => {
    expect(shaTruncate('1234567890abcdef')).toBe('1234567…');
    expect(shaTruncate('9f1c0d2e8a')).toBe('9f1c0d2…');
    expect(shaTruncate('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'))
      .toBe('deadbee…');
  });

  it('never produces the literal "null" or "undefined"', () => {
    // Defensive — guards against accidental String() coercion.
    expect(shaTruncate(null)).not.toContain('null');
    expect(shaTruncate(undefined)).not.toContain('undefined');
  });
});

describe('ShaTruncatePipe', () => {
  const pipe = new ShaTruncatePipe();

  it('delegates to the pure helper', () => {
    expect(pipe.transform('1234567890abcdef')).toBe('1234567…');
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform('short')).toBe('short');
  });
});
