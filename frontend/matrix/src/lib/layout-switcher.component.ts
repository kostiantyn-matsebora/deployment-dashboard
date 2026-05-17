// FR-13 — Layout switcher segmented control. Sits in the header next to
// the view switcher. Three options: Matrix / Swim-lane / Workflow rows.
//
// Visual treatment mirrors the canonical mockup (docs/ui/deployment-dashboard.html
// lines 650–665) — same shape as the view switcher, distinct purple-600
// active fill so the two segmented controls are visually distinguishable.
// Labels + intents come from view-config.ts (declarative configuration only).

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DeploymentMatrixStore,
  LAYOUTS,
  type LayoutId
} from '@dd/shared';

@Component({
  selector: 'dd-layout-switcher',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-center text-xs border border-gray-200 rounded-md overflow-hidden"
      data-testid="layout-switcher"
      role="tablist"
      aria-label="Dashboard layout"
    >
      @for (l of layouts; track l.id) {
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="store.layout() === l.id"
          [attr.data-testid]="'layout-option-' + l.id"
          [attr.data-active]="store.layout() === l.id"
          [title]="l.intent"
          [class]="buttonClass(l.id)"
          (click)="store.setLayout(l.id)"
        >{{ l.label }}</button>
      }
    </div>
  `
})
export class LayoutSwitcherComponent {
  readonly store = inject(DeploymentMatrixStore);
  readonly layouts = LAYOUTS;

  buttonClass(id: LayoutId): string {
    const base = 'px-2.5 py-1.5 font-medium border-r border-gray-200 last:border-r-0 transition-colors';
    return this.store.layout() === id
      ? `${base} bg-purple-600 text-white`
      : `${base} bg-white text-gray-600 hover:bg-gray-50`;
  }
}
