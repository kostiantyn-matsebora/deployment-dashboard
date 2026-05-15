// Pure helpers shared between stage-box and unit tests. Mirror exactly the
// mockup's getBoxClass() / getTooltip() so the visual contract holds.

import type {
  EnvironmentDescriptor,
  ServiceDescriptor,
  SlotState
} from '@dd/shared';
import { formatDateTime } from '@dd/shared';

const HIGHLIGHT = 'ring-2 ring-offset-1 ring-amber-400 ';

export function getBoxClass(
  slot: SlotState | null,
  highlightedVersion: string | null
): string {
  if (!slot) return 'border-dashed border-gray-200 bg-gray-50 cursor-default';

  const isHighlighted = highlightedVersion != null && (
    slot.current.version === highlightedVersion ||
    slot.lastSuccessful?.version === highlightedVersion
  );
  const h = isHighlighted ? HIGHLIGHT : '';

  switch (slot.current.status) {
    case 'success':
      return h + 'border-green-300 bg-green-50 hover:border-green-400 hover:shadow-sm cursor-pointer';
    case 'failure':
      return h + 'border-red-300 bg-red-50 hover:border-red-400 hover:shadow-sm cursor-pointer';
    case 'in-progress':
      return h + 'in-progress-box border-orange-400 bg-orange-50 hover:shadow-sm cursor-pointer';
    default:
      return h + 'border-gray-200 bg-white hover:border-gray-300 cursor-pointer';
  }
}

export function getTooltip(
  service: ServiceDescriptor,
  env: EnvironmentDescriptor,
  slot: SlotState | null
): string {
  if (!slot) return `${service.name} — not deployed to ${env.label}`;
  const c = slot.current;
  return `${c.version} · ${formatDateTime(c.deployedAt)} · ${c.actor} · #${c.runNumber}`;
}
