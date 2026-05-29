import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * SwimlanesComponent — per-service DAG visualisation shell.
 *
 * Phase 3 deliverable. Spec: docs/design/views.md §Swimlanes View Layout
 * and docs/design/components.md §Swimlane Node Card + §Inspector Panel.
 *
 * Layout:
 *   .vis-shell { display: grid; grid-template-columns: 1fr 320px; }
 *   One <ngx-graph> per service lane (orientation: 'LR', dagre layout).
 *   Inspector panel (320px) updated on node selection.
 *
 * Data source: GET /api/deployments filtered by service, paginated.
 * Correlation: client-side DAG derivation per AppStateService.correlationPredicate.
 */
@Component({
  selector: 'app-swimlanes',
  standalone: true,
  template: `
    <div class="swimlanes-placeholder">
      <span>Swimlanes view — Phase 3</span>
    </div>
  `,
  styles: [`
    .swimlanes-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 60vh;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: var(--ink-3);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwimlanesComponent {}
