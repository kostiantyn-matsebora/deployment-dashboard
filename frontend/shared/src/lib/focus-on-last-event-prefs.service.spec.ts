// Mockup header "Focus on last event" toggle — localStorage persistence
// under `dashboard.focusOnLastEvent`. Defaults to `true`.

import { TestBed } from '@angular/core/testing';
import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  FocusOnLastEventPrefsService,
  STORAGE_KEY_FOCUS_ON_LAST_EVENT,
  type DeploymentMatrixStoreType
} from '../public-api';
import { loadFocusOnLastEvent } from './focus-on-last-event-prefs.service';

function prepare(): DeploymentMatrixStoreType {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()]
  });
  return TestBed.inject(DeploymentMatrixStore);
}

function makeService(): {
  store: DeploymentMatrixStoreType;
  svc: FocusOnLastEventPrefsService;
} {
  const store = prepare();
  const svc = TestBed.inject(FocusOnLastEventPrefsService);
  return { store, svc };
}

describe('FocusOnLastEventPrefsService — load helper', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to true when nothing is stored', () => {
    expect(loadFocusOnLastEvent()).toBeTrue();
  });

  it('returns true when the stored string is "true"', () => {
    localStorage.setItem(STORAGE_KEY_FOCUS_ON_LAST_EVENT, 'true');
    expect(loadFocusOnLastEvent()).toBeTrue();
  });

  it('returns false when the stored string is "false"', () => {
    localStorage.setItem(STORAGE_KEY_FOCUS_ON_LAST_EVENT, 'false');
    expect(loadFocusOnLastEvent()).toBeFalse();
  });

  it('falls back to the default for nonsense values', () => {
    localStorage.setItem(STORAGE_KEY_FOCUS_ON_LAST_EVENT, '{garbage}');
    expect(loadFocusOnLastEvent()).toBeTrue();
  });
});

describe('FocusOnLastEventPrefsService — wiring', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates the store from localStorage on construction', () => {
    localStorage.setItem(STORAGE_KEY_FOCUS_ON_LAST_EVENT, 'false');
    const { store } = makeService();
    expect(store.focusOnLastEvent()).toBeFalse();
  });

  it('writes the active value to localStorage on toggle', () => {
    const { store, svc } = makeService();
    void svc;
    store.setFocusOnLastEvent(false);
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem(STORAGE_KEY_FOCUS_ON_LAST_EVENT)).toBe('false');
    store.setFocusOnLastEvent(true);
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem(STORAGE_KEY_FOCUS_ON_LAST_EVENT)).toBe('true');
  });
});
