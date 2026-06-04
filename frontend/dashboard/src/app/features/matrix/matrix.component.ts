import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';

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
  imports: [MatrixTileComponent, HistoryDrawerComponent, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder],
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

    const filter   = this.state.serviceFilter().toLowerCase().trim();
    const failOnly = this.state.failuresOnly();

    return matrix.rows.filter((row) => {
      if (filter && !row.service.toLowerCase().includes(filter)) return false;
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

  // ── Column drag-reorder ───────────────────────────────────
  protected onColDrop(event: CdkDragDrop<string[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const visible = this.environments();
    const fromEnv = visible[event.previousIndex];
    const toEnv   = visible[event.currentIndex];
    this.state.reorderColumn(fromEnv, toEnv);
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
