import { Routes } from '@angular/router';

/**
 * SPA routes — two views: Matrix and Swimlanes.
 * Spec: docs/design/components.md §Topbar (segmented tabs)
 */
export const routes: Routes = [
  {
    path: '',
    redirectTo: 'matrix',
    pathMatch: 'full',
  },
  {
    path: 'matrix',
    loadComponent: () =>
      import('./features/matrix/matrix.component').then((m) => m.MatrixComponent),
  },
  {
    path: 'swimlanes',
    loadComponent: () =>
      import('./features/swimlanes/swimlanes.component').then((m) => m.SwimlanesComponent),
  },
  {
    path: '**',
    redirectTo: 'matrix',
  },
];
