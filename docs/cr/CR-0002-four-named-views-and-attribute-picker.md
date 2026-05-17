# CR-0002 — Four named views (Detailed / Compact / Glance / Focus) and per-view attribute picker

- **Status:** accepted
- **Trigger:** `TODO` line 4 — "UX: analyze how to make UI more compact, usually its much more services than environments (at least 10 services), propose options by making new mockups".
- **Change:** The dashboard exposes **four named layout views** — `Detailed`, `Compact`, `Glance`, `Focus` — selectable from a header segmented control, plus a per-view **attribute picker** that lets the user choose which of the FR-02 attributes appear on the matrix grid (subject to a per-view cap). View selection and per-view attribute selection persist client-side in `localStorage`. The original SAD shipped a single matrix view; this CR makes view selection a first-class UX axis.
- **Impact:**
  - **New FR-12** introduced (see "FR-12 — added" below). Cites `docs/ui-compact-options.md` as the design rationale.
  - **FR-02** amended (verbatim text below): the per-slot attribute set is described as user-configurable (subject to a picker), with explicit carve-outs for the history drawer and Focus expanded rows (the full-attribute disclosure rule).
  - **FR-03** amended: clarifies that the last-successful split section is "always-on and not affected by the attribute picker".
  - **FR-07** amended: filters "apply across every layout view defined in §7 'Visual layout'".
  - **§7 Dashboard Frontend** — new "Visual layout" subsection added.
  - **§7 Visual layout → Layout views** table — defines the 4 views, their intent, default attributes, max attributes, and notes.
  - **§7 Visual layout → Attribute vocabulary** table — defines the 7-attribute matrix grid picker vocabulary (per-attribute key, picker label, source field).
  - **§7 Visual layout → Full-attribute disclosure rule** — the history drawer and Focus-expanded rows always show every attribute, regardless of the picker.
  - **§7 Visual layout → Client-side persistence (`localStorage`)** — `dashboard.view` and four `dashboard.attrs.*` keys with load-time hardening rules.
  - **§7 6 box states (unchanged contract)** — clarifies that the per-view rendering may shrink or recolour the box but the state determination logic is identical across views (the original 6 box states section is preserved).
- **References:**
  - SAD §4 FR-12 (new), FR-02 (amended), FR-03 (amended), FR-07 (amended).
  - SAD §7 "Visual layout" subsection (new).
  - SAD §7 "6 box states (unchanged contract)" — confirms invariance under view switch.
  - `docs/ui-compact-options.md` — full design rationale, per-view density targets, switcher/picker behaviour, cross-cutting behaviours.
  - Mockup `docs/deployment-dashboard.html` — canonical visual + interactive contract.

## SAD-level content owned by this CR — verbatim

### FR-12 — added

> The dashboard shall expose four named layout views — **Detailed**, **Compact**, **Glance**, **Focus** — and an attribute picker that lets the user choose which of the FR-02 attributes appear on the matrix grid, subject to a per-view cap. View selection and per-view attribute selection persist client-side in `localStorage`. See §7 "Visual layout" for the contract.

### FR-02 — amended (verbatim post-amendment text)

> Each slot shall be capable of showing: version, status (success / in-progress / failure), actor, elapsed time since deployment, a link to the CI/CD run, source ref, and commit SHA. The user may select a subset of these attributes for the matrix view via the attribute picker (FR-12); the history drawer and any Focus-view expanded row always show every attribute (see §7 "Full-attribute disclosure rule"). `ref` and `sha` are nullable on the wire (FR-05; §7 "deployments table"); when null/absent on a slot the picker still renders the attribute slot empty rather than the literal string `null` (see §7 "Null-render invariant for nullable attributes").

### FR-03 — amended (verbatim post-amendment text)

> When the current state is in-progress or failed, the slot shall also show the last successfully deployed version in a split section below the current state. This element is always-on and is not affected by the attribute picker (FR-12).

### FR-07 — amended (verbatim post-amendment text)

> The dashboard shall support filtering by service name and by failure state only. Both filters apply across every layout view defined in §7 "Visual layout".

### §7 "Visual layout" — new subsection in the SAD (verbatim)

> The canonical visual + interactive contract lives in `docs/deployment-dashboard.html`. The decision record for the four-views design — defaults, caps, switcher behaviour, persistence rules — lives in `docs/ui-compact-options.md`. This section describes only the contract that other tiers must honour.
>
> **Layout views (FR-12):**
>
> The dashboard renders four named views. The user switches between them via a segmented control in the header; the active view is persisted in `localStorage` (`dashboard.view`). The default for first-time visitors is **Detailed**.
>
> | View | Intent | Default attributes shown | Max attributes | Notes |
> |---|---|---|---|---|
> | **Detailed** | Default first-visit view; full information density | `status`, `version`, `run`, `ago`, `actor` | 7 | The original canonical pipeline-matrix layout (services × environments, full-size slot boxes). Cap accommodates all seven FR-02 attributes (`status`, `version`, `run`, `ago`, `actor`, `ref`, `sha`); defaults are the canonical first-paint five. |
> | **Compact** | Dense matrix targeting ~15 services per viewport | `status`, `version`, `run`, `ago` | 5 | Same layout shape as Detailed — services × environments — every dimension shrunk; status colour and split section preserved. Cap raised by one to allow one of `actor` / `ref` / `sha` alongside the default four without forcing a deselection. |
> | **Glance** | Maximum-density list, ~25+ services per viewport | `version` (in coloured pill) | 1 | One row per service; environments rendered as coloured pills inline (not columns); click pill → drawer. Cap is 1 by design — the pill body has room for exactly one attribute; users may swap `version` for any of `status`, `run`, `ago`, `actor`, `ref`, `sha`. |
> | **Focus** | Compact rows by default; click chevron to expand a row to full Detailed-size fidelity | `status`, `version`, `run`, `ago` (collapsed) | 5 (collapsed); expanded rows always show all 7 (see "Full-attribute disclosure rule") | A row pin keeps an expanded row open across filter changes. |
>
> **Attribute vocabulary:**
>
> The matrix attribute picker exposes the seven FR-02 attributes. Each one is bound to a specific source field on the matrix-slot wire shape (see §"API Contract" → "Matrix response shape — per service"):
>
> | Key | Picker label | Source field | Notes |
> |---|---|---|---|
> | `status` | Status badge | `current.status` | Renders the success / failed / running text badge in the slot body. Distinct from the always-on status colour treatment of the slot background. |
> | `version` | Version | `current.version` | Semver string. |
> | `run` | Run number | `current.run_number` (linked via `current.run_url`) | Renders the run number; the `run_url` link is bound to the same attribute (no separate picker entry). |
> | `ago` | Elapsed time | `current.deployed_at` (rendered relative) | Relative time, e.g. `3m ago`. |
> | `actor` | Actor | `current.actor` | Who triggered the deploy. |
> | `ref` | Source ref | `current.ref` | Free-form source identifier — branch name, PR number, tag, or any human-readable git ref. Nullable on the wire (FR-05); when null/absent the picker slot renders empty per the null-render invariant below. No length cap or format constraint (§10 Decision 10 — stricter validation deferred). |
> | `sha` | Commit SHA | `current.sha` | Free-form commit SHA. Nullable on the wire (FR-05); when null/absent the picker slot renders empty per the null-render invariant below. The SPA MAY truncate the rendered value for display (e.g. first 7 chars) without altering the underlying stored value; the full value remains in the history drawer (full-attribute disclosure rule). |
>
> The absolute `current.deployed_at` timestamp is rendered only in the history drawer; it is not a matrix-picker option.
>
> **Always-on elements (not affected by the picker):**
>
> These elements are part of the 6-box-state contract (FR-03) or of the matrix visual treatment, and render in every view regardless of the user's attribute-picker state:
>
> - **Slot background status colour treatment** — green / red / orange — including the in-progress pulse animation.
> - **`⚠ prev. failed` badge** — rendered when `previousFailed === true` (FR-03).
> - **Last-successful split section** — dashed divider plus the last-successful version and elapsed time — rendered when `lastSuccessful` is non-null (FR-03). The attribute picker controls the top (current) section only; the bottom section is always shown when present.
>
> **6 box states (unchanged contract):** see "§7 6 box states (unchanged contract) — verbatim addition" section below for the two clarifications this CR contributes to SAD §7 "6 box states".
>
> **Full-attribute disclosure rule:**
>
> The side-panel history drawer and the Focus view's expanded rows always display every deployment attribute available to the user, regardless of the matrix attribute picker. The picker constrains what is rendered on the matrix grid only; the drawer and the Focus-expanded row are full-fidelity detail surfaces. Frontend and QA cite this rule when verifying that hidden picker attributes still surface in the drawer or in an expanded Focus row.
>
> **Client-side persistence (`localStorage`):**
>
> View selection and per-view attribute selection are pure client-side UI state — no backend wire impact, no server round-trip on toggle.
>
> | Key | Value shape | Example | Cap |
> |---|---|---|---|
> | `dashboard.view` | one of `'detailed'`, `'compact'`, `'glance'`, `'focus'` (string) | `"compact"` | n/a |
> | `dashboard.attrs.detailed` | JSON array of attribute keys (`string[]`) | `["status","version","run","ago","actor","ref","sha"]` | ≤ 7 |
> | `dashboard.attrs.compact` | JSON array (`string[]`) | `["status","version","run","ago","sha"]` | ≤ 5 |
> | `dashboard.attrs.glance` | JSON array (`string[]`) | `["ref"]` | ≤ 1 |
> | `dashboard.attrs.focus` | JSON array (`string[]`) | `["status","version","run","ago","ref"]` | ≤ 5 |
>
> Load-time hardening rules:
> - Wrap every `JSON.parse` in `try / catch`. Any throw → fall back to the view's default attribute set.
> - If the parsed value is not an array → fall back to defaults.
> - Filter the array to known attribute keys only (`status`, `version`, `run`, `ago`, `actor`, `ref`, `sha`); unknown keys are silently dropped.
> - If the filtered array exceeds the view's cap → truncate to the cap.
> - An empty array (`[]`) is a legitimate user choice — render the slot body empty, leaving only the always-on elements. Do not auto-restore defaults in this case.
> - For `dashboard.view`: if the persisted string is not in the allowed set, fall back to `detailed`.
>
> Filters (search by service name, failures-only toggle) and the stats bar are cross-cutting and apply identically across all four views.

### §7 "6 box states (unchanged contract)" — verbatim addition

The 6-box-states table itself is unchanged; see SAD §7 "6 box states" for the canonical rows. This CR contributes two clarifications to that section:

> Each box still resolves to one of six states based on the slot's wire shape. Per-view rendering may shrink or recolour the box, but the state determination logic is identical across views.

> Boxes share a version highlight on hover — hovering a version amber-highlights all boxes (and Glance pills) across environments where the same version is deployed, making it easy to trace promotion progress. Hover highlight applies in every view.

### Later additions to the localStorage table

These rows of the `localStorage` table were added by later CRs and live in those CR documents — together with their own load-time hardening rules.

| Key | Added by |
|---|---|
| `dashboard.layout` | CR-0003 |
| `dashboard.correlationAttribute` | CR-0003 |
| `dashboard.theme` | CR-0006 |
