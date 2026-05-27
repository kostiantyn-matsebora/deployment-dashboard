import { Routes } from '@angular/router';
import { SwimLaneRouteComponent } from './swim-lane-route.component';
import { WorkflowRowsRouteComponent } from './workflow-rows-route.component';

export const routes: Routes = [
  { path: '', redirectTo: 'swim-lane', pathMatch: 'full' },
  { path: 'swim-lane', component: SwimLaneRouteComponent },
  { path: 'workflow-rows', component: WorkflowRowsRouteComponent },

  // Sub-batch C' — variant routes (lazy-loaded PoC sandbox)
  {
    path: 'variants',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./variants/variants-index.route').then(m => m.VariantsIndexRouteComponent)
      },
      {
        path: 'branching-dag',
        loadComponent: () =>
          import('./variants/branching-dag.route').then(m => m.BranchingDagRouteComponent)
      },
      {
        path: 'disconnected',
        loadComponent: () =>
          import('./variants/disconnected.route').then(m => m.DisconnectedRouteComponent)
      },
      {
        path: 'env-tag-a',
        loadComponent: () =>
          import('./variants/env-tag-a.route').then(m => m.EnvTagARouteComponent)
      },
      {
        path: 'env-tag-b',
        loadComponent: () =>
          import('./variants/env-tag-b.route').then(m => m.EnvTagBRouteComponent)
      },
      {
        path: 'dag-test',
        loadComponent: () =>
          import('./variants/dag-test.route').then(m => m.DagTestRouteComponent)
      },
      {
        path: 'dag-all',
        loadComponent: () =>
          import('./variants/dag-all.route').then(m => m.DagAllRouteComponent)
      }
    ]
  },

  // Sub-batch D' — /invariants route (lazy)
  {
    path: 'invariants',
    loadComponent: () =>
      import('./invariants/invariants.route').then(m => m.InvariantsRouteComponent)
  }
];
