// SAD §10 Decision #7 + §7 "Visual layout" localStorage table +
// §7 "API Contract" → "GET /api/deployments — query parameters" —
// `dashboard.correlationAttribute` persistence. The value is the SOLE
// transport of the user's picker preference: it's loaded into the store
// on bootstrap, written back on every change, and read by the API client
// when issuing matrix GETs.
//
// SAD load-time hardening (`§7 Visual layout` localStorage table):
//   - missing / unparseable / unknown value → treat as ABSENT (the SPA
//     then sends no query parameter and the server default applies)
//   - absence is the canonical "follow the system default" state, not
//     an error
//
// Sister service to `layout-prefs.service.ts` — kept narrow + single-key.

import { effect, inject, Injectable, untracked } from '@angular/core';
import { DeploymentMatrixStore } from './deployment-matrix.store';
import { readString, removeKey, writeString } from './local-storage';
import {
  STORAGE_KEY_CORRELATION_ATTRIBUTE,
  isCorrelationAttribute,
  type CorrelationAttribute
} from './view-config';

@Injectable({ providedIn: 'root' })
export class CorrelationPrefsService {
  private readonly store = inject(DeploymentMatrixStore);

  constructor() {
    this.store.setCorrelationAttribute(loadCorrelationAttribute());
    // Persist on every change. `undefined` clears the key so the next
    // boot follows the system default cleanly.
    effect(() => {
      const v = this.store.correlationAttribute();
      untracked(() => {
        if (v === undefined) removeKey(STORAGE_KEY_CORRELATION_ATTRIBUTE);
        else writeString(STORAGE_KEY_CORRELATION_ATTRIBUTE, v);
      });
    });
  }
}

/**
 * Load the persisted correlation-attribute pick. Returns `undefined` on
 * missing / unknown / unreadable — the SPA then omits the query parameter
 * and falls back to the server-side default.
 */
export function loadCorrelationAttribute(): CorrelationAttribute | undefined {
  const raw = readString(STORAGE_KEY_CORRELATION_ATTRIBUTE);
  if (raw === null) return undefined;
  return isCorrelationAttribute(raw) ? raw : undefined;
}
