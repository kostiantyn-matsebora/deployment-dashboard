import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

import { DeploymentEvent, isContextStatus, SwimlaneField } from '../../../core/models/deployment.model';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';

/** Real rendered size of a node card, reported to the swimlane layout. */
export interface CardDims {
  id: string;
  width: number;
  height: number;
}

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
  /** Optional context-status next event for this node's slot (from slot.next). */
  readonly nextEvent = input<DeploymentEvent | null>(null);
  /**
   * True when this node's slot is never-deployed: `current` is a context
   * status with no effective baseline. Set by the parent (SwimlanesComponent)
   * which has access to `slot.last_successful`; the vis-card cannot derive
   * this from the event alone.
   */
  readonly neverDeployed = input<boolean>(false);

  /** Emitted when the card is clicked — parent handles inspector state. */
  readonly nodeClick = output<DeploymentEvent>();

  /**
   * Emitted with the card's real rendered px size whenever it changes.
   *
   * This is the single bridge that lets ngx-graph size the node correctly:
   * SVG `<foreignObject>` does not auto-grow to its HTML content, so the
   * swimlane feeds this measured size back as the node `dimension`. The same
   * ResizeObserver fires on first paint AND on any later live change (an SSE
   * event mutating this card's content) — no per-event sizing logic needed.
   */
  readonly dims = output<CardDims>();

  // ── DOM measurement ──────────────────────────────────────────
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    let ro: ResizeObserver | undefined;
    afterNextRender(() => {
      const card = this.host.nativeElement.querySelector('.vis-card') as HTMLElement | null;
      if (!card) return;
      const emit = () => {
        // offsetWidth/Height = layout box, unaffected by any SVG zoom transform.
        const width = card.offsetWidth;
        const height = card.offsetHeight;
        if (width && height) this.dims.emit({ id: this.event().id, width, height });
      };
      ro = new ResizeObserver(emit);
      ro.observe(card);
      emit();
    });
    inject(DestroyRef).onDestroy(() => ro?.disconnect());
  }

  // ── Derived ─────────────────────────────────────────────────

  /**
   * True when this node's slot is never-deployed: driven by the `neverDeployed`
   * input from the parent (which has access to slot.last_successful). Renders a
   * neutral/grey card + status chip. Mirrors .vis-card.s-never-deployed.
   */
  protected readonly isNeverDeployed = computed<boolean>(() => this.neverDeployed());

  protected readonly statusClass = computed<string>(() => {
    if (this.isNeverDeployed()) return 's-never-deployed';
    switch (this.event().status) {
      case 'success':     return 's-success';
      case 'in-progress': return 's-progress';
      default:            return 's-failure';
    }
  });

  /**
   * Context status from slot.next (pending/queued/waiting/cancelled/rejected),
   * if any. Only reads slot.next — the never-deployed case is handled via
   * isNeverDeployed() + statusClass(), not via ctxStatus().
   */
  protected readonly ctxStatus = computed<string | null>(() => {
    const next = this.nextEvent();
    return next && isContextStatus(next.status) ? next.status : null;
  });

  /** Version of the context-status next event (for the badge label). */
  protected readonly ctxVersion = computed<string | undefined>(() => {
    const next = this.nextEvent();
    if (next && isContextStatus(next.status)) return next.version;
    return undefined;
  });

  /** Icon glyph for a context status. */
  protected ctxIcon(status: string): string {
    const icons: Record<string, string> = {
      'pending': '○', 'queued': '≡', 'waiting': '◷', 'cancelled': '⊘', 'rejected': '⊗',
    };
    return icons[status] ?? '';
  }

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
