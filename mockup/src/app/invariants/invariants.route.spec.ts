// Minimal spec — asserts InvariantsRouteComponent renders the page and at least
// one active invariant entry, without requiring a full router harness.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InvariantsRouteComponent } from './invariants.route';
import { ACTIVE_INVARIANTS, DEFERRED_INVARIANTS, VIEW_EXCEPTIONS, SEVERITY_BANDS } from '../fixtures/invariants-data';

describe('InvariantsRouteComponent', () => {
  let fixture: ComponentFixture<InvariantsRouteComponent>;
  let component: InvariantsRouteComponent;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvariantsRouteComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(InvariantsRouteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the page container', () => {
    expect(el.querySelector('[data-testid="invariants-page"]')).toBeTruthy();
  });

  it('should render the page title', () => {
    const title = el.querySelector('[data-testid="invariants-page-title"]');
    expect(title).toBeTruthy();
    expect(title!.textContent).toContain('invariants');
  });

  it('should render the active invariants table', () => {
    expect(el.querySelector('[data-testid="active-invariants-table"]')).toBeTruthy();
  });

  it('should render all active invariant rows', () => {
    const rows = el.querySelectorAll('[data-testid^="invariant-row-"]');
    expect(rows.length).toBe(ACTIVE_INVARIANTS.length);
  });

  it('should render the first active invariant label (I0)', () => {
    const labelEl = el.querySelector('[data-testid="invariant-label-I0-connector-orphan-no-target"]');
    expect(labelEl).toBeTruthy();
    expect(labelEl!.textContent).toContain('Connector resolves to a target box');
  });

  it('should render I12 rate-limit cluster invariant', () => {
    const labelEl = el.querySelector('[data-testid="invariant-label-I12-rate-limit-cluster"]');
    expect(labelEl).toBeTruthy();
    expect(labelEl!.textContent).toContain('Rate-limit cluster');
  });

  it('should render 12 active invariants (I0–I10 + I12)', () => {
    expect(ACTIVE_INVARIANTS.length).toBe(12);
    const rows = el.querySelectorAll('[data-testid^="invariant-row-"]');
    expect(rows.length).toBe(12);
  });

  it('should render the deferred invariants section', () => {
    expect(el.querySelector('[data-testid="deferred-invariants-section"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="deferred-invariants-table"]')).toBeTruthy();
  });

  it('should render I11 as the sole deferred invariant', () => {
    const rows = el.querySelectorAll('[data-testid^="deferred-invariant-row-"]');
    expect(rows.length).toBe(DEFERRED_INVARIANTS.length);
    expect(rows.length).toBe(1);
    const idEl = el.querySelector('[data-testid="deferred-invariant-id-I11-matrix-focus-env-header-alignment"]');
    expect(idEl).toBeTruthy();
  });

  it('should render the view exceptions section with at least one exception', () => {
    expect(el.querySelector('[data-testid="view-exceptions-table"]')).toBeTruthy();
    expect(VIEW_EXCEPTIONS.length).toBeGreaterThanOrEqual(1);
    const rows = el.querySelectorAll('[data-testid^="view-exception-"]');
    expect(rows.length).toBe(VIEW_EXCEPTIONS.length);
  });

  it('should render the severity bands section with 4 bands', () => {
    expect(el.querySelector('[data-testid="severity-bands-table"]')).toBeTruthy();
    expect(SEVERITY_BANDS.length).toBe(4);
    const rows = el.querySelectorAll('[data-testid^="severity-band-"]');
    expect(rows.length).toBe(4);
  });

  it('should render green severity band', () => {
    const band = el.querySelector('[data-testid="severity-band-green"]');
    expect(band).toBeTruthy();
    expect(band!.textContent).toContain('green');
  });
});
