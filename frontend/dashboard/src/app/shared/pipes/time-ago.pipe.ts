import { Pipe, PipeTransform } from '@angular/core';

/**
 * TimeAgoPipe — converts an ISO-8601 string to a human-readable elapsed label.
 *
 * Examples: "just now", "5m ago", "3h ago", "2d ago".
 * pure: false so it re-evaluates each CD cycle (elapsed values drift over time).
 * With OnPush components, this only runs when the host component re-evaluates.
 */
@Pipe({ name: 'timeAgo', standalone: true, pure: false })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    const ms = Date.now() - new Date(value).getTime();
    const m = Math.floor(ms / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
}

/** Standalone function — use where pipe is unavailable (e.g. TS methods). */
export function timeAgoStr(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = Date.now() - new Date(value).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Returns absolute UTC string: "2026-05-29 10:30:00 UTC" */
export function absoluteUtc(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
