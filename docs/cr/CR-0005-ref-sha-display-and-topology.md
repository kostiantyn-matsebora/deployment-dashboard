---
title: "CR-0005: Ref/SHA Display & Topology"
parent: CRs
nav_order: 5
---

# CR-0005 — `ref` / `sha` exposed as Display picker options and Topology correlation options

- **Status:** accepted
- **Trigger:** `TODO` line 7 — "UX: make ability on UI to use ref and sha attributes for 'Display' and 'Topology' functionality".
- **Change:** The two optional fields added by CR-0004 (`ref`, `sha`) are surfaced through the SPA in two distinct UI affordances:
  1. **Display attribute picker (FR-12)** — `ref` and `sha` are picker options on every view, with per-view caps unchanged. Selecting `ref` or `sha` renders the value on the matrix grid; null/absent values render empty (see "Null-render invariant" below).
  2. **Topology correlation picker (FR-13 / CR-0003)** — `ref` and `sha` are allowed values for the per-request `correlationAttribute` query parameter, the server-side default, and per-service overrides. Choosing `ref` or `sha` as the correlation attribute drives the correlation fallback pass of the topology builder (see ADR-0001 pass 3).

  Display picker selections (per view) persist in `dashboard.attrs.<view>` (`localStorage`). Correlation-attribute selection persists in `dashboard.correlationAttribute` (`localStorage`) and is appended as `?correlationAttribute=…` on read endpoints.

- **Impact:**
  - **§7 Visual layout → Null-render invariant for nullable attributes** — cross-referenced below (canonical text lives in CR-0003).
  - **§7 Components → Dashboard Frontend → Interaction** — picker controls described to include `correlation-attribute picker (per-user override; written to `localStorage` only; appended as `correlationAttribute` query parameter on read endpoints)`.
  - **§7 surfaces hosting `ref` / `sha` enablement** — text lives in the cited CR; this CR is the requirement that brought `ref`/`sha` into each surface:

    | SAD surface | Canonical host CR | Note |
    |---|---|---|
    | §7 Visual layout → Attribute vocabulary (`ref` + `sha` rows) | CR-0002 | rows added as part of the picker contract |
    | §7 Configuration — Read API topology (allowed values include `ref`, `sha`) | CR-0003 | topology allow-list extended |
    | §7 API Contract — `correlationAttribute` query parameter (allowed values include `ref`, `sha`) | CR-0003 | query-parameter allow-list extended |
- **References:**
  - **CR-0004** — `ref` / `sha` optional fields on payload (data-side prerequisite).
  - **CR-0002** — Four named views + attribute picker (Display picker host).
  - **CR-0003** — Tree topology + three-layout axis (Topology correlation picker host).
  - SAD §4 FR-05 (text amended by CR-0004 — SPA exposure of `ref`/`sha` as Display and Topology options is stated there).
  - SAD §7 "Visual layout" → "Null-render invariant for nullable attributes".

## SAD-level content owned by this CR — verbatim

### §7 "Null-render invariant for nullable attributes" — cross-reference

> **Null-render invariant for nullable attributes** — canonical text lives in [CR-0003 § Null-render invariant for nullable attributes](CR-0003-tree-topology-and-layout-axis.md) (lines 57–66). CR-0005 extends the invariant's applicability surface to ref/sha display and topology correlation (see the impact list above).

### Dashboard Frontend → Interaction — verbatim addition

> view switcher + per-view attribute picker (FR-12); layout switcher (FR-13: Matrix / Swim-lane / Workflow-rows); correlation-attribute picker (per-user override; written to `localStorage` only; appended as `correlationAttribute` query parameter on read endpoints); view, attribute, layout, and correlation-attribute selection persisted in `localStorage`

### Attribute-vocabulary `ref` / `sha` rows — cross-reference

> **`ref` and `sha` attribute-vocabulary rows** — canonical text lives in [CR-0002 § Attribute vocabulary table — `ref` and `sha` rows](CR-0002-four-named-views-and-attribute-picker.md) (lines 68–69). CR-0005 is the requirement that brought them into the picker; CR-0002 hosts the canonical row content.
