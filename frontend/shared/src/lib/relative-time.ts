// Tiny relative-time helper. Stays local (no date-fns / moment) per the
// frontend-engineer guidance.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const delta = Math.max(0, now - t);
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) {
    const m = Math.floor(delta / MINUTE);
    return `${m} min ago`;
  }
  if (delta < DAY) {
    const h = Math.floor(delta / HOUR);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  if (delta < WEEK) {
    const d = Math.floor(delta / DAY);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  const w = Math.floor(delta / WEEK);
  return `${w} week${w === 1 ? '' : 's'} ago`;
}

/** "May 14, 2026 14:34" - matches the mockup's `dt` field formatting. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${months[d.getMonth()]} ${pad(d.getDate())}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
