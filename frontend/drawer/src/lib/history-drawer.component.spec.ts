// Drawer smoke test — confirms the component is hidden when the store
// reports drawerOpen === false, and that opening it via the store renders
// the drawer with the correct service/env header and triggers the lazy
// history fetch.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import {
  ApiClientService,
  DeploymentMatrixStore,
  type DeploymentMatrixStoreType,
  FIXTURE_ENVIRONMENTS,
  FIXTURE_HISTORY,
  FIXTURE_MATRIX,
  FIXTURE_SERVICES,
  relativeTime
} from '@dd/shared';
import { HistoryDrawerComponent } from './history-drawer.component';

function makeApiStub() {
  return {
    history: jasmine.createSpy('history').and.callFake(
      (s: string, e: string) => of(FIXTURE_HISTORY[s]?.[e] ?? [])
    ),
    matrix: () => of(FIXTURE_MATRIX),
    services: () => of(FIXTURE_SERVICES),
    environments: () => of(FIXTURE_ENVIRONMENTS)
  };
}

describe('HistoryDrawerComponent', () => {
  let store: DeploymentMatrixStoreType;
  let api: ReturnType<typeof makeApiStub>;

  beforeEach(() => {
    api = makeApiStub();
    TestBed.configureTestingModule({
      imports: [HistoryDrawerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ApiClientService, useValue: api }
      ]
    });
    store = TestBed.inject(DeploymentMatrixStore);
    store.setServices(FIXTURE_SERVICES);
    store.setEnvironments(FIXTURE_ENVIRONMENTS);
    store.setMatrix(FIXTURE_MATRIX);
  });

  it('renders nothing when the drawer is closed', () => {
    const fixture = TestBed.createComponent(HistoryDrawerComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="history-drawer"]')).toBeNull();
  });

  it('renders the service and environment when opened', () => {
    const fixture = TestBed.createComponent(HistoryDrawerComponent);
    const svc = FIXTURE_SERVICES.find(s => s.id === 'service-a')!;
    const env = FIXTURE_ENVIRONMENTS.find(e => e.id === 'dev')!;
    store.openDrawer(svc, env);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="history-drawer"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="drawer-service-name"]')?.textContent)
      .toContain('Service A');
    expect(fixture.nativeElement.querySelector('[data-testid="drawer-env-label"]')?.textContent)
      .toContain('DEV');
  });

  it('lazily fetches history when opened', async () => {
    const fixture = TestBed.createComponent(HistoryDrawerComponent);
    const svc = FIXTURE_SERVICES.find(s => s.id === 'service-a')!;
    const env = FIXTURE_ENVIRONMENTS.find(e => e.id === 'dev')!;
    store.openDrawer(svc, env);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.history).toHaveBeenCalledWith('service-a', 'dev');
    expect(store.drawerHistory().length).toBeGreaterThan(0);
  });

  it('renders the last-successful panel when present', () => {
    const fixture = TestBed.createComponent(HistoryDrawerComponent);
    const svc = FIXTURE_SERVICES.find(s => s.id === 'service-a')!;
    const env = FIXTURE_ENVIRONMENTS.find(e => e.id === 'dev')!;
    store.openDrawer(svc, env);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="drawer-last-successful"]')).not.toBeNull();
  });

  // Hybrid C FINAL — the current-version element is its own <p> on a full-
  // width row beneath the status badge / run-link row, not nested inside the
  // badge's flex container. Mirrors canonical mockup lines 2223-2235.
  // Long versions wrap via `overflow-wrap: anywhere`; the testid scopes the
  // version VALUE only (no badge text leaks into textContent).
  it('renders the current version as a standalone <p> below the status row', () => {
    const fixture = TestBed.createComponent(HistoryDrawerComponent);
    const svc = FIXTURE_SERVICES.find(s => s.id === 'service-a')!;
    const env = FIXTURE_ENVIRONMENTS.find(e => e.id === 'dev')!;
    store.openDrawer(svc, env);
    fixture.detectChanges();
    const versionEl = fixture.nativeElement.querySelector(
      '[data-testid="drawer-current-version"]'
    ) as HTMLElement | null;
    expect(versionEl).not.toBeNull();
    expect(versionEl!.tagName).toBe('P');
    expect(versionEl!.classList.contains('drawer-version-row')).toBeTrue();
    // The testid carries the version VALUE only — no "running…" / status text leaks in.
    expect(versionEl!.textContent?.trim()).toBe('v2.3.2');
    // Style hook for the overflow-wrap rule that prevents long versions from
    // overlapping the badge — verified by the inline-style attribute.
    expect(versionEl!.getAttribute('style')).toContain('overflow-wrap');
  });

  // SAD §7 "Null-render invariant for nullable attributes" — when ref / sha
  // are null/absent on the current slot, the drawer renders the testid
  // anchor with empty text content (the testid is always present per the
  // "Full-attribute disclosure rule"); the literal string "null" /
  // "undefined" MUST never reach the DOM.
  it('drawer ref/sha values render verbatim and untruncated when populated', () => {
    const fixture = TestBed.createComponent(HistoryDrawerComponent);
    // service-a/dev has both ref + sha populated in the fixture.
    const svc = FIXTURE_SERVICES.find(s => s.id === 'service-a')!;
    const env = FIXTURE_ENVIRONMENTS.find(e => e.id === 'dev')!;
    store.openDrawer(svc, env);
    fixture.detectChanges();
    const refEl = fixture.nativeElement.querySelector(
      '[data-testid="drawer-current-ref"]'
    ) as HTMLElement;
    const shaEl = fixture.nativeElement.querySelector(
      '[data-testid="drawer-current-sha"]'
    ) as HTMLElement;
    expect(refEl).not.toBeNull();
    // Testid scopes the VALUE only — no "ref · " label leaks into textContent.
    expect(refEl.textContent?.trim()).toBe('feature/login-revamp');
    expect(shaEl).not.toBeNull();
    // Drawer renders FULL sha — truncation is matrix-grid-only (SAD §7
    // full-attribute disclosure rule). The matrix grid truncates to 7 chars
    // + ellipsis; the drawer is the full-fidelity surface.
    expect(shaEl.textContent?.trim()).toBe('9f1c0d2e8a');
    expect(shaEl.getAttribute('title')).toBe('9f1c0d2e8a');
    expect(fixture.nativeElement.textContent).not.toContain('null');
    expect(fixture.nativeElement.textContent).not.toContain('undefined');
  });

  it('drawer keeps the ref/sha testid anchors visible with empty text when neither is populated', () => {
    // service-d/qa fixture: ref/sha both absent on current. Per the
    // Full-attribute disclosure rule the testid anchors remain in the DOM;
    // their text is empty and the literal "null" never appears.
    const fixture = TestBed.createComponent(HistoryDrawerComponent);
    const svc = FIXTURE_SERVICES.find(s => s.id === 'service-d')!;
    const env = FIXTURE_ENVIRONMENTS.find(e => e.id === 'qa')!;
    store.openDrawer(svc, env);
    fixture.detectChanges();
    const refEl = fixture.nativeElement.querySelector(
      '[data-testid="drawer-current-ref"]'
    ) as HTMLElement | null;
    const shaEl = fixture.nativeElement.querySelector(
      '[data-testid="drawer-current-sha"]'
    ) as HTMLElement | null;
    expect(refEl).not.toBeNull();
    expect(shaEl).not.toBeNull();
    expect(refEl!.textContent?.trim()).toBe('');
    expect(shaEl!.textContent?.trim()).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain('null');
    expect(fixture.nativeElement.textContent).not.toContain('undefined');
  });

  // SAD §7 — "Full-attribute disclosure rule": the drawer always renders
  // every deployment attribute available to the user, regardless of the
  // matrix attribute picker. Verified across the picker keys plus the
  // absolute deployed_at timestamp (drawer-only) and the nullable ref/sha.
  it('always renders every attribute regardless of the matrix attribute picker', () => {
    // Strip every attribute from every view.
    (['detailed', 'compact', 'glance', 'focus'] as const).forEach(v => {
      store.setAttrsForView(v, []);
    });
    const fixture = TestBed.createComponent(HistoryDrawerComponent);
    const svc = FIXTURE_SERVICES.find(s => s.id === 'service-a')!;
    const env = FIXTURE_ENVIRONMENTS.find(e => e.id === 'dev')!;
    store.openDrawer(svc, env);
    fixture.detectChanges();

    const current = fixture.nativeElement.querySelector(
      '[data-testid="drawer-current"]'
    ) as HTMLElement;
    expect(current).not.toBeNull();

    const text = current.textContent ?? '';
    // status badge (running… for the in-progress slot)
    expect(text).toContain('running');
    // version
    expect(text).toContain('v2.3.2');
    // run number
    expect(current.querySelector('a[href]')).not.toBeNull();
    expect(text).toContain('#1251');
    // actor
    expect(text).toContain('john.doe');
    // ref / sha (populated on service-a/dev) — full-attribute disclosure.
    // Drawer renders FULL sha, not the matrix-grid truncated 7-char form.
    expect(text).toContain('feature/login-revamp');
    expect(text).toContain('9f1c0d2e8a');
    // absolute deployed_at (drawer-only) — formatDateTime renders the month name.
    expect(text).toMatch(/May \d{2}, 2026/);
    // relative ago — derived from the same helper used in the template so the
    // assertion stays valid as the clock advances.
    const currentSlot = FIXTURE_MATRIX['service-a']['dev']!;
    const currentAgo = relativeTime(currentSlot.current.deployedAt);
    expect(currentAgo).not.toBe('');
    const currentAgoEl = current.querySelector(
      '[data-testid="drawer-current-ago"]'
    ) as HTMLElement | null;
    expect(currentAgoEl?.textContent?.trim()).toBe(currentAgo);

    // Last-successful panel — same disclosure rule for ago + absolute.
    const lastPanel = fixture.nativeElement.querySelector(
      '[data-testid="drawer-last-successful"]'
    ) as HTMLElement;
    expect(lastPanel).not.toBeNull();
    expect(lastPanel.textContent ?? '').toMatch(/May \d{2}, 2026/);
    const lastSlot = currentSlot.lastSuccessful!;
    const lastAgo = relativeTime(lastSlot.deployedAt);
    const lastAgoEl = lastPanel.querySelector(
      '[data-testid="drawer-last-successful-ago"]'
    ) as HTMLElement | null;
    expect(lastAgoEl?.textContent?.trim()).toBe(lastAgo);
  });
});
