import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * MatrixComponent — services × environments deployment grid.
 *
 * Phase 2 deliverable. Spec: docs/design/views.md §Matrix View Layout
 * and docs/design/components.md §Matrix Tile + §6 Box States.
 *
 * Layout:
 *   grid-template-columns: 180px repeat(N, minmax(140px, max-content))
 *   First column sticky (position: sticky; left: 0)
 *   Columns consume available width; shell scrolls horizontally.
 *
 * Data source: GET /api/matrix via DeploymentApiService.
 * Live updates: SSE via AppStateService.matrixData signal.
 */
@Component({
  selector: 'app-matrix',
  standalone: true,
  template: `
    <div class="matrix-placeholder">
      <span>Matrix view — Phase 2</span>
    </div>
  `,
  styles: [`
    .matrix-placeholder {
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
export class MatrixComponent {}
