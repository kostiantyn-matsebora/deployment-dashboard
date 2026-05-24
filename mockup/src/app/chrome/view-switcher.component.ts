// Hand-authored visual mirror of <dd-view-switcher>.
// Static: shows 'detailed' as the active view (mockup default).

import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'dd-mockup-view-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5" data-testid="view-switcher">
      <span class="px-2.5 py-1 rounded-md text-xs font-medium bg-blue-600 text-white shadow-sm"
            data-testid="view-option-detailed">Detailed</span>
      <span class="px-2.5 py-1 rounded-md text-xs font-medium text-gray-600"
            data-testid="view-option-compact">Compact</span>
      <span class="px-2.5 py-1 rounded-md text-xs font-medium text-gray-600"
            data-testid="view-option-glance">Glance</span>
      <span class="px-2.5 py-1 rounded-md text-xs font-medium text-gray-600"
            data-testid="view-option-focus">Focus</span>
    </div>
  `
})
export class ViewSwitcherComponent {}
