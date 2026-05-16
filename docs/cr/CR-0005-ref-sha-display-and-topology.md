# CR-0005 — `ref` / `sha` exposed as Display picker options and Topology correlation options

- **Status:** accepted
- **Trigger:** `TODO` line 7 — "UX: make ability on UI to use ref and sha attributes for 'Display' and 'Topology' functionality".
- **Change:** The two optional fields added by CR-0004 (`ref`, `sha`) are surfaced through the SPA in two distinct UI affordances:
  1. **Display attribute picker (FR-12)** — `ref` and `sha` are picker options on every view, with per-view caps unchanged. Selecting `ref` or `sha` renders the value on the matrix grid; null/absent values render empty (see "Null-render invariant" below).
  2. **Topology correlation picker (FR-13 / CR-0003)** — `ref` and `sha` are allowed values for the per-request `correlationAttribute` query parameter, the server-side default, and per-service overrides. Choosing `ref` or `sha` as the correlation attribute drives the correlation fallback pass of the topology builder (see ADR-0001 pass 3).

  Display picker selections (per view) persist in `dashboard.attrs.<view>` (`localStorage`). Correlation-attribute selection persists in `dashboard.correlationAttribute` (`localStorage`) and is appended as `?correlationAttribute=…` on read endpoints.

- **Impact:**
  - **§7 Visual layout → Attribute vocabulary** — `ref` and `sha` rows added (already captured in CR-0002 as part of the picker contract; this CR is the requirement that brought them into the picker).
  - **§7 Visual layout → Null-render invariant for nullable attributes** — verbatim text below.
  - **§7 Components → Dashboard Frontend → Interaction** — picker controls described to include `correlation-attribute picker (per-user override; written to `localStorage` only; appended as `correlationAttribute` query parameter on read endpoints)`.
  - **§7 Configuration — Read API topology** allowed values include `ref` and `sha` (already captured in CR-0003).
  - **§7 API Contract — `correlationAttribute` query parameter** allowed values include `ref` and `sha` (already captured in CR-0003).
- **References:**
  - **CR-0004** — `ref` / `sha` optional fields on payload (data-side prerequisite).
  - **CR-0002** — Four named views + attribute picker (Display picker host).
  - **CR-0003** — Tree topology + three-layout axis (Topology correlation picker host).
  - SAD §4 FR-05 (text amended by CR-0004 — SPA exposure of `ref`/`sha` as Display and Topology options is stated there).
  - SAD §7 "Visual layout" → "Null-render invariant for nullable attributes".

## Removed SAD content (verbatim) — captured here

### §7 "Null-render invariant for nullable attributes" — verbatim

> `ref` and `sha` are the two FR-02 attributes that may legitimately be `null` or absent on a wire payload (per §"deployments table" and §"Matrix response shape — per service" → field rules). When the user selects one of these as a Display attribute and the slot's `current.<attr>` (or `lastSuccessful.<attr>`) value is null or absent:
>
> - The attribute slot in the box body renders empty — no text, no placeholder, no the literal string `"null"` / `"undefined"`.
> - The slot's other selected attributes render normally.
> - The 6-box-state determination is unaffected — `ref`/`sha` are display-only and do not feed state derivation (§7 "6 box states", §7 line referenced for matrix-state derivation).
> - The Topology correlation pass (§"Topology Derivation" pass 3) already excludes deployments whose chosen correlation attribute is null on either side (`P.<correlation-attribute>` equals `D.<correlation-attribute>` is `false` when either operand is null) — no additional handling needed.
>
> This invariant generalises the existing "empty array (`[]`) is a legitimate user choice — render the slot body empty" rule (§7 "Load-time hardening rules") from per-view to per-attribute.

### Dashboard Frontend → Interaction — verbatim addition

> view switcher + per-view attribute picker (FR-12); layout switcher (FR-13: Matrix / Swim-lane / Workflow-rows); correlation-attribute picker (per-user override; written to `localStorage` only; appended as `correlationAttribute` query parameter on read endpoints); view, attribute, layout, and correlation-attribute selection persisted in `localStorage`

### Attribute-vocabulary `ref` / `sha` rows — verbatim

| Key | Picker label | Source field | Notes |
|---|---|---|---|
| `ref` | Source ref | `current.ref` | Free-form source identifier — branch name, PR number, tag, or any human-readable git ref. Nullable on the wire (FR-05); when null/absent the picker slot renders empty per the null-render invariant below. No length cap or format constraint (§10 Decision 10 — stricter validation deferred). |
| `sha` | Commit SHA | `current.sha` | Free-form commit SHA. Nullable on the wire (FR-05); when null/absent the picker slot renders empty per the null-render invariant below. The SPA MAY truncate the rendered value for display (e.g. first 7 chars) without altering the underlying stored value; the full value remains in the history drawer (full-attribute disclosure rule). |
