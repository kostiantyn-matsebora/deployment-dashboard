// Shared view-mode state for the mockup app.
// Provides a single WritableSignal<ViewMode> so that app.component (the
// view-switcher buttons) and the layout route components share the same instance
// without NgRx, without any store, and without URL query-param routing.
//
// Consumed via inject(ViewModeService) in:
//   - app.component       → drives view-switcher button active styling
//   - swim-lane-route     → @switch dispatches to per-view-mode component
//   - workflow-rows-route → passes viewMode() to workflow-rows-layout

import { Injectable, signal } from '@angular/core';

export type ViewMode = 'detailed' | 'compact' | 'glance' | 'focus';

@Injectable({ providedIn: 'root' })
export class ViewModeService {
  private readonly _mode = signal<ViewMode>('detailed');

  /** Read-only signal — call as viewMode.mode() in template or computed. */
  readonly mode = this._mode.asReadonly();

  set(mode: ViewMode): void {
    this._mode.set(mode);
  }
}
