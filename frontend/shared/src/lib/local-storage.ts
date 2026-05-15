// Typed, corruption-safe localStorage wrapper.
//
// SAD §7 "Client-side persistence (localStorage)" load-time hardening rules:
//   - every JSON.parse wrapped in try/catch; throws fall back to defaults
//   - non-conforming values fall back to defaults
//   - reading from an environment without `localStorage` is non-fatal
//
// This wrapper centralises the boilerplate so individual prefs services
// (`view-prefs.service.ts`, `layout-prefs.service.ts`) stay slim.

export function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** Safe string read. Returns `null` when the key is absent or storage is unavailable. */
export function readString(key: string): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Safe string write. Silently ignored when storage is unavailable. */
export function writeString(key: string, value: string): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / disabled — ignore */
  }
}

/** Safe delete. */
export function removeKey(key: string): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Read one of an allowed-string set from localStorage. Returns the default
 * on any failure (key missing, storage unavailable, value not in allowed
 * set). Mirrors the SAD's load-time hardening rules verbatim.
 */
export function readEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const raw = readString(key);
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

/**
 * Read a JSON array of validated string keys. Returns the default on any
 * failure (malformed JSON, not an array, etc.). The `valid` predicate
 * filters unknown values silently per the SAD rule "unknown keys are
 * silently dropped". Optional `cap` truncates to a per-view max.
 */
export function readJsonArray<T extends string>(
  key: string,
  valid: (v: unknown) => v is T,
  fallback: readonly T[],
  cap = Infinity
): readonly T[] {
  const raw = readString(key);
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!Array.isArray(parsed)) return fallback;
  const cleaned = parsed.filter(valid).slice(0, cap);
  return Array.from(new Set(cleaned));
}
