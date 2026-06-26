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
 * Composite matching (issue #353):
 *   - A pattern containing `/` is matched against the full `namespace/service` string.
 *   - A pattern WITHOUT `/` is matched against the service segment only, across all
 *     namespaces (backward-compatible: all existing slashless patterns keep working).
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
 * Composite service match for namespace-aware filtering (issue #353).
 *
 * Rules:
 *   - A pattern containing `/` is matched against the full `namespace/service`
 *     composite string. When `namespace` is null the composite is just `service`,
 *     and a slashed pattern will only match if it does not require a prefix.
 *   - A pattern WITHOUT `/` is matched against the bare `service` only — this
 *     preserves backward compatibility: all pre-#353 saved patterns keep working
 *     across all namespaces.
 *
 * @param service   The bare service name (e.g. `"auth-bff"`).
 * @param namespace The optional CI/CD namespace (e.g. `"myorg"`). Null = none.
 * @param patterns  The glob patterns to test.
 * @returns true when at least one pattern matches.
 */
export function matchesComposite(
  service: string,
  namespace: string | null | undefined,
  patterns: string[],
): boolean {
  const composite = namespace ? `${namespace}/${service}` : service;
  return patterns.some((p) => {
    if (p.includes('/')) {
      // Slashed pattern: match the full composite string (or bare service when no namespace).
      return globMatch(p, composite);
    }
    // Slashless pattern: match the service segment only — namespace-agnostic.
    return globMatch(p, service);
  });
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

/**
 * ServiceIdentity — a (namespace, service) pair used for composite filtering.
 * Namespace null means the service has no namespace and renders unprefixed.
 */
export interface ServiceIdentity {
  service: string;
  namespace: string | null | undefined;
}

/**
 * Derive the visible subset of service identities applying mode + patterns
 * using composite glob matching (issue #353).
 *
 *   exclude mode: show everything EXCEPT identities matching a pattern.
 *   include mode: show ONLY identities matching a pattern.
 *
 * Empty pattern list → return all identities regardless of mode (blank = all).
 * Last-visible guard: always return at least one item when identities is non-empty.
 */
export function applyCompositeGlobFilter(
  identities: ServiceIdentity[],
  mode: 'exclude' | 'include',
  patterns: string[],
): ServiceIdentity[] {
  if (patterns.length === 0) return [...identities];
  let visible: ServiceIdentity[];
  if (mode === 'exclude') {
    visible = identities.filter((i) => !matchesComposite(i.service, i.namespace, patterns));
  } else {
    visible = identities.filter((i) => matchesComposite(i.service, i.namespace, patterns));
  }
  // Guard: never return an empty list when identities has entries
  return visible.length > 0 ? visible : [...identities];
}
