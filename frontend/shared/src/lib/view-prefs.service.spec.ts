// FR-12 — view-prefs service: localStorage persistence + hardening.

import { TestBed } from '@angular/core/testing';
import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  ViewPrefsService,
  type DeploymentMatrixStoreType
} from '../public-api';
import { STORAGE_KEYS } from './view-config';
import { loadAttrsFor, loadView } from './view-prefs.service';

function prepare(): DeploymentMatrixStoreType {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()]
  });
  return TestBed.inject(DeploymentMatrixStore);
}

function makeService(): { store: DeploymentMatrixStoreType; svc: ViewPrefsService } {
  const store = prepare();
  const svc = TestBed.inject(ViewPrefsService);
  return { store, svc };
}

describe('ViewPrefsService — load helpers', () => {
  beforeEach(() => localStorage.clear());

  it('loadView returns the default Detailed view when nothing is stored', () => {
    expect(loadView()).toBe('detailed');
  });

  it('loadView returns the stored view when it is one of the known ids', () => {
    localStorage.setItem(STORAGE_KEYS.view, 'glance');
    expect(loadView()).toBe('glance');
  });

  it('loadView falls back to default on an unknown view id', () => {
    localStorage.setItem(STORAGE_KEYS.view, 'wibble');
    expect(loadView()).toBe('detailed');
  });

  it('loadAttrsFor returns the per-view defaults when nothing is stored', () => {
    expect(loadAttrsFor('detailed')).toEqual(['status', 'version', 'run', 'ago', 'actor']);
    expect(loadAttrsFor('compact')).toEqual(['status', 'version', 'run', 'ago']);
    expect(loadAttrsFor('glance')).toEqual(['version']);
    expect(loadAttrsFor('focus')).toEqual(['status', 'version', 'run', 'ago']);
  });

  it('loadAttrsFor returns the stored value when valid', () => {
    localStorage.setItem(STORAGE_KEYS.attrsFor('detailed'),
      JSON.stringify(['version', 'actor']));
    expect(loadAttrsFor('detailed')).toEqual(['version', 'actor']);
  });

  it('loadAttrsFor falls back to defaults on malformed JSON', () => {
    localStorage.setItem(STORAGE_KEYS.attrsFor('detailed'), '{not json');
    expect(loadAttrsFor('detailed')).toEqual(['status', 'version', 'run', 'ago', 'actor']);
  });

  it('loadAttrsFor falls back to defaults when stored value is not an array', () => {
    localStorage.setItem(STORAGE_KEYS.attrsFor('detailed'), JSON.stringify({ foo: 1 }));
    expect(loadAttrsFor('detailed')).toEqual(['status', 'version', 'run', 'ago', 'actor']);
  });

  it('loadAttrsFor accepts the seven canonical attribute keys (ref + sha included)', () => {
    // SAD §7 "Load-time hardening rules" — known-attribute-keys filter must
    // pass through every member of the canonical seven for the matching cap.
    localStorage.setItem(STORAGE_KEYS.attrsFor('detailed'),
      JSON.stringify(['status', 'version', 'run', 'ago', 'actor', 'ref', 'sha']));
    expect(loadAttrsFor('detailed')).toEqual(
      ['status', 'version', 'run', 'ago', 'actor', 'ref', 'sha']
    );
  });

  it('loadAttrsFor silently filters genuinely unknown attribute keys', () => {
    // Mixes known + unknown — keeps the known, drops the unknown.
    localStorage.setItem(STORAGE_KEYS.attrsFor('compact'),
      JSON.stringify(['version', 'parents', 'sha', 'deployment_id']));
    expect(loadAttrsFor('compact')).toEqual(['version', 'sha']);
  });

  it('loadAttrsFor truncates to the per-view cap (Glance cap = 1)', () => {
    localStorage.setItem(STORAGE_KEYS.attrsFor('glance'),
      JSON.stringify(['ref', 'sha', 'status', 'version']));
    const out = loadAttrsFor('glance');
    expect(out.length).toBe(1);
    expect(out[0]).toBe('ref');
  });

  it('loadAttrsFor truncates Compact at cap 5', () => {
    localStorage.setItem(STORAGE_KEYS.attrsFor('compact'),
      JSON.stringify(['status', 'version', 'run', 'ago', 'actor', 'ref', 'sha']));
    const out = loadAttrsFor('compact');
    expect(out.length).toBe(5);
  });

  it('loadAttrsFor preserves an empty array selection (legitimate user choice)', () => {
    localStorage.setItem(STORAGE_KEYS.attrsFor('focus'), '[]');
    expect(loadAttrsFor('focus')).toEqual([]);
  });
});

describe('ViewPrefsService — wiring', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates the store from localStorage on construction', () => {
    localStorage.setItem(STORAGE_KEYS.view, 'compact');
    localStorage.setItem(STORAGE_KEYS.attrsFor('compact'),
      JSON.stringify(['version', 'run']));
    const { store } = makeService();
    expect(store.view()).toBe('compact');
    expect(store.attrs().compact).toEqual(['version', 'run']);
  });

  it('writes the active view to localStorage when changed', () => {
    const { store, svc } = makeService();
    void svc;
    store.setView('glance');
    // Effects flush on the next change-detection tick.
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem(STORAGE_KEYS.view)).toBe('glance');
  });

  it('writes per-view attrs to localStorage when changed', () => {
    const { store, svc } = makeService();
    void svc;
    store.toggleAttr('detailed', 'actor');
    TestBed.inject(ApplicationRef).tick();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.attrsFor('detailed'))!);
    expect(stored).toEqual(['status', 'version', 'run', 'ago']);
  });

  it('clear() removes every persisted dashboard key', () => {
    localStorage.setItem(STORAGE_KEYS.view, 'glance');
    localStorage.setItem(STORAGE_KEYS.attrsFor('detailed'), '[]');
    localStorage.setItem(STORAGE_KEYS.attrsFor('compact'), '[]');
    localStorage.setItem(STORAGE_KEYS.attrsFor('glance'), '[]');
    localStorage.setItem(STORAGE_KEYS.attrsFor('focus'), '[]');
    const { svc } = makeService();
    svc.clear();
    expect(localStorage.getItem(STORAGE_KEYS.view)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.attrsFor('detailed'))).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.attrsFor('compact'))).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.attrsFor('glance'))).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.attrsFor('focus'))).toBeNull();
  });
});
