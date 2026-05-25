export * from './lib/pipeline-matrix.component';
export * from './lib/stage-box.component';
export * from './lib/stats-bar.component';
export * from './lib/rate-limit-cluster.component';
export * from './lib/matrix-header.component';
export * from './lib/view-switcher.component';
export * from './lib/layout-switcher.component';
export * from './lib/attribute-picker.component';
export * from './lib/topology-picker.component';
export * from './lib/layout-leaf.component';
export * from './lib/detailed-row.component';
export * from './lib/compact-row.component';
export * from './lib/glance-row.component';
export * from './lib/focus-row.component';
export { getBoxClass, getTooltip } from './lib/box-styles';
// CR-0015 § 3c — migrated from frontend/dashboard/src/app/ (shared-shaped components)
export * from './lib/dashboard-header.component';
export * from './lib/swim-lane-layout.component';
export * from './lib/workflow-rows-layout.component';
// topology-utils.ts is intentionally NOT re-exported: internal to matrix/src/lib/
// (O-9 audit confirmed zero external consumers)
