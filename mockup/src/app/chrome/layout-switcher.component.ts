// Hand-authored visual mirror of <dd-layout-switcher>.
// Static: shows 'swim-lane' as the active layout (mockup default).

import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'dd-mockup-layout-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5" data-testid="layout-switcher">
      <span class="px-2.5 py-1 rounded-md text-xs font-medium bg-purple-600 text-white shadow-sm"
            data-testid="layout-option-swim-lane">Swim-lane</span>
      <span class="px-2.5 py-1 rounded-md text-xs font-medium text-gray-600"
            data-testid="layout-option-workflow-rows">Workflow-rows</span>
    </div>
  `
})
export class LayoutSwitcherComponent {}
