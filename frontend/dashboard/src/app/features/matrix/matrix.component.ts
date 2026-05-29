import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { AppStateService } from '../../core/services/app-state.service';
import { DeploymentApiService } from '../../core/services/deployment-api.service';
import { deriveBoxState } from '../../core/models/deployment.model';
import { MatrixTileComponent } from './matrix-tile/matrix-tile.component';
import { HistoryDrawerComponent } from './history-drawer/history-drawer.component';

/**
 * MatrixComponent — services × environments deployment grid (Phase 2).
 *
 * Spec: docs/design/views.md §Matrix View Layout
 *       docs/design/components.md §Matrix Tile + §6 Box States
 *
 * Layout: grid-template-columns: 180px repeat(N, minmax(140px, max-content))
 * Data:   GET /api/matrix on init + on each incoming SSE event (reload).
 * Live:   SSE stream → sseConnected = true → reload matrix snapshot.
 */
@Component({
  selector: 'app-matrix',
  standalone: true,
  imports: [MatrixTileComponent, HistoryDrawerComponent],
  templateUrl: './matrix.component.html',
  styleUrl: './matrix.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatrixComponent implements OnInit, OnDestroy {
  protected readonly state = inject(AppStateService);
  private  readonly api   = inject(DeploymentApiService);

  // ── Local UI state ────────────────────────────────────────
  protected readonly loading = signal<boolean>(true);
  protected readonly loadErr = signal<boolean>(false);

  /** Version currently hovered — cross-matrix amber highlight. */
  protected readonly highlightedVersion = signal<string | null>(null);

  /** Drawer state */
  protected readonly drawerOpen = signal<boolean>(false);
  protected readonly drawerSvc  = signal<string>('');
  protected readonly drawerEnv  = signal<string>('');

  // ── Subscriptions ─────────────────────────────────────────
  private subs: Subscription[] = [];

  // ── Derived ───────────────────────────────────────────────
  protected readonly environments = computed(() =>
    this.state.matrixData()?.environments ?? []
  );

  /** CSS grid-template-columns value */
  protected readonly gridColumns = computed(() => {
    const n = this.environments().length;
    return `180px repeat(${n}, minmax(140px, max-content))`;
  });

  /** Service rows filtered by serviceFilter + failuresOnly signals. */
  protected readonly filteredRows = computed(() => {
    const matrix = this.state.matrixData();
    if (!matrix) return [];

    const filter   = this.state.serviceFilter().toLowerCase().trim();
    const failOnly = this.state.failuresOnly();

    return matrix.rows.filter((row) => {
      // Service name substring filter (case-insensitive)
      if (filter && !row.service.toLowerCase().includes(filter)) return false;

      // Failures-only: hide rows that have NO slot in a failed/run-fail state
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

  // ── Lifecycle ─────────────────────────────────────────────
  ngOnInit(): void {
    this.loadMatrix();
    this.connectSSE();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ── Data loading ──────────────────────────────────────────
  private loadMatrix(): void {
    this.loading.set(true);
    this.loadErr.set(false);
    const sub = this.api.getMatrix().subscribe({
      next: (m) => {
        this.state.matrixData.set(m);
        this.loading.set(false);
      },
      error: () => {
        this.loadErr.set(true);
        this.loading.set(false);
      },
    });
    this.subs.push(sub);
  }

  private connectSSE(): void {
    const sub = this.api.streamEvents().subscribe({
      next: (ev) => {
        // Apply the incoming event directly to the in-memory matrix signal —
        // no /api/matrix round-trip needed.
        this.state.sseConnected.set(true);
        this.state.applyDeploymentEvent(ev);
      },
      error: () => {
        this.state.sseConnected.set(false);
      },
    });
    this.subs.push(sub);
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
