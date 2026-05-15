// Sets the store's `highlightedVersion` on mouseenter/leave. Used by the
// pipeline-matrix box so the same-version cross-environment highlight stays
// driven from a single signal.

import { Directive, HostListener, inject, input } from '@angular/core';
import { DeploymentMatrixStore } from './deployment-matrix.store';

@Directive({
  selector: '[ddHighlightVersion]',
  standalone: true
})
export class HighlightVersionDirective {
  private readonly store = inject(DeploymentMatrixStore);
  readonly ddHighlightVersion = input<string | null>(null);

  @HostListener('mouseenter') onEnter(): void {
    const v = this.ddHighlightVersion();
    if (v) this.store.setHighlightedVersion(v);
  }

  @HostListener('mouseleave') onLeave(): void {
    this.store.setHighlightedVersion(null);
  }
}
