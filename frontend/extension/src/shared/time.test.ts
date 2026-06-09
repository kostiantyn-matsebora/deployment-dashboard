import { describe, it, expect } from 'vitest';
import { relativeElapsed, absoluteUtc } from './time';

const BASE = new Date('2024-06-09T14:30:00Z').getTime();

describe('relativeElapsed', () => {
  it('returns "just now" for < 60 seconds', () => {
    const ts = new Date(BASE - 30 * 1000).toISOString();
    expect(relativeElapsed(ts, BASE)).toBe('just now');
  });

  it('returns minutes for < 60 minutes', () => {
    const ts = new Date(BASE - 15 * 60 * 1000).toISOString();
    expect(relativeElapsed(ts, BASE)).toBe('15m ago');
  });

  it('returns hours for < 24 hours', () => {
    const ts = new Date(BASE - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeElapsed(ts, BASE)).toBe('3h ago');
  });

  it('returns days for >= 24 hours', () => {
    const ts = new Date(BASE - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeElapsed(ts, BASE)).toBe('2d ago');
  });

  it('returns "1m ago" at exactly 60 seconds', () => {
    const ts = new Date(BASE - 60 * 1000).toISOString();
    expect(relativeElapsed(ts, BASE)).toBe('1m ago');
  });
});

describe('absoluteUtc', () => {
  it('formats as YYYY-MM-DD HH:mm UTC', () => {
    expect(absoluteUtc('2024-06-09T14:32:00Z')).toBe('2024-06-09 14:32 UTC');
  });

  it('zero-pads month, day, hour, minute', () => {
    expect(absoluteUtc('2024-01-05T03:07:00Z')).toBe('2024-01-05 03:07 UTC');
  });
});
