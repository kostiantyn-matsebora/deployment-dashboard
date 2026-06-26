import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AppStateService } from '../../core/services/app-state.service';
import { deriveBoxState } from '../../core/models/deployment.model';
import { MatrixTileComponent } from './matrix-tile/matrix-tile.component';
import { HistoryDrawerComponent } from './history-drawer/history-drawer.component';

/**
 * MatrixComponent — services × environments deployment grid (Phase 2).
 *
 * Pure presentation component. Data arrives via AppStateService.matrixData
 * which is loaded once and kept live by the root App component.
 * No HTTP calls here — the App shell owns the matrix load + SSE stream.
 *
 * Spec: docs/design/views.md §Matrix View Layout
 *       docs/design/components.md §Matrix Tile + §6 Box States
 */
@Component({
  selector: 'app-matrix',
  standalone: true,
  imports: [MatrixTileComponent, HistoryDrawerComponent],
  templateUrl: './matrix.component.html',
  styleUrl: './matrix.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatrixComponent {
  protected readonly state = inject(AppStateService);

  // ── Drawer state ──────────────────────────────────────────
  protected readonly drawerOpen = signal<boolean>(false);
  protected readonly drawerSvc  = signal<string>('');
  protected readonly drawerEnv  = signal<string>('');

  // ── Version hover cross-matrix highlight ──────────────────
  protected readonly highlightedVersion = signal<string | null>(null);

  // ── All environments from the data ────────────────────────
  protected readonly allEnvironments = computed(() =>
    this.state.matrixData()?.environments ?? []
  );

  // ── Visible, ordered environments (applies col order + hidden set) ────────
  protected readonly environments = computed(() =>
    this.state.orderedVisibleEnvironments(this.allEnvironments())
  );

  protected readonly gridColumns = computed(() => {
    const n = this.environments().length;
    return `180px repeat(${n}, minmax(140px, max-content))`;
  });

  protected readonly filteredRows = computed(() => {
    const matrix = this.state.matrixData();
    if (!matrix) return [];

    const filter    = this.state.serviceFilter().toLowerCase().trim();
    const failOnly  = this.state.failuresOnly();
    const allIds    = matrix.rows.map((r) => ({ service: r.service, namespace: r.namespace ?? null }));
    const visIds    = new Set(
      this.state.visibleServiceIdentities(allIds)
        .map((i) => `${i.namespace ?? ''}|${i.service}`),
    );

    return matrix.rows.filter((row) => {
      // Composite service filter (picker)
      if (!visIds.has(`${row.namespace ?? ''}|${row.service}`)) return false;
      // Text search filter (inline input) — matches bare service name or composite
      const composite = row.namespace ? `${row.namespace}/${row.service}` : row.service;
      if (filter && !composite.toLowerCase().includes(filter)) return false;
      // Failures-only toggle
      if (failOnly) {
        const hasFail = Object.values(row.slots).some((s) => {
          const st = deriveBoxState(s);
          return st === 's-fail-last' || st === 's-run-fail-last' || st === 's-run-fail-only';
        });
        if (!hasFail) return false;
      }
      return true;
    });
  });

  /**
   * Render label for a row (render-on-collision rule, issue #353):
   * Show `namespace/service` only when the same service name appears under
   * more than one namespace in the currently visible row set.
   * Null-namespace rows are always shown unprefixed.
   */
  protected rowLabel(service: string, namespace: string | null | undefined): string {
    return this.state.rowLabel(service, namespace, this.filteredRows());
  }

  // ── Native HTML5 column drag-reorder ─────────────────────
  /** The env name currently being dragged; null when no drag is in progress. */
  protected readonly draggedEnv  = signal<string | null>(null);
  /** The env name the pointer is currently over during a drag. */
  protected readonly dragOverEnv = signal<string | null>(null);

  protected onDragStart(env: string, event: DragEvent): void {
    this.draggedEnv.set(env);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected onDragOver(env: string, event: DragEvent): void {
    // REQUIRED: preventDefault() makes this element a valid drop target.
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragOverEnv.set(env);
  }

  protected onDragLeave(env: string): void {
    // Only clear dragOverEnv if we're leaving the cell we set it on,
    // not bubbling from a child element clearing the wrong cell.
    if (this.dragOverEnv() === env) {
      this.dragOverEnv.set(null);
    }
  }

  protected onDrop(toEnv: string, event: DragEvent): void {
    event.preventDefault();
    const fromEnv = this.draggedEnv();
    this.draggedEnv.set(null);
    this.dragOverEnv.set(null);
    if (fromEnv && fromEnv !== toEnv) {
      this.state.reorderColumn(fromEnv, toEnv);
    }
  }

  protected onDragEnd(): void {
    this.draggedEnv.set(null);
    this.dragOverEnv.set(null);
  }

  // ── Tile interaction ──────────────────────────────────────
  protected openDrawer(service: string, env: string): void {
    this.drawerSvc.set(service);
    this.drawerEnv.set(env);
    this.drawerOpen.set(true);
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  protected onVersionHover(version: string | null): void {
    this.highlightedVersion.set(version);
  }
}
