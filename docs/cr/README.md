---
title: CRs
nav_order: 7
has_children: true
---

# Change Requests

Records of requirements changes (Change Requests — FR/NFR additions, modifications, scope adjustments, contract additions) after the initial SAD was frozen. Append-only — superseded entries are never edited in place. Architecture consequences of a CR are captured in a paired ADR under `docs/adr/`. See CLAUDE.md → "Source of truth" for the SAD-freeze rule.

## Template

### CR-NNNN — \<title>

- **Status:** proposed / accepted / superseded
- **Trigger:** (TODO line / user request / external pressure)
- **Change:** (what changed in the requirements)
- **Impact:** (which FRs/NFRs/components are affected)
- **References:** (SAD sections, related CRs/ADRs)

## SAD-level content owned by this CR — verbatim

\<verbatim FR / NFR / §7 text the CR adds to (or removes from) the SAD-equivalent surface — quoted, not paraphrased>

### Heading convention

The verbatim block uses **`## SAD-level content owned by this CR — verbatim`** as a universal cover for both directions:

- **Additive** CRs (e.g. CR-0006 theme axis, CR-0002 four named views) — the verbatim block is the SAD-shaped text the CR introduces. It would have lived in the SAD if the requirement had been part of the initial architecture; the CR is now its single source of truth.
- **Extraction** CRs (rare — only CR-0001 today) — the verbatim block is text removed from the initial SAD and re-homed under the CR. CR-0001 uses the legacy heading `## Removed SAD content (verbatim)` because it predates the universal convention and the wording is still strictly accurate for that CR.

New CRs MUST use the universal heading regardless of direction. This keeps the SAD-frozen / CR-as-source-of-truth model legible without a per-CR judgement on whether a change is "additive" or "extractive".

## Index

| CR | Title | Status |
|---|---|---|
| [CR-0001](./CR-0001-generic-project-agnostic.md) | Project-agnostic naming and examples | accepted |
| [CR-0002](./CR-0002-four-named-views-and-attribute-picker.md) | Four named views (Detailed / Compact / Glance / Focus) and per-view attribute picker | accepted |
| [CR-0003](./CR-0003-tree-topology-and-layout-axis.md) | Tree-shaped deployment topology and three-layout axis (Matrix / Swim-lane / Workflow-rows) | accepted (partially superseded by CR-0007) |
| [CR-0004](./CR-0004-ref-and-sha-optional-fields.md) | Optional `ref` and `sha` fields on deployment payload | accepted |
| [CR-0005](./CR-0005-ref-sha-display-and-topology.md) | `ref` / `sha` exposed as Display picker options and Topology correlation options | accepted |
| [CR-0006](./CR-0006-light-dark-auto-theme.md) | Light / Dark / Auto theme axis | accepted |
| [CR-0007](./CR-0007-defer-matrix-layout-to-phase-2.md) | Defer Matrix layout from MVP to Phase 2.0 (layout axis reduced to Swim-lane + Workflow-rows; default flips to Swim-lane) | accepted |
| [CR-0008](./CR-0008-api-validation-and-openapi-scalar.md) | Standardised API validation (length-only), ProblemDetails errors, OpenAPI spec, and Scalar UI | accepted |
| [CR-0009](./CR-0009-pull-mode-fetcher-and-progress-reporter.md) | Optional pull-mode fetcher (`Dashboard.Fetcher`) and universal `X-Progress-Reporter` event-attribution header | proposed |
| [CR-0010](./CR-0010-component-ci-pipeline.md) | Component CI pipeline (GitHub Actions — build, test, package) | accepted (amended 2026-05-21 by ADR-0009) |
| [CR-0011](./CR-0011-fetcher-rate-limit-governance.md) | Fetcher rate-limit governance: configurable self-imposed cap + usage reporting endpoints + dashboard surfacing | proposed |
| [CR-0012](./CR-0012-integration-test-substrate.md) | Integration test substrate: WireMock.Net mock-gha service + `testing/integration/` suite + demo-bundle co-location | accepted |
