/**
 * Glob match utilities.
 *
 * Supports two glob meta-characters:
 *   *  — matches any sequence of characters (including empty)
 *   ?  — matches exactly one character
 *
 * All other regex-special characters are escaped so literal dots, dashes,
 * brackets, etc. work as expected. Matching is case-insensitive.
 *
 * Spec: docs/design/mockup/index.html §svcGlobMatch
 */

/**
 * Returns true when `name` matches `pattern` using glob semantics.
 * Case-insensitive; `*` = any substring; `?` = any single char.
 */
export function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials
        .replace(/\*/g, '.*')                   // * → any chars
        .replace(/\?/g, '.') +                  // ? → one char
      '$',
    'i',
  );
  return re.test(name);
}

/**
 * Returns true when `name` matches at least one of `patterns`.
 * Returns false when `patterns` is empty.
 */
export function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((p) => globMatch(p, name));
}

/**
 * Derive the visible subset of `items` applying mode + patterns.
 *
 *   exclude mode: show everything EXCEPT items matching a pattern.
 *   include mode: show ONLY items matching a pattern.
 *
 * Empty pattern list → return all items regardless of mode (blank = all).
 * Last-visible guard: always return at least one item when items is non-empty.
 */
export function applyGlobFilter(
  items: string[],
  mode: 'exclude' | 'include',
  patterns: string[],
): string[] {
  if (patterns.length === 0) return [...items];
  let visible: string[];
  if (mode === 'exclude') {
    visible = items.filter((s) => !matchesAny(s, patterns));
  } else {
    visible = items.filter((s) => matchesAny(s, patterns));
  }
  // Guard: never return an empty list when items has entries
  return visible.length > 0 ? visible : [...items];
}
