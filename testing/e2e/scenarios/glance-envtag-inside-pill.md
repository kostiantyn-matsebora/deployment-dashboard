# Glance view renders the env tag INSIDE its paired deployment pill

**Intent:** in the Glance view (across all three layouts), the env
label is rendered inside the deployment rectangle / pill. This is
the single allowed exception to the "env-tag and box do not overlap"
geometric invariant (NFR-09 Glance exception), mirrored from the
mockup harness's Invariant 1 exception.

## Citations

- `docs/architecture.md` §5 NFR-09 ("Exception
  (Glance view only): the env label is rendered INSIDE the
  deployment rectangle. This is the single allowed overlap of
  env-tag and box ... The env label remains visible (not clipped)
  and the connector terminates at the pill's left edge as in other
  views.").
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` "Glance exception
  under FR-13" ("the Glance view's 'env-tag-inside-pill' rendering
  applies in all three layouts").
- `testing/mockup-visual/mockup-invariants.spec.ts` — the original
  in-pill exception, declared in `harness.config.json` →
  `viewExceptions.glance['I1-paired-envtag-inside-paired-box']`.

## Preconditions

- Stack up, fixtures seeded.
- `localStorage` cleared.

## Steps

For every `layout` in `['matrix', 'swim-lane', 'workflow-rows']`:

1. **Given** the SPA is loaded with a fresh `localStorage`,
2. **When** the test selects view = Glance and the named layout,
3. **Then** for every visible
   `[data-testid^='stage-box-']` element, the matching
   `.env-tag` inside the same `.leaf-pair` (i.e. the env tag
   PAIRED with this box) has a
   `getBoundingClientRect()` that is fully contained within the
   stage box's bounding rect (left ≥ box.left − 2,
   right ≤ box.right + 2, top ≥ box.top − 2,
   bottom ≤ box.bottom + 2),
4. **And** the env tag's `scrollWidth` does not exceed its
   `clientWidth` by more than 1 px (env label not clipped).

## Expected results

- Per-layout assertion that every paired env-tag is contained in
  its paired stage box for the Glance view.
- The env label remains readable (not clipped horizontally).
- Containment is checked against the paired box only — a
  non-paired tag overlap is still a violation (mirrors the
  harness's "PAIRED env-tag inside its OWN paired box" rule).

## Out of scope

- Non-Glance views (covered by `spa-visual-invariants.md` which
  asserts no overlap at all in Detailed / Compact / Focus).
- Connector geometry (covered by the swim-lane spec).

## Coverage

- NFR-09 Glance exception under FR-12 / FR-13.
- Mockup harness Invariant 1 exception (`I1-paired-envtag-inside-paired-box`).
