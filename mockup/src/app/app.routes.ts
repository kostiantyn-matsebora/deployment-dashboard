import { Routes } from '@angular/router';
import { SwimLaneRouteComponent } from './swim-lane-route.component';
import { WorkflowRowsRouteComponent } from './workflow-rows-route.component';

export const routes: Routes = [
  { path: '', redirectTo: 'swim-lane', pathMatch: 'full' },
  { path: 'swim-lane', component: SwimLaneRouteComponent },
  { path: 'workflow-rows', component: WorkflowRowsRouteComponent },
  // Sub-batch C' — variant routes (lazy)
  // Sub-batch D' — /invariants route (lazy)
];
