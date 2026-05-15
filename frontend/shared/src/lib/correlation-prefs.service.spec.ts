// SAD §10 Decision #7 — `dashboard.correlationAttribute` persistence.
// Mirrors layout-prefs.service.spec.ts. Hardening rule:
//   missing / unknown / unreadable → undefined ("follow system default")

import { TestBed } from '@angular/core/testing';
import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import {
  CorrelationPrefsService,
  DeploymentMatrixStore,
  STORAGE_KEY_CORRELATION_ATTRIBUTE,
  type DeploymentMatrixStoreType
} from '../public-api';
import { loadCorrelationAttribute } from './correlation-prefs.service';

function prepare(): DeploymentMatrixStoreType {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()]
  });
  return TestBed.inject(DeploymentMatrixStore);
}

function makeService(): {
  store: DeploymentMatrixStoreType;
  svc: CorrelationPrefsService;
} {
  const store = prepare();
  const svc = TestBed.inject(CorrelationPrefsService);
  return { store, svc };
}

describe('CorrelationPrefsService — load helper', () => {
  beforeEach(() => localStorage.clear());

  it('loadCorrelationAttribute returns undefined when nothing is stored', () => {
    expect(loadCorrelationAttribute()).toBeUndefined();
  });

  it('loadCorrelationAttribute returns the stored value when known', () => {
    localStorage.setItem(STORAGE_KEY_CORRELATION_ATTRIBUTE, 'sha');
    expect(loadCorrelationAttribute()).toBe('sha');
  });

  it('loadCorrelationAttribute returns undefined for an unknown value', () => {
    localStorage.setItem(STORAGE_KEY_CORRELATION_ATTRIBUTE, 'id');
    expect(loadCorrelationAttribute()).toBeUndefined();
  });

  it('loadCorrelationAttribute returns undefined for nonsense values', () => {
    localStorage.setItem(STORAGE_KEY_CORRELATION_ATTRIBUTE, '{not-a-value}');
    expect(loadCorrelationAttribute()).toBeUndefined();
  });

  it('every allowed value round-trips', () => {
    for (const v of ['version', 'ref', 'sha', 'actor', 'run', 'ago']) {
      localStorage.setItem(STORAGE_KEY_CORRELATION_ATTRIBUTE, v);
      expect(loadCorrelationAttribute()).toBe(v as 'version');
    }
  });
});

describe('CorrelationPrefsService — wiring', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates the store from localStorage on construction', () => {
    localStorage.setItem(STORAGE_KEY_CORRELATION_ATTRIBUTE, 'ref');
    const { store } = makeService();
    expect(store.correlationAttribute()).toBe('ref');
  });

  it('writes the active value to localStorage on change', () => {
    const { store, svc } = makeService();
    void svc;
    store.setCorrelationAttribute('actor');
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem(STORAGE_KEY_CORRELATION_ATTRIBUTE)).toBe('actor');
  });

  it('clearing the override removes the localStorage key', () => {
    localStorage.setItem(STORAGE_KEY_CORRELATION_ATTRIBUTE, 'sha');
    const { store, svc } = makeService();
    void svc;
    store.setCorrelationAttribute(undefined);
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem(STORAGE_KEY_CORRELATION_ATTRIBUTE)).toBeNull();
  });

  it('a corrupt persisted value does not throw on construction', () => {
    localStorage.setItem(STORAGE_KEY_CORRELATION_ATTRIBUTE, 'not-an-attr');
    expect(() => makeService()).not.toThrow();
    const store = TestBed.inject(DeploymentMatrixStore);
    expect(store.correlationAttribute()).toBeUndefined();
  });
});
