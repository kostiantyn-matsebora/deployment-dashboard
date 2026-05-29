import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { DeploymentEvent, SwimlaneField } from '../../../core/models/deployment.model';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';

/**
 * VisCardComponent — DAG node card for the Swimlanes view.
 *
 * Rendered inside an ngx-graph `#nodeTemplate` via `<svg:foreignObject>`.
 * Uses a flex-column layout with three conditional rows:
 *   Row 1 — version (top-left, demoted) + happened_at (top-right)
 *   Row 2 — ref (col1) + run cluster: run_url, run_number, actor (col2)
 *   Row 3 — sha (bottom-left) + environment (bottom-right, PROMOTED primary identifier)
 *
 * Three status classes: `.s-success`, `.s-progress`, `.s-failure`.
 * Selection: `.is-selected` adds accent ring.
 *
 * Spec: docs/design/components.md §Swimlane Node Card
 *       docs/design/behavior.md §Position Contract (Swimlane Nodes)
 */
@Component({
  selector: 'app-vis-card',
  standalone: true,
  imports: [TimeAgoPipe],
  templateUrl: './vis-card.component.html',
  styleUrl: './vis-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisCardComponent {
  /** Full deployment event for this node. */
  readonly event = input.required<DeploymentEvent>();
  /** Active field visibility set (Swimlanes picker — 8 toggles). */
  readonly visibleFields = input.required<Set<SwimlaneField>>();
  /** True when this node is the currently selected node in the inspector. */
  readonly isSelected = input<boolean>(false);

  /** Emitted when the card is clicked — parent handles inspector state. */
  readonly nodeClick = output<DeploymentEvent>();

  // ── Derived ─────────────────────────────────────────────────

  protected readonly statusClass = computed<string>(() => {
    switch (this.event().status) {
      case 'success':     return 's-success';
      case 'in-progress': return 's-progress';
      default:            return 's-failure';
    }
  });

  /** True when Row 1 (version / happened_at) should render. */
  protected readonly showTopRow = computed<boolean>(() => {
    const v = this.visibleFields();
    return (v.has('version') && !!this.event().version) || v.has('happened_at');
  });

  /** True when Row 2 (ref | run cluster) has at least one visible field with data. */
  protected readonly showBodyRow = computed<boolean>(() => {
    const v = this.visibleFields();
    const ev = this.event();
    return (
      (v.has('ref') && !!ev.ref) ||
      (v.has('run_url') && !!ev.run_url) ||
      (v.has('run_number') && !!ev.run_number) ||
      (v.has('actor') && !!ev.actor)
    );
  });

  /** Row 3 (sha | environment) always renders — environment is the primary identifier. */
  protected readonly showEnvRow = computed<boolean>(() => {
    const v = this.visibleFields();
    const ev = this.event();
    return v.has('environment') || (v.has('sha') && !!ev.sha);
  });

  // ── Visibility helpers ───────────────────────────────────────

  protected show(field: SwimlaneField): boolean {
    return this.visibleFields().has(field);
  }

  // ── Interactions ─────────────────────────────────────────────

  protected onClick(): void {
    this.nodeClick.emit(this.event());
  }

  protected stopProp(ev: MouseEvent): void {
    ev.stopPropagation();
  }
}
