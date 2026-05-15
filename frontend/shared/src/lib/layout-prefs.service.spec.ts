// FR-13 — layout-prefs service: localStorage persistence + hardening.

import { TestBed } from '@angular/core/testing';
import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  LayoutPrefsService,
  STORAGE_KEY_LAYOUT,
  type DeploymentMatrixStoreType
} from '../public-api';
import { loadLayout } from './layout-prefs.service';

function prepare(): DeploymentMatrixStoreType {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()]
  });
  return TestBed.inject(DeploymentMatrixStore);
}

function makeService(): { store: DeploymentMatrixStoreType; svc: LayoutPrefsService } {
  const store = prepare();
  const svc = TestBed.inject(LayoutPrefsService);
  return { store, svc };
}

describe('LayoutPrefsService — load helper', () => {
  beforeEach(() => localStorage.clear());

  it('loadLayout returns the default Matrix layout when nothing is stored', () => {
    expect(loadLayout()).toBe('matrix');
  });

  it('loadLayout returns the stored layout when it is one of the known ids', () => {
    localStorage.setItem(STORAGE_KEY_LAYOUT, 'swim-lane');
    expect(loadLayout()).toBe('swim-lane');
  });

  it('loadLayout falls back to default on an unknown id', () => {
    localStorage.setItem(STORAGE_KEY_LAYOUT, 'galaxy-graph');
    expect(loadLayout()).toBe('matrix');
  });

  it('loadLayout handles unparseable garbage gracefully', () => {
    // localStorage.getItem returns a string or null — but the validator
    // still needs to reject non-allowed values. Smoke test for the
    // corruption-safe path.
    localStorage.setItem(STORAGE_KEY_LAYOUT, '{not-an-id}');
    expect(loadLayout()).toBe('matrix');
  });
});

describe('LayoutPrefsService — wiring', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates the store from localStorage on construction', () => {
    localStorage.setItem(STORAGE_KEY_LAYOUT, 'workflow-rows');
    const { store } = makeService();
    expect(store.layout()).toBe('workflow-rows');
  });

  it('writes the active layout to localStorage when changed', () => {
    const { store, svc } = makeService();
    void svc;
    store.setLayout('swim-lane');
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem(STORAGE_KEY_LAYOUT)).toBe('swim-lane');
  });

  it('a corrupt persisted value does not throw on construction', () => {
    localStorage.setItem(STORAGE_KEY_LAYOUT, 'not-a-layout');
    expect(() => makeService()).not.toThrow();
    const store = TestBed.inject(DeploymentMatrixStore);
    expect(store.layout()).toBe('matrix');
  });
});
