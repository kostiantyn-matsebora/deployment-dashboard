# Change Requests

Records of requirements changes after the initial SAD was frozen.

The SAD (`docs/deployment-dashboard-architecture.md`) defines the **initial architecture only**. Every subsequent change to the documented requirements (new FRs, modified FRs, new NFRs, modified NFRs, scope adjustments, contract additions) lands here as a numbered Change Request. CRs are append-only — once accepted they are never edited in place; a superseding CR is added instead.

A CR records WHAT changed in the requirements and WHY. Architecture decisions triggered by a CR are captured in a paired ADR under `docs/adr/`.

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
| [CR-0003](./CR-0003-tree-topology-and-layout-axis.md) | Tree-shaped deployment topology and three-layout axis (Matrix / Swim-lane / Workflow-rows) | accepted |
| [CR-0004](./CR-0004-ref-and-sha-optional-fields.md) | Optional `ref` and `sha` fields on deployment payload | accepted |
| [CR-0005](./CR-0005-ref-sha-display-and-topology.md) | `ref` / `sha` exposed as Display picker options and Topology correlation options | accepted |
| [CR-0006](./CR-0006-light-dark-auto-theme.md) | Light / Dark / Auto theme axis | accepted |
