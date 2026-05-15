// FR-05 + FR-12 — null-render invariant for nullable attributes (ref / sha)
// and sha truncation rule.
//
// SAD §7 "Null-render invariant for nullable attributes" — when ref / sha
// are null OR absent, the attribute slot renders empty in the box body.
// The literal string "null" / "undefined" MUST never appear in the DOM.
//
// SAD §7 "Attribute vocabulary" → sha — display MAY truncate to the first
// 7 chars (convention: short SHA + U+2026). Full value in the `title`
// attribute (drawer carries the full value too — full-attribute disclosure
// rule).
//
// Covers all four matrix-leaf renderers: Detailed (StageBox), Compact,
// Glance, Focus (collapsed).

import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  FIXTURE_ENVIRONMENTS,
  FIXTURE_SERVICES,
  type EnvironmentDescriptor,
  type ServiceDescriptor,
  type SlotState
} from '@dd/shared';
import { StageBoxComponent } from './stage-box.component';
import { CompactRowComponent } from './compact-row.component';
import { GlanceRowComponent } from './glance-row.component';
import { FocusRowComponent } from './focus-row.component';

// Service / env we use for every test. Empty fixture matrix is fine — the
// host components synthesise their own slot input.
const SVC: ServiceDescriptor = FIXTURE_SERVICES[0];
const ENV: EnvironmentDescriptor = FIXTURE_ENVIRONMENTS[0];

function makeSlot(extras: { ref?: string | null; sha?: string | null }): SlotState {
  return {
    current: {
      deploymentId: 'gh-1',
      version: 'v1.0.0',
      status: 'success',
      runUrl: '#',
      runNumber: 1,
      actor: 'octocat',
      deployedAt: '2026-05-14T12:00:00Z',
      parentDeployments: [],
      ...extras
    },
    lastSuccessful: null,
    previousFailed: false
  };
}

@Component({
  standalone: true,
  imports: [StageBoxComponent],
  template: `<dd-stage-box [service]="svc()" [env]="env()" [slot]="slot()"></dd-stage-box>`
})
class StageBoxHost {
  svc = signal<ServiceDescriptor>(SVC);
  env = signal<EnvironmentDescriptor>(ENV);
  slot = signal<SlotState | null>(null);
}

function renderStageBox(slot: SlotState, attrs: ('ref'|'sha')[]) {
  TestBed.configureTestingModule({
    imports: [StageBoxHost],
    providers: [provideZonelessChangeDetection()]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  // Replace Detailed attrs with just ref / sha to isolate the new slots.
  store.setAttrsForView('detailed', attrs);
  store.setView('detailed');
  const fixture = TestBed.createComponent(StageBoxHost);
  fixture.componentInstance.slot.set(slot);
  fixture.detectChanges();
  return { fixture, store };
}

describe('Null-render invariant — ref / sha (SAD §7)', () => {
  describe('StageBox (Detailed)', () => {
    it('ref slot is empty when ref is null', () => {
      const { fixture } = renderStageBox(makeSlot({ ref: null }), ['ref']);
      const ref = fixture.nativeElement.querySelector(
        '[data-testid="current-ref-service-a-dev"]'
      ) as HTMLElement;
      expect(ref).not.toBeNull();
      // Trimmed text must be empty — never "null".
      expect(ref.textContent?.trim()).toBe('');
      // Title is the same empty rendering, never "null".
      const title = ref.getAttribute('title') ?? '';
      expect(title).toBe('');
      expect(fixture.nativeElement.textContent).not.toContain('null');
      expect(fixture.nativeElement.textContent).not.toContain('undefined');
    });

    it('ref slot is empty when ref is absent (undefined)', () => {
      const { fixture } = renderStageBox(makeSlot({}), ['ref']);
      const ref = fixture.nativeElement.querySelector(
        '[data-testid="current-ref-service-a-dev"]'
      ) as HTMLElement;
      expect(ref).not.toBeNull();
      expect(ref.textContent?.trim()).toBe('');
      expect(fixture.nativeElement.textContent).not.toContain('null');
      expect(fixture.nativeElement.textContent).not.toContain('undefined');
    });

    it('ref renders the actual value when populated', () => {
      const { fixture } = renderStageBox(
        makeSlot({ ref: 'feature/login-revamp' }), ['ref']
      );
      const ref = fixture.nativeElement.querySelector(
        '[data-testid="current-ref-service-a-dev"]'
      ) as HTMLElement;
      expect(ref.textContent?.trim()).toBe('feature/login-revamp');
      expect(ref.getAttribute('title')).toBe('feature/login-revamp');
    });

    it('sha slot is empty when sha is null', () => {
      const { fixture } = renderStageBox(makeSlot({ sha: null }), ['sha']);
      const sha = fixture.nativeElement.querySelector(
        '[data-testid="current-sha-service-a-dev"]'
      ) as HTMLElement;
      expect(sha).not.toBeNull();
      expect(sha.textContent?.trim()).toBe('');
      expect(sha.getAttribute('title')).toBe('');
      expect(fixture.nativeElement.textContent).not.toContain('null');
      expect(fixture.nativeElement.textContent).not.toContain('undefined');
    });

    it('sha is truncated to 7 chars + ellipsis with full value in title', () => {
      const fullSha = '9f1c0d2e8a4b5d6c';
      const { fixture } = renderStageBox(
        makeSlot({ sha: fullSha }), ['sha']
      );
      const sha = fixture.nativeElement.querySelector(
        '[data-testid="current-sha-service-a-dev"]'
      ) as HTMLElement;
      expect(sha.textContent?.trim()).toBe('9f1c0d2…');
      expect(sha.getAttribute('title')).toBe(fullSha);
    });

    it('sha values ≤ 7 chars render verbatim (no trailing ellipsis)', () => {
      const { fixture } = renderStageBox(
        makeSlot({ sha: '9f1c0d2' }), ['sha']
      );
      const sha = fixture.nativeElement.querySelector(
        '[data-testid="current-sha-service-a-dev"]'
      ) as HTMLElement;
      expect(sha.textContent?.trim()).toBe('9f1c0d2');
    });

    it('Detailed view holds all seven attributes when picker is full', () => {
      const slot = makeSlot({
        ref: 'main',
        sha: 'deadbeefcafe1234'
      });
      TestBed.configureTestingModule({
        imports: [StageBoxHost],
        providers: [provideZonelessChangeDetection()]
      });
      const store = TestBed.inject(DeploymentMatrixStore);
      store.setAttrsForView('detailed', [
        'status', 'version', 'run', 'ago', 'actor', 'ref', 'sha'
      ]);
      const fixture = TestBed.createComponent(StageBoxHost);
      fixture.componentInstance.slot.set(slot);
      fixture.detectChanges();
      const id = '-service-a-dev';
      expect(fixture.nativeElement.querySelector(`[data-testid="current-version${id}"]`)).not.toBeNull();
      expect(fixture.nativeElement.querySelector(`[data-testid="current-actor${id}"]`)).not.toBeNull();
      expect(fixture.nativeElement.querySelector(`[data-testid="current-ref${id}"]`)).not.toBeNull();
      expect(fixture.nativeElement.querySelector(`[data-testid="current-sha${id}"]`)).not.toBeNull();
      expect(fixture.nativeElement.querySelector(`[data-testid="run-link-current${id}"]`)).not.toBeNull();
    });
  });

  describe('CompactRow', () => {
    function setupCompact(slot: SlotState, attrs: ('ref'|'sha')[]) {
      TestBed.configureTestingModule({
        imports: [CompactRowComponent],
        providers: [provideZonelessChangeDetection()]
      });
      const store = TestBed.inject(DeploymentMatrixStore);
      store.setServices([SVC]);
      store.setEnvironments([ENV]);
      store.setMatrix({ [SVC.id]: { [ENV.id]: slot } });
      store.setView('compact');
      // Only render the new attribute(s).
      store.setAttrsForView('compact', attrs);
      const fixture = TestBed.createComponent(CompactRowComponent);
      fixture.componentRef.setInput('service', SVC);
      fixture.componentRef.setInput('envs', [ENV]);
      fixture.detectChanges();
      return fixture;
    }

    it('ref slot empty + no literal "null" when ref is null', () => {
      const fixture = setupCompact(makeSlot({ ref: null }), ['ref']);
      const ref = fixture.nativeElement.querySelector(
        '[data-testid="current-ref-service-a-dev"]'
      ) as HTMLElement;
      expect(ref).not.toBeNull();
      expect(ref.textContent?.trim()).toBe('');
      expect(fixture.nativeElement.textContent).not.toContain('null');
    });

    it('sha truncated + full value in title', () => {
      const fullSha = '7e3f9a0b22deadbeef';
      const fixture = setupCompact(makeSlot({ sha: fullSha }), ['sha']);
      const sha = fixture.nativeElement.querySelector(
        '[data-testid="current-sha-service-a-dev"]'
      ) as HTMLElement;
      expect(sha.textContent?.trim()).toBe('7e3f9a0…');
      expect(sha.getAttribute('title')).toBe(fullSha);
    });
  });

  describe('GlanceRow', () => {
    function setupGlance(slot: SlotState, attr: 'ref' | 'sha') {
      TestBed.configureTestingModule({
        imports: [GlanceRowComponent],
        providers: [provideZonelessChangeDetection()]
      });
      const store = TestBed.inject(DeploymentMatrixStore);
      store.setServices([SVC]);
      store.setEnvironments([ENV]);
      store.setMatrix({ [SVC.id]: { [ENV.id]: slot } });
      store.setView('glance');
      // Cap of 1 — replace the single default with ref or sha.
      store.setAttrsForView('glance', [attr]);
      const fixture = TestBed.createComponent(GlanceRowComponent);
      fixture.componentRef.setInput('service', SVC);
      fixture.componentRef.setInput('envs', [ENV]);
      fixture.detectChanges();
      return fixture;
    }

    it('Glance pill — ref renders verbatim when populated', () => {
      const fixture = setupGlance(makeSlot({ ref: 'main' }), 'ref');
      const ref = fixture.nativeElement.querySelector(
        '[data-testid="current-ref-service-a-dev"]'
      ) as HTMLElement;
      expect(ref).not.toBeNull();
      expect(ref.textContent?.trim()).toBe('main');
    });

    it('Glance pill — ref empty when null, no literal "null"', () => {
      const fixture = setupGlance(makeSlot({ ref: null }), 'ref');
      const ref = fixture.nativeElement.querySelector(
        '[data-testid="current-ref-service-a-dev"]'
      ) as HTMLElement;
      expect(ref).not.toBeNull();
      expect(ref.textContent?.trim()).toBe('');
      expect(fixture.nativeElement.textContent).not.toContain('null');
    });

    it('Glance pill — sha truncated to short form', () => {
      const fixture = setupGlance(makeSlot({ sha: 'cafebabecafebabe' }), 'sha');
      const sha = fixture.nativeElement.querySelector(
        '[data-testid="current-sha-service-a-dev"]'
      ) as HTMLElement;
      expect(sha.textContent?.trim()).toBe('cafebab…');
      expect(sha.getAttribute('title')).toBe('cafebabecafebabe');
    });
  });

  describe('FocusRow (collapsed)', () => {
    function setupFocus(slot: SlotState, attrs: ('ref'|'sha')[]) {
      TestBed.configureTestingModule({
        imports: [FocusRowComponent],
        providers: [provideZonelessChangeDetection()]
      });
      const store = TestBed.inject(DeploymentMatrixStore);
      store.setServices([SVC]);
      store.setEnvironments([ENV]);
      store.setMatrix({ [SVC.id]: { [ENV.id]: slot } });
      store.setView('focus');
      store.setAttrsForView('focus', attrs);
      const fixture = TestBed.createComponent(FocusRowComponent);
      fixture.componentRef.setInput('service', SVC);
      fixture.componentRef.setInput('envs', [ENV]);
      fixture.detectChanges();
      return fixture;
    }

    it('collapsed ref slot empty + no literal "null"', () => {
      const fixture = setupFocus(makeSlot({ ref: null }), ['ref']);
      const ref = fixture.nativeElement.querySelector(
        '[data-testid="current-ref-service-a-dev"]'
      ) as HTMLElement;
      expect(ref).not.toBeNull();
      expect(ref.textContent?.trim()).toBe('');
      expect(fixture.nativeElement.textContent).not.toContain('null');
    });

    it('collapsed sha truncated to short form with full title', () => {
      const fixture = setupFocus(makeSlot({ sha: '1234567890abcdef' }), ['sha']);
      const sha = fixture.nativeElement.querySelector(
        '[data-testid="current-sha-service-a-dev"]'
      ) as HTMLElement;
      expect(sha.textContent?.trim()).toBe('1234567…');
      expect(sha.getAttribute('title')).toBe('1234567890abcdef');
    });
  });
});
