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
} from '../../../core/models/deployment.model';

/** Info for rendering the split-tile bottom-section identifier. */
interface LastIdInfo {
  field: 'version' | 'sha' | 'ref' | 'run_number';
  glyph: string;
  value: string;
}

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

  // ── Outputs ───────────────────────────────────────────────
  readonly tileClick    = output<void>();
  readonly versionHover = output<string | null>();

  // ── Computed ──────────────────────────────────────────────
  protected readonly current     = computed<DeploymentEvent>(() => this.slot().current);
  protected readonly lastSucc    = computed<DeploymentEvent | undefined>(() => this.slot().last_successful);
  protected readonly boxState    = computed<BoxState>(() => deriveBoxState(this.slot()));
  protected readonly isSplit     = computed<boolean>(() => {
    const s = this.boxState();
    return s === 's-run-last' || s === 's-run-fail-last' || s === 's-fail-last';
  });

  /** True when current.version === highlighted AND version is non-empty. */
  protected readonly isHighlighted = computed<boolean>(() => {
    const hv  = this.highlightedVersion();
    const ver = this.current().version;
    return !!(hv && ver && hv === ver);
  });

  /** Info for the split-tile bottom section. Fallback chain: version → sha → ref → run_number. */
  protected readonly lastIdInfo = computed<LastIdInfo | null>(() => {
    const last = this.lastSucc();
    if (!last) return null;
    if (last.version)     return { field: 'version',    glyph: '',  value: last.version };
    if (last.sha)         return { field: 'sha',        glyph: '',  value: last.sha.slice(0, 7) };
    if (last.ref)         return { field: 'ref',        glyph: '⎇', value: last.ref };
    if (last.run_number)  return { field: 'run_number', glyph: '#', value: last.run_number };
    return null;
  });

  // ── Field visibility helpers ─────────────────────────────
  protected show(field: MatrixField): boolean {
    return this.visibleFields().has(field);
  }

  /** True when actor OR happened_at is visible and the event has relevant data. */
  protected showMeta(ev: DeploymentEvent): boolean {
    return (this.show('actor') && !!ev.actor) || this.show('happened_at');
  }

  /** True when at least one of ref/sha/run_url/run_number/parents is visible. */
  protected hasAttrs(ev: DeploymentEvent): boolean {
    return (this.show('ref')              && !!ev.ref)                          ||
           (this.show('sha')              && !!ev.sha)                          ||
           (this.show('run_url')          && !!ev.run_url)                      ||
           (this.show('run_number')       && !!ev.run_number)                   ||
           (this.show('parent_deployments') && (ev.parent_deployments?.length ?? 0) > 0);
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
