// Date/time formatting utilities — pure, no browser-API dependencies.

/**
 * Returns a human-readable relative elapsed string ("3h ago", "2m ago", "just now").
 * `now` is injectable for testability; defaults to Date.now().
 */
export function relativeElapsed(isoTimestamp: string, now: number = Date.now()): string {
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

/** Returns an absolute UTC string, e.g. "2024-06-09 14:32 UTC". */
export function absoluteUtc(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}
