---
title: E2E Feature Coverage Matrix
nav_order: 99
---

# E2E Feature Coverage Matrix

**NFR-QA-01** — Feature-coverage completeness gate: every row in `docs/features.md` is mapped to ≥1 spec under `testing/e2e/tests/`. Rows explicitly out-of-scope or deferred are noted.

Source of truth for the feature inventory: `docs/features.md`.
Runner: `testing/e2e/run-tests.ps1`.
Deferred-layout reactivation checklist: `testing/e2e/scenarios/deferred-phase-2.0/README.md`.

---

## Data ingestion

| Feature row | Spec(s) | Status |
|---|---|---|
| Write endpoint — `POST /api/deployments`, API-key gated | `auth-write-rejection.spec.ts`, `realtime-sse-update.spec.ts`, `discovery-no-hardcoding.spec.ts` | COVERED |
| Payload contract — JSON envelope fields (service, env, version, status, actor, run_url) | `realtime-sse-update.spec.ts` (sends full payload, asserts slot + version); attribute-picker specs assert per-field rendering | COVERED |
| Per-tool snippets (GitHub Actions, ADO, Jenkins, GitLab CI, curl) | — | OUT-OF-SCOPE — documentation surface, no SPA-testable behaviour |
| Optional pull-mode fetcher (CR-0009 GHA adapter) | — | OUT-OF-SCOPE — backend/infra concern, no SPA surface |
| Anonymous-mode transport (zero-PAT demo path) | — | OUT-OF-SCOPE — infra concern, no SPA surface |

---

## Views and layouts

**MVP active layouts:** swim-lane, workflow-rows.
**Deferred layout:** matrix (Phase 2.0 — see `testing/e2e/scenarios/deferred-phase-2.0/README.md`).

| Combination | Spec(s) | Status |
|---|---|---|
| swim-lane × detailed | `layout-x-view-combinations.spec.ts`, `spa-visual-invariants.spec.ts`, `display-toggle-renders-per-layout.spec.ts`, `swim-lane-detailed-ngx-graph.spec.ts`, `swim-lane-detailed-visual-parity.spec.ts`, `swim-lane-connectors.spec.ts` | COVERED |
| swim-lane × compact | `layout-x-view-combinations.spec.ts`, `spa-visual-invariants.spec.ts`, `display-toggle-renders-per-layout.spec.ts` | COVERED |
| swim-lane × glance | `layout-x-view-combinations.spec.ts`, `spa-visual-invariants.spec.ts`, `display-toggle-renders-per-layout.spec.ts`, `glance-envtag-inside-pill.spec.ts` | COVERED |
| swim-lane × focus | `layout-x-view-combinations.spec.ts`, `spa-visual-invariants.spec.ts`, `display-toggle-renders-per-layout.spec.ts`, `focus-view-distinct-from-compact.spec.ts` | COVERED |
| workflow-rows × detailed | `layout-x-view-combinations.spec.ts`, `spa-visual-invariants.spec.ts`, `display-toggle-renders-per-layout.spec.ts`, `workflow-rows-expand-row.spec.ts` | COVERED |
| workflow-rows × compact | `layout-x-view-combinations.spec.ts`, `spa-visual-invariants.spec.ts`, `display-toggle-renders-per-layout.spec.ts` | COVERED |
| workflow-rows × glance | `layout-x-view-combinations.spec.ts`, `spa-visual-invariants.spec.ts`, `display-toggle-renders-per-layout.spec.ts` | COVERED |
| workflow-rows × focus | `layout-x-view-combinations.spec.ts`, `spa-visual-invariants.spec.ts`, `display-toggle-renders-per-layout.spec.ts` | COVERED |
| matrix × detailed | `deferred-phase-2.0/matrix-six-box-states.spec.ts` (inactive) | DEFERRED — Phase 2.0 |
| matrix × compact | — | DEFERRED — Phase 2.0 |
| matrix × glance | — | DEFERRED — Phase 2.0 |
| matrix × focus | `deferred-phase-2.0/matrix-focus-env-header-alignment.spec.ts` (inactive) | DEFERRED — Phase 2.0 |

Additional view/layout coverage:

| Feature row | Spec(s) | Status |
|---|---|---|
| View switcher persistence (localStorage `dashboard.view`) | `view-switcher-persists.spec.ts` | COVERED |
| Layout switcher persistence (localStorage `dashboard.layout`) | `layout-switcher-persists.spec.ts` | COVERED |
| View × layout orthogonality | `layout-switcher-persists.spec.ts` ("Layout switch does not mutate the view selection") | COVERED |
| Attribute picker caps per view (FR-02 / FR-12) | `attribute-picker-cap-enforcement.spec.ts` | COVERED |
| Attribute picker persistence | `attribute-picker-persistence.spec.ts`, `picker-ref-sha-checkboxes.spec.ts` | COVERED |
| Attribute picker reactivity across layouts | `display-toggle-renders-per-layout.spec.ts` | COVERED |
| ref/sha nullable attributes — no "null" literal render | `null-render-ref-sha.spec.ts` | COVERED |
| SHA display truncation (7 chars + ellipsis on grid) | `sha-truncation.spec.ts` | COVERED |
| Header search filter | `filter-search-and-failures-only.spec.ts` | COVERED |
| Header failures-only toggle | `filter-search-and-failures-only.spec.ts` | COVERED |
| Focus-on-last-event header toggle | `focus-on-last-event-toggle.spec.ts` | COVERED |
| NFR-09 geometric invariants (6 invariants × 8 active combos) | `spa-visual-invariants.spec.ts`, `overlap-invariants.spec.ts` | COVERED |
| Service name no-clip (4 views × 2 layouts × 2 themes = 16 combos) | `service-name-no-clip-universal.spec.ts` | COVERED |
| Env-tag column alignment (workflow-rows) | `env-tag-column-alignment.spec.ts` | COVERED |
| Topology correlation picker (localStorage + ?correlationAttribute=) | `correlation-picker-localstorage-and-no-api-key.spec.ts`, `topology-picker-ref-sha-query-param.spec.ts` | COVERED |
| Topology edges re-render after correlationAttribute switch | `topology-toggle-edge-rerender.spec.ts` | COVERED |
| Swim-lane connector geometry | `swim-lane-connectors.spec.ts` | COVERED |
| Discovery — env/service lists from API, not hardcoded | `discovery-no-hardcoding.spec.ts` | COVERED |
| Rate-limit cluster renders (CR-0011 / ADR-0008) | `rate-limit-cluster-renders.spec.ts` | COVERED |
| Rate-limit cluster reflow | `rate-limit-cluster-reflow.spec.ts` | COVERED |
| Rate-limit cluster stale affordance | `rate-limit-cluster-stale.spec.ts` | COVERED |

---

## Box states

All six canonical box states from `docs/features.md § Box states`.

| State | `data-state` token | Spec(s) | Status |
|---|---|---|---|
| Success | `success` | `six-box-states-active-layouts.spec.ts`, `theme-box-state-contract-under-dark.spec.ts` | COVERED |
| Running + Last Successful | `running-with-last` | `six-box-states-active-layouts.spec.ts`, `theme-box-state-contract-under-dark.spec.ts` | COVERED |
| Running + Failed + Last Successful | `running-prev-failed-with-last` | `six-box-states-active-layouts.spec.ts`, `theme-box-state-contract-under-dark.spec.ts` | COVERED |
| Failed + Last Successful | `failed-with-last` | `six-box-states-active-layouts.spec.ts`, `theme-box-state-contract-under-dark.spec.ts` | COVERED |
| Running | `running` | `six-box-states-active-layouts.spec.ts`, `theme-box-state-contract-under-dark.spec.ts` | COVERED |
| Running + Failed | `running-prev-failed` | `six-box-states-active-layouts.spec.ts`, `theme-box-state-contract-under-dark.spec.ts` | COVERED |

Note: `deferred-phase-2.0/matrix-six-box-states.spec.ts` covers the same six states against the Matrix layout; it is inactive until Phase 2.0.

---

## Themes

| Feature row | Spec(s) | Status |
|---|---|---|
| Light — force light palette | `theme-switcher-popover-open-and-select.spec.ts`, `theme-switcher-persists-across-reload.spec.ts`, `theme-switcher-foit-safe-initial-paint.spec.ts` | COVERED |
| Dark — force dark palette | `theme-switcher-popover-open-and-select.spec.ts`, `theme-switcher-persists-across-reload.spec.ts`, `theme-switcher-foit-safe-initial-paint.spec.ts`, `theme-box-state-contract-under-dark.spec.ts` | COVERED |
| Auto — follows `prefers-color-scheme` | `theme-switcher-auto-follows-os-preference.spec.ts`, `theme-switcher-foit-safe-initial-paint.spec.ts` | COVERED |
| Theme switch via popover (gear button) | `theme-switcher-popover-open-and-select.spec.ts` | COVERED |
| Theme persistence in localStorage | `theme-switcher-persists-across-reload.spec.ts` | COVERED |
| Auto follows OS live (MQL change listener) | `theme-switcher-auto-follows-os-preference.spec.ts` | COVERED |
| FOIT-free inline bootstrap | `theme-switcher-foit-safe-initial-paint.spec.ts` | COVERED |
| Invalid persisted value normalises to auto | `theme-switcher-invalid-persisted-value-falls-back-to-auto.spec.ts` | COVERED |
| Box-state semantic contract preserved under dark palette | `theme-box-state-contract-under-dark.spec.ts` | COVERED |

---

## Real-time updates

| Feature row | Spec(s) | Status |
|---|---|---|
| SSE update propagation (POST → DOM) | `realtime-sse-update.spec.ts` | COVERED |
| Latency budget ≤5 s (NFR-03) | `realtime-sse-update.spec.ts` | COVERED |
| Reconnection via `Last-Event-ID` (NFR-05) | `realtime-sse-reconnect.spec.ts` | COVERED — Part 2 (catchup delivery) passes green; Part 1 (header assertion) is `test.fail()` pending SPA fix in [#124](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/124) |
| No page reload on live update | `realtime-sse-update.spec.ts` | COVERED |

---

## History

| Feature row | Spec(s) | Status |
|---|---|---|
| Slot history drawer — open from slot click | `drawer-history.spec.ts` | COVERED |
| Drawer current panel (version + status badge) | `drawer-history.spec.ts` | COVERED |
| Drawer last-successful panel | `drawer-history.spec.ts` | COVERED |
| Per-slot history list (≥3 entries, chronological) | `drawer-history.spec.ts` | COVERED |
| Drawer close button | `drawer-history.spec.ts` | COVERED |
| Full-attribute disclosure (drawer shows all 7 FR-02 attrs) | `full-attribute-disclosure.spec.ts` | COVERED |
| SHA full value in drawer (no truncation) | `sha-truncation.spec.ts`, `full-attribute-disclosure.spec.ts` | COVERED |
| Drawer keeps open across view switch | `view-switch-keeps-drawer-open.spec.ts` | COVERED |
| History retention ≥90 days (NFR-07) | — | OUT-OF-SCOPE — backend retention window; no SPA-visible test surface beyond history list length |

---

## Internal-tooling posture

| Feature row | Spec(s) | Status |
|---|---|---|
| Auth on Write group — 401 on missing/wrong API key | `auth-write-rejection.spec.ts` | COVERED |
| No X-Api-Key from SPA (NFR-04) | `correlation-picker-localstorage-and-no-api-key.spec.ts`, `topology-picker-ref-sha-query-param.spec.ts` | COVERED |
| No PATCH /api/config/topology from SPA | `correlation-picker-localstorage-and-no-api-key.spec.ts`, `topology-picker-ref-sha-query-param.spec.ts` | COVERED |
| Read group — unauthenticated (NFR-04) | `discovery-no-hardcoding.spec.ts` (GET endpoints called without auth) | COVERED |

---

## CI gate

| Item | Status |
|---|---|
| `testing/e2e/run-tests.ps1` exits with Playwright exit code | IMPLEMENTED — propagates exit code directly |
| CI workflow `.github/workflows/e2e.yml` | NOT YET — tracked in follow-up (see Outstanding follow-ups below) |

---

## Outstanding follow-ups

Issues filed at the end of the Phase 4 authoring cycle:

| # | Title | Scope |
|---|---|---|
| [#122](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/122) | Add a CI workflow that runs the Playwright e2e suite automatically on every PR | Blocked on issue #66 (install.ps1 `-BuildLocally`); devops-engineer owns the workflow YAML |
| [#123](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/123) | Register NFR-QA-01 in `docs/architecture.md` §5 NFR register | SA-owned; identifier `NFR-QA-01` already in use in this doc and scenario files |
| [#124](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/124) | SPA does not send Last-Event-ID on SSE reconnect (NFR-05 gap) | frontend-engineer owns; `realtime-sse-reconnect.spec.ts` Part 1 is `test.fail()` pending this fix |
