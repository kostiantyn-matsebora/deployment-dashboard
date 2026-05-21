// Public surface for @dd/shared. Feature libraries and the dashboard app
// must only import from this barrel — never from deep paths.

export * from './lib/models';
export * from './lib/fixtures';
export * from './lib/relative-time';
export * from './lib/display-truncate.pipe';
export * from './lib/sha-truncate.pipe';
export * from './lib/api-client.service';
export * from './lib/sse.service';
export * from './lib/deployment-matrix.store';
export * from './lib/highlight-version.directive';
export * from './lib/svc-name-column-width.directive';
export * from './lib/env-tag-column-width.directive';
export * from './lib/view-config';
export * from './lib/view-prefs.service';
export * from './lib/layout-prefs.service';
export * from './lib/correlation-prefs.service';
export * from './lib/focus-on-last-event-prefs.service';
export * from './lib/theme.service';
export * from './lib/theme-switcher.component';
export * from './lib/local-storage';
