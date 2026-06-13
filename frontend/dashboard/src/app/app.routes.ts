import { Routes } from '@angular/router';

/**
 * SPA routes — three views: Matrix, Swimlanes, Analytics.
 * Spec: docs/design/components.md §Topbar (segmented tabs)
 * Analytics: issue #299 — DORA-anchored analytics view.
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
    path: 'analytics',
    loadComponent: () =>
      import('./features/analytics/analytics.component').then((m) => m.AnalyticsComponent),
  },
  {
    path: '**',
    redirectTo: 'matrix',
  },
];
