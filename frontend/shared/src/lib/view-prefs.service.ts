// FR-12 — view + per-view attribute selection persistence.
//
// On construction: loads `dashboard.view` + `dashboard.attrs.<viewId>` from
// localStorage (hardened — see `loadView` / `loadAttrsFor`) and seeds the
// store. On every subsequent change to either field it writes the updated
// value back to localStorage.
//
// SAD §7 "Client-side persistence (localStorage)" defines the wire shape;
// docs/ui-compact-options.md describes the fallback rules. Keys + defaults
// live in `view-config.ts` — never inline here.

import { effect, inject, Injectable, untracked } from '@angular/core';
import { DeploymentMatrixStore } from './deployment-matrix.store';
import {
  DEFAULT_ATTRS,
  DEFAULT_VIEW,
  STORAGE_KEYS,
  VIEWS,
  isAttrKey,
  isViewId,
  type AttrKey,
  type ViewId,
  CAPS
} from './view-config';

@Injectable({ providedIn: 'root' })
export class ViewPrefsService {
  private readonly store = inject(DeploymentMatrixStore);

  constructor() {
    this.load();
    this.bindPersistence();
  }

  /** Re-load from localStorage (test helper). */
  reload(): void {
    this.load();
  }

  /** Clear all persisted dashboard view/attrs keys. Test helper. */
  clear(): void {
    if (!hasLocalStorage()) return;
    try {
      localStorage.removeItem(STORAGE_KEYS.view);
      for (const v of VIEWS) {
        localStorage.removeItem(STORAGE_KEYS.attrsFor(v.id));
      }
    } catch {
      /* ignore — quota or disabled storage */
    }
  }

  // ----- internals -----

  private load(): void {
    this.store.setView(loadView());
    for (const v of VIEWS) {
      this.store.setAttrsForView(v.id, loadAttrsFor(v.id));
    }
  }

  private bindPersistence(): void {
    // Watch the active view and persist on every change.
    effect(() => {
      const v = this.store.view();
      untracked(() => writeView(v));
    });
    // Watch attrs and persist all five keys on every change. Keeping a
    // single effect (rather than five) avoids subtle scheduling weirdness
    // when the bootstrap loop seeds them — the effect fires once with the
    // final map.
    effect(() => {
      const attrs = this.store.attrs();
      untracked(() => writeAttrs(attrs));
    });
  }
}

// ----- pure helpers (also exported for unit tests) -------------------------

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** Load the active view from localStorage. Falls back to DEFAULT_VIEW. */
export function loadView(): ViewId {
  if (!hasLocalStorage()) return DEFAULT_VIEW;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.view);
    if (raw && isViewId(raw)) return raw;
  } catch {
    /* fallthrough */
  }
  return DEFAULT_VIEW;
}

/**
 * Load the attribute selection for one view. Hardened per the SAD:
 *  - JSON.parse wrapped in try/catch
 *  - non-array → defaults
 *  - unknown keys silently filtered
 *  - truncated to the view's cap
 *  - empty array is a legitimate user choice (preserved)
 */
export function loadAttrsFor(viewId: ViewId): readonly AttrKey[] {
  const defaults = [...DEFAULT_ATTRS[viewId]].slice(0, CAPS[viewId]);
  if (!hasLocalStorage()) return defaults;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEYS.attrsFor(viewId));
  } catch {
    return defaults;
  }
  if (raw === null) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!Array.isArray(parsed)) return defaults;
  const cleaned = parsed.filter(isAttrKey).slice(0, CAPS[viewId]);
  // Deduplicate — defensive; keeps invariants tidy.
  return Array.from(new Set(cleaned));
}

function writeView(view: ViewId): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEYS.view, view);
  } catch {
    /* quota / disabled — ignore */
  }
}

function writeAttrs(attrs: Record<ViewId, readonly AttrKey[]>): void {
  if (!hasLocalStorage()) return;
  try {
    for (const v of VIEWS) {
      localStorage.setItem(
        STORAGE_KEYS.attrsFor(v.id),
        JSON.stringify(attrs[v.id] ?? [])
      );
    }
  } catch {
    /* quota / disabled — ignore */
  }
}
