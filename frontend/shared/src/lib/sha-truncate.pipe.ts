// `shaTruncate` — renders a commit SHA in the conventional Git short form:
// first 7 characters, followed by a U+2026 ellipsis when the value is longer
// than 7. SHAs already <= 7 characters render verbatim (no trailing ellipsis).
//
// SAD §7 "Attribute vocabulary" table — the SPA MAY truncate `sha` for
// display (e.g. first 7 chars) without altering the underlying stored value;
// the full value remains in the history drawer (full-attribute disclosure
// rule) and in the per-slot `title` tooltip.
//
// Null-render invariant for nullable attributes (SAD §7): null / undefined /
// empty-string `sha` renders as the empty string — never as "null" or
// "undefined". Mirrors the same rule applied to `ref`.

import { Pipe, PipeTransform } from '@angular/core';

const ELLIPSIS = '…';
const SHORT_LENGTH = 7;

export function shaTruncate(value: string | null | undefined): string {
  if (value == null) return '';
  if (value.length === 0) return '';
  if (value.length <= SHORT_LENGTH) return value;
  return value.slice(0, SHORT_LENGTH) + ELLIPSIS;
}

@Pipe({
  name: 'shaTruncate',
  standalone: true,
  pure: true
})
export class ShaTruncatePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return shaTruncate(value);
  }
}
