// `dashboard.focusOnLastEvent` persistence.
//
// Mockup header toggle (docs/deployment-dashboard.html lines 605–610) +
// SAD §7 "Visual layout" localStorage table. Persists the boolean state
// across reloads; default is ON (matches the mockup checkbox default).
//
// SAD load-time hardening: any value other than the strings `'true'` or
// `'false'` falls back to the default. `localStorage` returning `null`
// (key absent) also yields the default.

import { effect, inject, Injectable, untracked } from '@angular/core';
import { DeploymentMatrixStore } from './deployment-matrix.store';
import { readString, writeString } from './local-storage';
import {
  DEFAULT_FOCUS_ON_LAST_EVENT,
  STORAGE_KEY_FOCUS_ON_LAST_EVENT
} from './view-config';

@Injectable({ providedIn: 'root' })
export class FocusOnLastEventPrefsService {
  private readonly store = inject(DeploymentMatrixStore);

  constructor() {
    this.store.setFocusOnLastEvent(loadFocusOnLastEvent());
    effect(() => {
      const v = this.store.focusOnLastEvent();
      untracked(() =>
        writeString(STORAGE_KEY_FOCUS_ON_LAST_EVENT, v ? 'true' : 'false')
      );
    });
  }
}

/**
 * Load the persisted focus-on-last-event toggle. Returns the default
 * (`true`) on missing / corrupt / unreadable.
 */
export function loadFocusOnLastEvent(): boolean {
  const raw = readString(STORAGE_KEY_FOCUS_ON_LAST_EVENT);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return DEFAULT_FOCUS_ON_LAST_EVENT;
}
