import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import {
  BoxState,
  DeploymentEvent,
  MATRIX_FIELDS,
  MatrixField,
  MatrixSlot,
  deriveBoxState,
  isContextStatus,
} from '../../../core/models/deployment.model';


/**
 * MatrixTileComponent — one (service × environment) cell in the matrix grid.
 *
 * Spec: docs/design/components.md §Matrix Tile + §6 Box States
 * Renders all 6 box states from a MatrixSlot input.
 *
 * Version hover: emits the version string on mouseenter over any .ver span;
 * parent (MatrixComponent) tracks highlightedVersion signal, passes it back
 * to all tiles so same-version tiles show amber highlight.
 */
@Component({
  selector: 'app-matrix-tile',
  standalone: true,
  imports: [NgTemplateOutlet, TimeAgoPipe],
  templateUrl: './matrix-tile.component.html',
  styleUrl: './matrix-tile.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatrixTileComponent {
  // ── Inputs ────────────────────────────────────────────────
  readonly slot              = input.required<MatrixSlot>();
  readonly visibleFields     = input<Set<MatrixField>>(new Set(MATRIX_FIELDS));
  readonly highlightedVersion = input<string | null>(null);
  /**
   * True while the tile should display a brief flash animation (change-
   * emphasis on SSE update). Driven by `MatrixComponent.flashingIds` signal
   * (#398) — mirrors `VisCardComponent.isFlashing` (#309).
   */
  readonly isFlashing = input<boolean>(false);

  // ── Outputs ───────────────────────────────────────────────
  readonly tileClick    = output<void>();
  readonly versionHover = output<string | null>();

  // ── Computed ──────────────────────────────────────────────
  protected readonly current     = computed<DeploymentEvent>(() => this.slot().current);
  protected readonly lastSucc    = computed<DeploymentEvent | undefined>(() => this.slot().last_successful);
  protected readonly nextEvent   = computed<DeploymentEvent | undefined>(() => this.slot().next);
  protected readonly boxState    = computed<BoxState>(() => deriveBoxState(this.slot()));
  protected readonly isSplit     = computed<boolean>(() => {
    const s = this.boxState();
    const hasSplit = s === 's-run-last' || s === 's-run-fail-last' || s === 's-fail-last';
    // s-fail-last may occur without last_successful (failure with no prior
    // success); in that case do not render the split bottom section.
    return hasSplit && !!this.lastSucc();
  });

  /** True when current.version === highlighted AND version is non-empty. */
  protected readonly isHighlighted = computed<boolean>(() => {
    const hv  = this.highlightedVersion();
    const ver = this.current().version;
    return !!(hv && ver && hv === ver);
  });

  /**
   * The context status from slot.next (if present).
   * slot.next is the latest non-effective deployment beyond the live one.
   */
  protected readonly ctxStatus = computed<string | null>(() => {
    const n = this.nextEvent();
    return n && isContextStatus(n.status) ? n.status : null;
  });

  /** Version string from slot.next (for the context badge). */
  protected readonly ctxVersion = computed<string | undefined>(() => {
    return this.nextEvent()?.version;
  });

  // ── Field visibility helpers ─────────────────────────────
  protected show(field: MatrixField): boolean {
    return this.visibleFields().has(field);
  }

  /** True for all in-progress states (spinner shown on row 1). */
  protected isRunning(): boolean {
    const s = this.boxState();
    return s === 's-running-only' || s === 's-run-last' ||
           s === 's-run-fail-last' || s === 's-run-fail-only';
  }

  /** True when at least one tile-attrs field is visible. */
  protected hasAttrs(ev: DeploymentEvent): boolean {
    return (this.show('ref')        && !!ev.ref)        ||
           (this.show('sha')        && !!ev.sha)        ||
           (this.show('run_url')    && !!ev.run_url)    ||
           (this.show('run_number') && !!ev.run_number) ||
           (this.show('actor')      && !!ev.actor);
  }

  /** Icon glyph for a given context status. */
  protected ctxIcon(status: string): string {
    const icons: Record<string, string> = {
      'pending':   '○',
      'queued':    '≡',
      'waiting':   '◷',
      'cancelled': '⊘',
      'rejected':  '⊗',
    };
    return icons[status] ?? '';
  }

  // ── Event handlers ────────────────────────────────────────
  protected onTileClick(event: MouseEvent): void {
    // Suppress propagation from anchor clicks handled separately
    if ((event.target as HTMLElement).closest('a')) return;
    this.tileClick.emit();
  }

  protected onVerHover(version: string): void {
    this.versionHover.emit(version);
  }

  protected onVerLeave(): void {
    this.versionHover.emit(null);
  }
}
