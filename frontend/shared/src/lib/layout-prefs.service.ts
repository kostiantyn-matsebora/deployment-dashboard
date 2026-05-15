// FR-13 — layout persistence. Hydrates the store from `dashboard.layout`
// on construction and writes the layout id back on every change.
//
// Sister service to `view-prefs.service.ts`. Kept separate so the two
// concerns (FR-12 view + attrs, FR-13 layout) can be tested in isolation.
//
// SAD §7 "Client-side persistence (localStorage)" load-time hardening:
//   - `localStorage.getItem` wrapped in try/catch via the typed wrapper
//   - unknown layout id → DEFAULT_LAYOUT
//   - missing key → DEFAULT_LAYOUT

import { effect, inject, Injectable, untracked } from '@angular/core';
import { DeploymentMatrixStore } from './deployment-matrix.store';
import { readEnum, writeString } from './local-storage';
import {
  DEFAULT_LAYOUT,
  STORAGE_KEY_LAYOUT,
  VALID_LAYOUT_IDS,
  type LayoutId
} from './view-config';

@Injectable({ providedIn: 'root' })
export class LayoutPrefsService {
  private readonly store = inject(DeploymentMatrixStore);

  constructor() {
    this.store.setLayout(loadLayout());
    // Watch the active layout and persist on every change.
    effect(() => {
      const l = this.store.layout();
      untracked(() => writeString(STORAGE_KEY_LAYOUT, l));
    });
  }
}

/**
 * Load the active layout from localStorage. Returns DEFAULT_LAYOUT
 * (`matrix`) on missing / unknown / unreadable.
 */
export function loadLayout(): LayoutId {
  return readEnum<LayoutId>(STORAGE_KEY_LAYOUT, VALID_LAYOUT_IDS, DEFAULT_LAYOUT);
}
