// Pure watch-filter — no browser API dependencies; fully unit-testable.
// Spec: docs/design/components.md §Include/Exclude Watch Filter

import type { ExtensionSettings } from './types';

/**
 * Returns true if (service, environment) falls within the user's watch scope.
 *
 * "Watch all except" (exclude mode, default):
 *   An item is watched UNLESS its service OR environment appears in the respective
 *   selection list.  An empty list means nothing is excluded.
 *
 * "Watch only" (include mode):
 *   An item is watched ONLY IF its service AND environment each appear in their
 *   respective list.  An empty list means nothing is included (nothing watched).
 */
export function isWatched(
  service: string,
  environment: string,
  settings: Pick<ExtensionSettings, 'filterMode' | 'services' | 'environments'>,
): boolean {
  const { filterMode, services, environments } = settings;

  if (filterMode === 'exclude') {
    const serviceExcluded = services.length > 0 && services.includes(service);
    const envExcluded = environments.length > 0 && environments.includes(environment);
    return !serviceExcluded && !envExcluded;
  }

  // include mode: both service and environment must be in their respective lists.
  // Empty list → no items selected → nothing is watched.
  const serviceIncluded = services.length > 0 && services.includes(service);
  const envIncluded = environments.length > 0 && environments.includes(environment);
  return serviceIncluded && envIncluded;
}
