// Theme switcher — gear icon button + popover with Light / Dark / Auto
// radios. Mirrors docs/deployment-dashboard.html lines 1099-1145 (the
// `data-testid="theme-switcher"` block).
//
// Lives in `shared/` because palette is a cross-cutting concern and the
// component is self-contained — it injects `ThemeService` (also in
// `shared/`) and emits no upward events. Per CLAUDE.md frontend rules:
// `shared/` is for cross-cutting concerns; `shared/` may not depend on
// any feature library.
//
// CSS for `.theme-gear-btn` and `.theme-popover` is mirrored verbatim from
// the mockup into `dashboard/src/styles.css`.

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from './theme.service';
import {
  THEMES,
  type ThemePreference
} from './view-config';

@Component({
  selector: 'dd-theme-switcher',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative" data-testid="theme-switcher">
      <button
        type="button"
        class="theme-gear-btn"
        [class.open]="open()"
        [attr.aria-expanded]="open() ? 'true' : 'false'"
        [attr.aria-haspopup]="'dialog'"
        [title]="gearTitle()"
        data-testid="theme-gear"
        (click)="toggle($event)"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>

      @if (open()) {
        <div
          class="theme-popover"
          role="dialog"
          aria-label="Theme"
          data-testid="theme-popover"
        >
          <h4>Theme</h4>
          @for (t of themes; track t.id) {
            <label>
              <input
                type="radio"
                name="dd-theme"
                [value]="t.id"
                [checked]="theme.preference() === t.id"
                [attr.aria-checked]="theme.preference() === t.id"
                [attr.data-testid]="'theme-option-' + t.id"
                (change)="select(t.id)"
              />
              <span>{{ t.label }}</span>
              <span class="ml-auto text-[11px] theme-popover-hint">{{ t.hint }}</span>
            </label>
          }
          <div class="theme-popover-foot">
            Effective <span class="v" data-testid="theme-effective">{{ theme.effective() }}</span>
            ·
            OS <span class="v" data-testid="theme-os">{{ osLabel() }}</span>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    /* Inline hint colour falls back via the same custom property the
       popover host uses; no need to duplicate dark tokens here. */
    .theme-popover-hint { color: var(--theme-popover-muted-fg, #9ca3af); }
  `]
})
export class ThemeSwitcherComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly theme = inject(ThemeService);

  readonly themes = THEMES;
  readonly open = signal(false);

  readonly gearTitle = computed(
    () => `Theme: ${this.theme.preference()} · effective ${this.theme.effective()}`
  );

  /**
   * OS-reported palette label rendered inside the popover footer.
   * Always surfaces the LIVE OS preference (the MQL listener inside
   * `ThemeService` keeps `osDark` current), regardless of whether the
   * user has overridden the palette with Light/Dark. Mirrors the
   * mockup's `osDark ? 'dark' : 'light'` ternary
   * (docs/deployment-dashboard.html line 1142).
   */
  readonly osLabel = computed<'light' | 'dark'>(() =>
    this.theme.osDark() ? 'dark' : 'light'
  );

  toggle(ev: MouseEvent): void {
    ev.stopPropagation();
    this.open.update(v => !v);
  }

  select(id: ThemePreference): void {
    this.theme.setPreference(id);
    // Popover stays open after a pick so the user can preview multiple
    // options without re-clicking the gear. Click-outside / Escape close it.
  }

  /** Click-outside → close. */
  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.open()) return;
    const target = ev.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.open.set(false);
    }
  }

  /** Escape → close (only when open, to avoid swallowing global Esc). */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.open.set(false);
  }
}
