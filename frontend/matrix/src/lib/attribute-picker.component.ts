// Attribute picker — Display <n>/<max> popover with the five FR-02 picker
// attributes. Cap enforcement: when the active view's cap is reached,
// unchecked boxes render disabled (the store also enforces this on its
// `toggleAttr` action — defence in depth). Always-on helper text + the
// Focus-specific note come from view-config.ts.
//
// Visual treatment mirrors the mockup (docs/deployment-dashboard.html
// lines 154–202).

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ATTRIBUTES,
  DeploymentMatrixStore,
  VIEW_BY_ID,
  type AttrKey
} from '@dd/shared';

@Component({
  selector: 'dd-attribute-picker',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative" data-testid="attribute-picker">
      <button
        type="button"
        class="flex items-center gap-1.5 text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 hover:bg-gray-50"
        [attr.aria-expanded]="open()"
        [attr.aria-haspopup]="'true'"
        [title]="buttonTitle()"
        data-testid="picker-button"
        (click)="toggleOpen($event)"
      >
        <svg class="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M3 12h18M3 20h18" />
        </svg>
        <span class="font-medium">Display</span>
        <span class="text-gray-400" data-testid="picker-counter">{{ counter() }}</span>
        <svg class="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      @if (open()) {
        <div
          class="absolute right-0 mt-1 w-72 bg-white border border-gray-200 rounded-md shadow-lg p-3 z-50"
          data-testid="picker-popover"
          role="dialog"
          aria-label="Attribute picker"
        >
          <p class="text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-1">
            <span data-testid="picker-view-label">{{ activeView().label }}</span> view ·
            <span data-testid="picker-counter-popover">{{ counter() }}</span> shown
          </p>
          <p
            class="text-[11px] text-gray-500 leading-snug mb-2"
            data-testid="picker-hint"
          >{{ activeView().attrHint }}</p>

          <div class="space-y-1.5">
            @for (a of attrs; track a.key) {
              <label
                class="flex items-start gap-2 text-sm cursor-pointer select-none"
                [class.opacity-40]="isDisabled(a.key)"
                [class.cursor-not-allowed]="isDisabled(a.key)"
                [class.hover:bg-gray-50]="!isDisabled(a.key)"
                [class.rounded]="!isDisabled(a.key)"
                [class.px-1]="!isDisabled(a.key)"
                [class.-mx-1]="!isDisabled(a.key)"
              >
                <input
                  type="checkbox"
                  class="mt-0.5 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
                  [attr.data-testid]="'attr-checkbox-' + a.key"
                  [checked]="isSelected(a.key)"
                  [disabled]="isDisabled(a.key)"
                  (change)="toggle(a.key)"
                />
                <span class="flex-1">
                  <span class="font-medium text-gray-800">{{ a.label }}</span>
                  <span class="block text-[11px] text-gray-400">{{ a.description }}</span>
                </span>
              </label>
            }
          </div>

          <p
            class="text-[10px] text-gray-400 italic mt-2 leading-tight"
            data-testid="picker-always-on-note"
          >
            Status colour, ⚠ prev. failed badge, and last-successful split are always shown.
          </p>
          @if (store.view() === 'focus') {
            <p
              class="text-[10px] text-gray-400 italic mt-1 leading-tight"
              data-testid="picker-focus-note"
            >Expanded rows always show all seven attributes.</p>
          }
        </div>
      }
    </div>
  `
})
export class AttributePickerComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly store = inject(DeploymentMatrixStore);
  readonly attrs = ATTRIBUTES;

  readonly open = signal(false);

  readonly activeView = computed(() => VIEW_BY_ID[this.store.view()]);

  readonly counter = computed(
    () => `${this.store.attrsSelectedCount()}/${this.store.cap()}`
  );

  readonly buttonTitle = computed(
    () => `Choose which attributes to display on the matrix for the ${this.activeView().label} view`
  );

  toggleOpen(ev: MouseEvent): void {
    ev.stopPropagation();
    this.open.update(v => !v);
  }

  /** Click-outside closes the popover. */
  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.open()) return;
    const target = ev.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.open.set(false);
    }
  }

  isSelected(key: AttrKey): boolean {
    return this.store.activeAttrs().includes(key);
  }

  isDisabled(key: AttrKey): boolean {
    // Cap enforcement: a new (unselected) key can't be added once the cap
    // is reached. Already-selected keys can always be toggled off.
    return !this.isSelected(key) &&
      this.store.attrsSelectedCount() >= this.store.cap();
  }

  toggle(key: AttrKey): void {
    this.store.toggleAttr(this.store.view(), key);
  }
}
