/**
 * PatternFilterComponent unit tests.
 *
 * Covers:
 *   - Mode switching (exclude / include)
 *   - Adding a chip: via Enter key, via dropdown click, via blur
 *   - Removing a chip
 *   - Autocomplete filtering
 *   - Glob verbatim row shown/hidden
 *   - No duplicate chips
 *   - Caption display
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal }          from '@angular/core';
import { PatternFilterComponent }     from './pattern-filter.component';

// ── Host wrapper for testing signal inputs ─────────────────────────────────

@Component({
  template: `
    <app-pattern-filter
      [mode]="mode()"
      [patterns]="patterns()"
      [suggestions]="suggestions()"
      [caption]="caption()"
      (modeChange)="onModeChange($event)"
      (patternsChange)="onPatternsChange($event)"
    />
  `,
  standalone: true,
  imports: [PatternFilterComponent],
})
class HostComponent {
  readonly mode        = signal<'exclude' | 'include'>('exclude');
  readonly patterns    = signal<string[]>([]);
  readonly suggestions = signal<string[]>(['auth-svc', 'payments-api', 'order-api', 'frontend']);
  readonly caption     = signal<string>('Showing all 4 services');

  lastEmittedMode: 'exclude' | 'include' | null     = null;
  lastEmittedPatterns: string[] | null               = null;

  onModeChange(m: 'exclude' | 'include'): void {
    this.lastEmittedMode = m;
    this.mode.set(m);
  }
  onPatternsChange(p: string[]): void {
    this.lastEmittedPatterns = p;
    this.patterns.set(p);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function q(fix: ComponentFixture<HostComponent>, sel: string): HTMLElement | null {
  return fix.nativeElement.querySelector(sel);
}

function qAll(fix: ComponentFixture<HostComponent>, sel: string): HTMLElement[] {
  return Array.from(fix.nativeElement.querySelectorAll(sel));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PatternFilterComponent', () => {
  let fix: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fix = TestBed.createComponent(HostComponent);
    host = fix.componentInstance;
    fix.detectChanges();
  });

  // ── Mode toggle ────────────────────────────────────────────

  it('renders two mode buttons, exclude active by default', () => {
    const btns = qAll(fix, '.pf-mode-btn');
    expect(btns.length).toBe(2);
    expect(btns[0].classList).toContain('is-active');
    expect(btns[1].classList).not.toContain('is-active');
  });

  it('clicking inactive mode button emits modeChange', () => {
    const btns = qAll(fix, '.pf-mode-btn');
    btns[1].click();
    fix.detectChanges();
    expect(host.lastEmittedMode).toBe('include');
  });

  it('clicking active mode button does not emit', () => {
    const btns = qAll(fix, '.pf-mode-btn');
    btns[0].click();
    fix.detectChanges();
    expect(host.lastEmittedMode).toBeNull();
  });

  // ── Add chip via "+ add pattern" → Enter ────────────────────

  it('clicking "+ add pattern" shows the input', () => {
    expect(q(fix, '.pf-input')).toBeNull();
    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();
    expect(q(fix, '.pf-input')).not.toBeNull();
  });

  it('typing a name and pressing Enter emits patternsChange with new chip', () => {
    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();

    const input = q(fix, '.pf-input') as HTMLInputElement;
    input.value = 'auth-svc';
    input.dispatchEvent(new Event('input'));
    fix.detectChanges();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fix.detectChanges();

    expect(host.lastEmittedPatterns).toEqual(['auth-svc']);
  });

  it('hides the input after committing', () => {
    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();

    const input = q(fix, '.pf-input') as HTMLInputElement;
    input.value = 'auth-svc';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fix.detectChanges();

    expect(q(fix, '.pf-input')).toBeNull();
  });

  it('does not add duplicate chip', () => {
    host.patterns.set(['auth-svc']);
    fix.detectChanges();

    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();

    const input = q(fix, '.pf-input') as HTMLInputElement;
    input.value = 'auth-svc';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fix.detectChanges();

    // patternsChange was not emitted (no duplicate)
    expect(host.lastEmittedPatterns).toBeNull();
  });

  it('Escape key closes the input', () => {
    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();
    expect(q(fix, '.pf-input')).not.toBeNull();

    const input = q(fix, '.pf-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fix.detectChanges();

    expect(q(fix, '.pf-input')).toBeNull();
  });

  // ── Remove chip ────────────────────────────────────────────

  it('renders chips for each pattern', () => {
    host.patterns.set(['auth-svc', '*-api']);
    fix.detectChanges();
    const chips = qAll(fix, '.pf-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain('auth-svc');
    expect(chips[1].textContent).toContain('*-api');
  });

  it('clicking × on a chip emits patternsChange without that chip', () => {
    host.patterns.set(['auth-svc', '*-api']);
    fix.detectChanges();

    const removeBtn = q(fix, '.pf-chip-x') as HTMLElement;
    removeBtn.click();
    fix.detectChanges();

    expect(host.lastEmittedPatterns).toEqual(['*-api']);
  });

  // ── Autocomplete dropdown ──────────────────────────────────

  it('shows autocomplete suggestions matching the typed query', () => {
    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();

    const input = q(fix, '.pf-input') as HTMLInputElement;
    input.value = 'api';
    input.dispatchEvent(new Event('input'));
    fix.detectChanges();

    const items = qAll(fix, '.pf-ac-item');
    expect(items.length).toBe(2); // payments-api, order-api
    expect(items[0].textContent?.trim()).toBe('payments-api');
    expect(items[1].textContent?.trim()).toBe('order-api');
  });

  it('shows all suggestions (up to 8) when no query', () => {
    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();
    // No input change — empty query shows all available
    const items = qAll(fix, '.pf-ac-item');
    expect(items.length).toBe(4); // all 4 suggestions
  });

  it('excludes already-added patterns from suggestions', () => {
    host.patterns.set(['auth-svc']);
    fix.detectChanges();

    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();

    const items = qAll(fix, '.pf-ac-item');
    const texts = items.map((i) => i.textContent?.trim());
    expect(texts).not.toContain('auth-svc');
  });

  it('clicking a suggestion item emits patternsChange', () => {
    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();

    const item = q(fix, '.pf-ac-item') as HTMLElement;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fix.detectChanges();

    expect(host.lastEmittedPatterns).toEqual([item.textContent?.trim() ?? '']);
  });

  // ── Glob verbatim row ──────────────────────────────────────

  it('shows verbatim glob row when query contains *', () => {
    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();

    const input = q(fix, '.pf-input') as HTMLInputElement;
    input.value = '*-api';
    input.dispatchEvent(new Event('input'));
    fix.detectChanges();

    const firstItem = q(fix, '.pf-ac-item');
    expect(firstItem?.textContent).toContain('*-api');
    expect(firstItem?.textContent).toContain('glob pattern');
  });

  it('shows verbatim glob row when query contains ?', () => {
    q(fix, '.pf-add-btn')!.click();
    fix.detectChanges();

    const input = q(fix, '.pf-input') as HTMLInputElement;
    input.value = 'auth?svc';
    input.dispatchEvent(new Event('input'));
    fix.detectChanges();

    const firstItem = q(fix, '.pf-ac-item');
    expect(firstItem?.textContent).toContain('auth?svc');
    expect(firstItem?.textContent).toContain('glob pattern');
  });

  // ── Caption ────────────────────────────────────────────────

  it('renders the caption text', () => {
    const caption = q(fix, '.pf-caption');
    expect(caption?.textContent?.trim()).toBe('Showing all 4 services');
  });

  it('hides caption element when caption is empty', () => {
    host.caption.set('');
    fix.detectChanges();
    expect(q(fix, '.pf-caption')).toBeNull();
  });
});
