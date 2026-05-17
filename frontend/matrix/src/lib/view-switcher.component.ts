// View switcher — segmented control with the four FR-12 layout views.
// Visual treatment mirrors the canonical mockup (docs/ui/deployment-dashboard.html
// lines 138–152). Labels + descriptions come from view-config.ts, never
// inline — per the declarative-configuration rule.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DeploymentMatrixStore,
  VIEWS,
  type ViewId
} from '@dd/shared';

@Component({
  selector: 'dd-view-switcher',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-center text-xs border border-gray-200 rounded-md overflow-hidden"
      data-testid="view-switcher"
      role="tablist"
      aria-label="Matrix layout view"
    >
      @for (v of views; track v.id) {
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="store.view() === v.id"
          [attr.data-testid]="'view-option-' + v.id"
          [attr.data-active]="store.view() === v.id"
          [title]="v.description"
          [class]="buttonClass(v.id)"
          (click)="store.setView(v.id)"
        >{{ v.label }}</button>
      }
    </div>
  `
})
export class ViewSwitcherComponent {
  readonly store = inject(DeploymentMatrixStore);
  readonly views = VIEWS;

  buttonClass(id: ViewId): string {
    const base = 'px-2.5 py-1.5 font-medium border-r border-gray-200 last:border-r-0 transition-colors';
    return this.store.view() === id
      ? `${base} bg-blue-600 text-white`
      : `${base} bg-white text-gray-600 hover:bg-gray-50`;
  }
}
