import { Routes } from '@angular/router';

/**
 * SPA routes — four views: Matrix, Swimlanes, Feed, Analytics.
 * Spec: docs/design/components.md §Topbar (segmented tabs)
 * Analytics: issue #299 — DORA-anchored analytics view.
 * Feed: issue #397 — chronological deployment log; tab order is LOCKED
 * immediately after Swimlanes.
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
    path: 'feed',
    loadComponent: () =>
      import('./features/feed/feed.component').then((m) => m.FeedComponent),
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
