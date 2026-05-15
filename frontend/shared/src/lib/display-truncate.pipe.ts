// `displayTruncate` — caps a string at `max` characters and replaces the
// tail with U+2026 (…) when it would overflow.
//
// Rationale (NFR-09 invariant I6 — "box content stays within parent box"):
// `Range.getBoundingClientRect()` reports the bounding rect of every
// character glyph in a text node, irrespective of CSS visual clipping
// (`overflow: hidden` + `text-overflow: ellipsis`). A nowrap span with
// `truncate` still produces a Range rect equal to the intrinsic text
// width — so long version strings (e.g. `v0.0.1778860218657-709` posted
// by realtime tests) trip the invariant even though the SPA visually
// clips them. Capping the rendered character count in the DOM is the
// only way to bound the Range rect. Always-on element — applied to
// version, run number, actor and similar bounded-width fields.
//
// Limits are sized to comfortably fit inside the smallest leaf width
// across the four views (Compact / Glance ~108 px content, 11px monospace
// ≈ 7-8 px per glyph). Detailed view wraps via `break-all` instead and
// does not need this pipe.

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'displayTruncate',
  standalone: true,
  pure: true
})
export class DisplayTruncatePipe implements PipeTransform {
  transform(value: string | null | undefined, max = 16): string {
    if (value == null) return '';
    if (max <= 1) return value.length > 0 ? '…' : '';
    if (value.length <= max) return value;
    return value.slice(0, max - 1) + '…';
  }
}
