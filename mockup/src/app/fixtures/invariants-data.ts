// Invariants fixture — hardcoded copy of harness config invariant metadata.
// Source: testing/mockup-visual/harness.config.json
// Manual discipline: when harness.config.json changes, update this file by hand.
// Kept as a hardcoded TS constant (not a JSON import) so the mockup stays
// standalone — no relative reach across the repo boundary.

export interface InvariantEntry {
  id: string;
  label: string;
}

export interface SeverityBand {
  name: string;
  max?: number;
  min?: number;
  lightToken: string;
  rationale: string;
}

export interface ViewException {
  view: string;
  invariantId: string;
  rationale: string;
}

// Active invariants (from harness.config.json "invariants" array — I0–I10 + I12).
// I11 is deferred to Phase 2.0 (Matrix layout).
export const ACTIVE_INVARIANTS: readonly InvariantEntry[] = [
  {
    id: 'I0-connector-orphan-no-target',
    label: 'Connector resolves to a target box (no silent skips)'
  },
  {
    id: 'I1-no-overlap-envtag-vs-box',
    label: 'No overlap: env-tag vs deployment box'
  },
  {
    id: 'I2-envtag-not-clipped',
    label: 'Env-tag text is not clipped'
  },
  {
    id: 'I3-connector-reaches-target',
    label: 'Connector reaches its target box'
  },
  {
    id: 'I4-connector-emerges-from-source',
    label: 'Connector emerges from source box edge'
  },
  {
    id: 'I5-connector-does-not-cross-envtag',
    label: 'Connector does not cross any env-tag rect'
  },
  {
    id: 'I6-box-content-not-clipped',
    label: 'Box content stays within parent box'
  },
  {
    id: 'I7-picker-exposes-seven-attribute-checkboxes',
    label: 'Display picker exposes seven FR-02 attribute checkboxes (subject to per-view cap)'
  },
  {
    id: 'I8-no-null-literal-when-ref-sha-selected',
    label: "No DOM text equals 'null' when ref/sha is selected and underlying value is null (SAD §7 null-render invariant)"
  },
  {
    id: 'I9-focus-distinct-from-compact',
    label: 'Focus view exposes row-gutter chevron + pin per service (granularity per layout); Compact view exposes neither (regression-preventing oracle)'
  },
  {
    id: 'I10-service-name-no-clip',
    label: 'Service name renders without horizontal clipping (no ellipsis truncation) across every View x Layout x Theme combination'
  },
  {
    id: 'I12-rate-limit-cluster',
    label: 'Rate-limit cluster (CR-0011): non-overlap with left cluster (I12.a), severity-band class matches worst-band rule (I12.b), highlight-hint reconciliation = stack vertically (I12.c), collapse at viewport < 1280 px (I12.d), stale affordance fires at now - received_at > 2 x poll_interval (I12.e), aggregated worst-band pill + counter + popover (I12.f)'
  }
];

// Deferred invariants (from harness.config.json "deferredPhase20.invariants").
// These are excluded from the active harness run; preserved for Phase 2.0.
export const DEFERRED_INVARIANTS: readonly (InvariantEntry & { deferralReason: string })[] = [
  {
    id: 'I11-matrix-focus-env-header-alignment',
    label: 'Matrix Focus: env-header columns align with deployment columns in both collapsed and expanded rows (--leaf-width-expanded honoured)',
    deferralReason: 'Matrix layout removed from MVP; deferred to Phase 2.0. Reactivate by restoring matrix to layouts[], re-adding I11 to invariants[], and merging deferredPhase20.i11 to top-level.'
  }
];

// View exceptions (from harness.config.json "viewExceptions").
export const VIEW_EXCEPTIONS: readonly ViewException[] = [
  {
    view: 'glance',
    invariantId: 'I1-paired-envtag-inside-paired-box',
    rationale: "SAD NFR-09 exception: in Glance view only, the env label is rendered INSIDE the deployment rectangle. This is the single allowed overlap of env-tag and box, permitted because the Glance pill's vertical extent forces the connector y to cross the env-tag y in any left-of-box layout. The env label remains visible (Invariant 2 still applies) and the connector terminates at the pill's left edge. Scope: PAIRED env-tag inside its OWN paired box only; non-paired overlaps remain violations."
  }
];

// Severity bands (from harness.config.json "rateLimitCluster.severityBands").
export const SEVERITY_BANDS: readonly SeverityBand[] = [
  {
    name: 'green',
    max: 0.60,
    lightToken: 'bg-green-100',
    rationale: '< 60% — healthy'
  },
  {
    name: 'amber',
    min: 0.60,
    max: 0.85,
    lightToken: 'bg-amber-100',
    rationale: '60–85% — warning'
  },
  {
    name: 'red',
    min: 0.85,
    lightToken: 'bg-red-100',
    rationale: '> 85% — saturation'
  },
  {
    name: 'stale',
    lightToken: 'bg-gray-100',
    rationale: 'now - received_at > 2 × poll_interval'
  }
];
