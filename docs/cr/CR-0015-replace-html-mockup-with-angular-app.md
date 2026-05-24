---
title: "CR-0015: Replace HTML Mockup with Static Angular Mockup App"
parent: CRs
nav_order: 15
---

# CR-0015 — Replace HTML mockup with static Angular mockup app at `mockup/` (repo root)

- **Status:** Proposed 2026-05-25
- **Trigger:** GitHub issue [#79](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/79) — *"Static Angular mockup app — replace HTML mockup at mockup/ (repo root)."*

  Today the visual contract lives in two parallel implementations of the same UI — the HTML mockup at `docs/ui/mockups/deployment-dashboard.html` (~4400 LOC Alpine + Tailwind) and the SPA at `frontend/dashboard/` (Angular standalone + NgRx Signal Store + Tailwind). Every visual change pays a dual-implementation tax: mockup uses `<template x-if>` blocks with Alpine-scoped state; SPA uses `<dd-layout-leaf>` Angular components. The recent issue #54 cycle (Swim-lane DAG layered layout) burned 6 iterations attempting to integrate `dagre` via `<foreignObject>` because Alpine scope broke under the SVG nesting, while the equivalent SPA work (planned `<ng-template #nodeTemplate>` approach) would have been mechanically clean but was blocked behind mockup-first synchronisation. CR-0015 replaces the HTML mockup with a static Angular mockup app at `mockup/` (repo root) that composes the existing `@dd/matrix` + `@dd/shared` + `@dd/drawer` libraries against fixture data — same components as the SPA, byte-identical chrome by construction.

- **Co-owned by:** `team-lead` (CR-0015 + cross-references + `local/framework.config.yaml` + `local/bindings.md` amendments) · `solution-architect` (architectural-coherence review per D25 + ADR-0011 mockup-app architecture authorship) · `frontend-engineer` (mockup-app scaffold + layouts + header migration to `@dd/matrix` + variant fixtures + 7-route composition) · `devops-engineer` (root `package.json` npm-workspaces declaration + `.github/workflows/frontend.yml` adjustment) · `qa-engineer` (out-of-scope this cycle; activates in the sibling retirement issue's cycle).

- **Co-owned doc surface:**

  | Surface | Semantics owner | Operational examples / shape owner |
  |---|---|---|
  | This CR | `team-lead` | `solution-architect` (architectural-coherence review) |
  | [ADR-0011](./../adr/ADR-0011-mockup-app-architecture.md) — mockup-app architecture | `solution-architect` | — |
  | `mockup/` (Angular standalone app) | `frontend-engineer` | — |
  | Root `package.json` (npm workspaces declaration) | `devops-engineer` | — |
  | `frontend/matrix/src/lib/{dashboard-header,swim-lane-layout,workflow-rows-layout}.component.ts` + `topology-utils.ts` (post-migration) | `frontend-engineer` | — |
  | `local/framework.config.yaml § mockup-spa` (new sibling key — transitional) | `team-lead` | — |
  | `local/bindings.md` (new row for `mockup/`) | `team-lead` | — |

- **Change.** Five concerns addressed in this cycle. Retirement of the legacy HTML mockup + harness retargeting are explicitly **out of scope** and tracked under a sibling tech-debt issue (filed alongside #79; labelled `ginee:blocked` until #79 merges).

  - **3a — Mockup-app at `mockup/` (repo root).** New Angular 20 standalone application authored at `mockup/` — sibling of `frontend/`, `backend/`, `gateway/`, `install/`, `dev_env/`, `docs/`, `testing/`. The mockup-app is **not** placed inside the existing `frontend/` Angular workspace; it lives at the same level as the other top-level concerns. Rationale + alternatives evaluated in ADR-0011.

    | Aspect | Choice |
    |---|---|
    | Path | `mockup/` at repo root |
    | Angular project | Standalone Angular 20 application (not a library) |
    | Prefix | `dd-mockup` (avoids selector collision with `frontend/dashboard/`'s `dd` prefix) |
    | Dev server port | 4201 (avoids dashboard's default 4200) |
    | Production build | `mockup/dist/` static bundle; deployment out-of-scope for v1 |
    | Test runner | Karma (same as `frontend/`) |

  - **3b — npm workspaces at repo root + TypeScript path aliases.** A new root `package.json` declares an npm workspace `["frontend", "mockup"]`. `node_modules` hoists to repo root; a single `npm install` installs the union. The mockup-app consumes `@dd/matrix` + `@dd/shared` + `@dd/drawer` via TypeScript path aliases in `mockup/tsconfig.json` pointing back at `../frontend/{matrix,shared,drawer}/src/public-api.ts` — same alias pattern `frontend/tsconfig.base.json` already uses internally. Zero build step between source edit and mockup render; hot reload on `frontend/matrix/src/**` is immediately visible to `ng serve mockup`. ADR-0011 § Alternatives Considered records the rejection of file-package and TS-aliases-only variants.

    | Aspect | Decision |
    |---|---|
    | Mechanism | npm workspaces (npm 7+) |
    | Root `package.json` | New file; `{ "name": "deployment-dashboard-workspace", "private": true, "workspaces": ["frontend", "mockup"] }` |
    | `node_modules` location | Hoisted to repo root |
    | Install command | `npm install` at repo root (single invocation) |
    | Library consumption | TS path aliases (`@dd/matrix` → `../frontend/matrix/src/public-api.ts` etc.) |
    | Version drift | Eliminated by construction (single hoisted dep tree) |
    | `frontend/package.json` | `"private": true` already present; no schema change required |

  - **3c — Layouts + header migration to `@dd/matrix` (structural prerequisite).** The mockup-app and the SPA must compose the **same** components, not separate copies, for byte-identical chrome to hold by construction. Three components currently sit in `frontend/dashboard/src/app/` but were always shared-shaped — they depend only on `@dd/shared` types and the `DeploymentMatrixStore`. They migrate to `frontend/matrix/src/lib/` and re-export via `@dd/matrix`. The dashboard re-imports them from `@dd/matrix`; no behavioural change.

    | Source | Destination | New `@dd/matrix` export? |
    |---|---|---|
    | `frontend/dashboard/src/app/dashboard-header.component.ts` | `frontend/matrix/src/lib/dashboard-header.component.ts` | yes |
    | `frontend/dashboard/src/app/swim-lane-layout.component.ts` | `frontend/matrix/src/lib/swim-lane-layout.component.ts` | yes |
    | `frontend/dashboard/src/app/workflow-rows-layout.component.ts` | `frontend/matrix/src/lib/workflow-rows-layout.component.ts` | yes |
    | `frontend/dashboard/src/app/topology-utils.ts` | `frontend/matrix/src/lib/topology-utils.ts` | exported via `@dd/matrix` if other matrix-internal consumers emerge; otherwise file-internal |

    Verification: dashboard Karma + production build remain green post-migration. Import paths change in `frontend/dashboard/src/app/app.component.ts` (currently imports `./dashboard-header.component`, `./swim-lane-layout.component`, `./workflow-rows-layout.component` — switches to `@dd/matrix` barrel).

    `topology-utils.ts` consumer audit performed in Phase 4 step 4.3 sub-batch A before migration commits.

  - **3d — Seven routes (3 canonical + 4 variant).** The mockup-app exposes seven routes; the four variant routes establish the PoC sandbox capability that replaces the per-option mockup-HTML pattern (`env-tag-column-alignment-variant-{a,b}.html` etc.).

    | Path | Purpose | Lazy-loaded? |
    |---|---|---|
    | `/` | Redirect to `/swim-lane` | n/a |
    | `/swim-lane` | Canonical Swim-lane layout, canonical fixtures | no |
    | `/workflow-rows` | Canonical Workflow-rows layout, canonical fixtures | no |
    | `/invariants` | NFR-09 + I0-I12 catalogue sourced from `testing/mockup-visual/harness.config.json` | yes |
    | `/variants/branching-dag` | PoC slot for issue #54 — Swim-lane + branching topology fixture | yes |
    | `/variants/disconnected` | PoC slot — disconnected sub-components fixture | yes |
    | `/variants/env-tag-a` | Ported from `docs/ui/mockups/env-tag-column-alignment-variant-a.html` | yes |
    | `/variants/env-tag-b` | Ported from `docs/ui/mockups/env-tag-column-alignment-variant-b.html` | yes |

    Variant fixtures (`FIXTURE_TOPOLOGY_BRANCHING`, `FIXTURE_TOPOLOGY_DISCONNECTED`) author into `frontend/shared/src/lib/fixtures.ts` or a sibling `fixtures-variants.ts` (frontend-engineer chooses based on size). The `/invariants` page reads `testing/mockup-visual/harness.config.json` at build time (`import` via Angular's JSON loader) so the invariant catalogue stays single-source.

  - **3e — State bootstrap differs only in seed source.** Mockup-app reuses the `DeploymentMatrixStore` from `@dd/shared` unchanged. The store contract is identical to the SPA's; only the bootstrap differs.

    | Concern | SPA (`frontend/dashboard/`) | Mockup-app (`mockup/`) |
    |---|---|---|
    | Environments seed | `ApiClientService.environments()` with `FIXTURE_ENVIRONMENTS` fallback | `store.setEnvironments(FIXTURE_ENVIRONMENTS)` synchronously |
    | Services seed | `ApiClientService.services()` with `FIXTURE_SERVICES` fallback | `store.setServices(FIXTURE_SERVICES)` synchronously |
    | Matrix seed | `ApiClientService.matrix(...)` with `FIXTURE_MATRIX` fallback | `store.setMatrix(FIXTURE_MATRIX)` (or variant-specific) synchronously |
    | Topology seed | from matrix response with `FIXTURE_TOPOLOGY` fallback | `store.setTopology(FIXTURE_TOPOLOGY)` (or variant-specific) synchronously |
    | SSE subscription | `SseService.connect()` + `slotUpdates$` wiring | omitted; no live updates |
    | Topology config | `ApiClientService.topologyConfig()` with `FIXTURE_TOPOLOGY_CONFIG` fallback | `store.setTopologyConfig(FIXTURE_TOPOLOGY_CONFIG)` synchronously |

    Components observe the same store and are unaware of which app hosts them. The `<dd-history-drawer>` is included for visual parity but is static (no drawer-open events without click).

  - **3f — Transitional source-of-truth via `mockup-spa:` sibling key.** `local/framework.config.yaml` adds a sibling key `mockup-spa: mockup/` alongside the existing `mockup: docs/ui/mockups/deployment-dashboard.html`. Both keys coexist for the cycle between this CR's merge and the sibling retirement issue's merge. On retirement, the HTML `mockup:` key repoints to `mockup/` (or is deleted in favour of `mockup-spa:` — the retirement CR locks that detail). Rationale: the staged switch avoids a windowless cutover and lets users compare HTML mockup vs mockup-app side-by-side for one cycle.

    | Cycle stage | `mockup:` value | `mockup-spa:` value |
    |---|---|---|
    | Pre-CR-0015 | `docs/ui/mockups/deployment-dashboard.html` | (absent) |
    | Post-CR-0015 (transitional) | `docs/ui/mockups/deployment-dashboard.html` (unchanged) | `mockup/` (new) |
    | Post-retirement CR (sibling issue) | (collapsed to one key per that CR's lock) | — |

  - **3g — `local/bindings.md` adds row for `mockup/`.** New row in the Source-of-truth ownership table: `mockup/` owned by `frontend-engineer`; `solution-architect` reviews for architectural coherence. The existing HTML mockup row (`docs/ui/mockups/deployment-dashboard.html`) remains unchanged for the transitional cycle — its row is amended by the sibling retirement CR.

- **Consequences.**

  **Positive.**
  - Dual-implementation cost between mockup and SPA is eliminated by construction — same components, same store contract, same Tailwind classes. PoC work in the mockup-app ports to SPA via copy-paste of a single layout-component file.
  - PoC sandbox capability ships in v1 — four variant routes demonstrate the pattern; future per-option work (e.g. Phase 2.0 Matrix layout reintroduction per `TODO` line 20) lands as new `/variants/*` routes rather than new HTML mockups.
  - Single npm workspace at repo root simplifies dependency management across `frontend/` + `mockup/`; version drift between Angular peers is impossible by construction.
  - Visual contract is now executable + browseable — the `/invariants` route renders the NFR-09 / I0-I12 catalogue from a single source (`testing/mockup-visual/harness.config.json`).
  - Lessons from issue #54's 6-iteration burn directly addressed — future graph-layer integration (dagre, ngx-graph, custom layered algorithm) lands in real Angular components against the real `DeploymentMatrixStore`, not against Alpine-scoped HTML proxies.

  **Negative.**
  - New top-level directory at repo root (`mockup/`) — additional repo surface. Mitigated by the directory's narrow purpose (one Angular app); no nested complexity.
  - Transitional state — two source-of-truth keys (`mockup:` + `mockup-spa:`) coexist for one cycle until the sibling retirement issue merges. Mitigated by the explicit `mockup-spa:` naming and the sibling-issue chain (`ginee:blocked` → `ginee:ready` on this PR's merge).
  - Three components migrate from `frontend/dashboard/src/app/` to `frontend/matrix/src/lib/` — touches dashboard import paths. Mitigated by mechanical nature of the change (no behavioural delta) + Karma + production build as the regression gate.
  - Root `package.json` is a net-new file at repo root — adopters cloning the repo must run `npm install` at root rather than at `frontend/`. Mitigated by documenting the change in `README.md` + `CONTRIBUTING.md` updates (out-of-scope for this CR; team-lead lands as a doc-opt hook on Phase 8 acceptance).
  - HTML mockup remains the canonical visual contract for one transitional cycle. Mitigated by the sibling retirement issue's blocking link to this PR's merge.

- **Alternatives Considered.**

  Issue #79 surfaced the workspace-mechanism choice (a / b / c) explicitly. ADR-0011 records the architecture-level rejection of `frontend/mockup/` (in-workspace) in favour of `mockup/` (repo root). This CR records only the workspace-mechanism decision.

  | Alternative | Rejected because |
  |---|---|
  | **(a) File packages** — `mockup/package.json` declares `"@dd/matrix": "file:../frontend/dist/matrix"` etc. | Requires `ng build matrix` + `ng build shared` + `ng build drawer` before every mockup-app run; build-step friction; `dist/` becomes a synchronisation surface; PoC iteration loop ~10 s longer per change. |
  | **(b) TS path aliases only** — `mockup/tsconfig.json` paths point at `../frontend/{matrix,shared,drawer}/src/public-api.ts`; mockup has its own isolated `node_modules` | Two `node_modules` trees with duplicated Angular + NgRx + tslib; version-drift risk between `frontend/package.json` and `mockup/package.json`; Angular peer-dep warnings under strict mode. |
  | **(c) npm workspaces at repo root + TS path aliases** | **PICKED.** Single hoisted `node_modules`; one `npm install`; version drift impossible; idiomatic 2026 Angular workspace consumption; zero build step between source edit and mockup render. Same TS-alias mechanism `frontend/tsconfig.base.json` already uses internally. When `mockup/` eventually retires, removing it = drop the workspace entry; zero cleanup elsewhere. |

  **Tools available (non-binding).** The `web-design-reviewer` skill (installed at `.claude/skills/web-design-reviewer/`) is available for ad-hoc visual-regression review during Phase 4 sub-batches and Phase 7 SA review. Use is optional; the skill is not gated into any phase. Skill-runner's standing Playwright capture + my-vision Read protocol remains the operational visual-verification surface for this cycle (since the mockup-visual harness stays HTML-targeted until the sibling retirement issue's cycle).

- **No new FR / NFR.** This CR refactors the visual-contract surface; it does not amend any frozen requirement. NFR-09 (UX reflow invariant) is preserved by construction — the mockup-app composes the same components that already honour the invariant. FR-12 (four views) + FR-13 (two layouts) are preserved by construction — the mockup-app composes the same switchers + layout components.

- **One new ADR.** [ADR-0011](./../adr/ADR-0011-mockup-app-architecture.md) — mockup-app architecture (location, workspace mechanism, fixture model, dashboard relationship). Authored by SA in parallel with this CR per the D25 governance-pair pattern. CR-0015 cites ADR-0011 for architectural rationale; ADR-0011 cites CR-0015 for change-record context.

- **No SAD edit.** `docs/architecture.md` is unchanged by this CR — no new ASR row, no FR/NFR amendment, no §10 decision row, no §7 component table change. Readers follow the chain `architecture.md → CR-0015 → ADR-0011` only when mockup-app concerns arise; SAD frozen surface is untouched. The SAD's "Mockup ↔ Angular SPA bridge" section (§7) currently cites `docs/ui/mockups/deployment-dashboard.html` as the visual contract; on the sibling retirement issue's merge, that citation updates to `mockup/`. CR-0015 does not perform that edit (sibling CR's scope).

## Acceptance criteria

Mirrors issue #79's AC verbatim — frontend-engineer owns 2, 3, 4, 5, 6 (sub-batches A / B / C / D); devops-engineer owns 1; team-lead owns 8, 9 (this CR's amendments); 7 + 10 are shared between team-lead (drafting the sibling issue) + this CR's PR landing as the trigger.

- [ ] AC #1 — Root `package.json` declares npm workspaces `["frontend", "mockup"]`; `npm install` at repo root hoists into a single `node_modules`.
- [ ] AC #2 — `mockup/` contains a working Angular 20 application that serves on port 4201 via `ng serve` (run from `mockup/`).
- [ ] AC #3 — `DashboardHeaderComponent` + `SwimLaneLayoutComponent` + `WorkflowRowsLayoutComponent` + `topology-utils.ts` migrated to `frontend/matrix/src/lib/`; re-exported via `frontend/matrix/src/public-api.ts`.
- [ ] AC #4 — `frontend/dashboard/` rebuilds green after the migration (import paths updated; no behaviour change); Karma suite passes for migrated components.
- [ ] AC #5 — Mockup-app composes the migrated components against `FIXTURE_*` data; renders byte-identical chrome to the SPA when the SPA runs against the same fixtures.
- [ ] AC #6 — All 7 routes resolve: `/swim-lane` · `/workflow-rows` · `/invariants` · `/variants/{branching-dag, disconnected, env-tag-a, env-tag-b}`.
- [ ] AC #7 — `/invariants` page sources its content from `testing/mockup-visual/harness.config.json` (no duplication).
- [ ] AC #8 — CR-0015 + ADR-0011 land; SA reviews CR for architectural coherence.
- [ ] AC #9 — `local/framework.config.yaml` adds sibling `mockup-spa: mockup/` key (HTML `mockup:` key unchanged this cycle); `local/bindings.md` adds row for `mockup/` (owned by `frontend-engineer`; SA reviews).
- [ ] AC #10 — PR description includes manual screenshots per route (visual verification fallback — mockup-visual harness retargeting is deferred to the sibling retirement issue's cycle). Sibling tech-debt issue is filed and labelled `ginee:blocked`; on merge of this PR, label flips to `ginee:ready` (per OQ2 default — user-triggered flip, not auto).

## Out of scope

Explicit non-goals for this CR. Each is deferred to a downstream cycle with its own tracking.

| Item | Deferred to |
|---|---|
| Retirement of `docs/ui/mockups/deployment-dashboard.html` | Sibling tech-debt issue (filed alongside #79; `ginee:blocked` until #79 merges) |
| Retirement of `docs/ui/mockups/env-tag-column-alignment-variant-{a,b}.html` | Sibling tech-debt issue |
| Retargeting `testing/mockup-visual/` harness URL + Playwright `webServer:` block | Sibling tech-debt issue |
| Collapse of `mockup:` + `mockup-spa:` keys in `local/framework.config.yaml` | Sibling tech-debt issue |
| `docs/ui/*.md` cross-reference updates (option records currently cite `docs/ui/mockups/deployment-dashboard.html` line numbers) | Sibling tech-debt issue |
| `docs/architecture.md` §7 "Mockup ↔ Angular SPA bridge" citation update | Sibling tech-debt issue |
| The issue #54 layered-DAG fix itself | Re-picked up as `/variants/swim-lane-layered` PoC inside the new substrate (separate cycle after this CR merges) |
| Removing the layered-DAG path from `frontend/dashboard/` (currently absent on `main`; was on the abandoned `issue-54-swimlane-dag-layered-layout` branch) | The #54 re-pickup cycle |
| Storybook adoption | Not planned (variant-routes pattern covers the use case at lower cost) |
| Public deployment of `mockup/dist/` (GitHub Pages or similar) | Not planned for v1; deferrable to a future CR if visibility need emerges |
| Phase 2.0 Matrix layout reintroduction (TODO Phase 2.0 line 20) | The mockup-app's variant-routes capability enables a cheaper future path; out-of-scope here |
| Wiring `web-design-reviewer` skill into a mandatory gate | Ad-hoc optional invocation only (per § Tools available above) |
| CR-0003 § 5 amendment (Swim-lane single-row prescription) | Decoupled from this pivot; lands with the #54 follow-up cycle |
| `README.md` + `CONTRIBUTING.md` updates documenting the root-level `npm install` change | Post-Phase-8 doc-opt hook (`ai-engineer` shape pass) or sibling retirement issue, whichever lands first |

## Open issues — traced to Phase 4 work

| # | Subject | Status | Phase 4 owner |
|---|---|---|---|
| O-1 | CR-0015 authoring (this document) | Delivered Phase 4 step 4.1 | `team-lead` (delivered) |
| O-2 | ADR-0011 authoring | In-flight Phase 4 step 4.0 (parallel with O-1) | `solution-architect` |
| O-3 | Sibling tech-debt issue drafting + filing (`[Tech-debt] Retire HTML mockup + retarget mockup-visual harness to mockup-app`, labelled `ginee:blocked`) | Open — Phase 4 step 4.1.5 | `team-lead` |
| O-4 | Root `package.json` npm-workspaces declaration + `.github/workflows/frontend.yml` adjustment + convenience scripts (`start:mockup` / `build:mockup` / `test:mockup`) | Open — Phase 4 step 4.2 + step 4.4 | `devops-engineer` |
| O-5 | Layouts + header migration (sub-batch A) + mockup-app scaffold (sub-batch B) + variant routes (sub-batch C) + `/invariants` page (sub-batch D) | Open — Phase 4 step 4.3 | `frontend-engineer` |
| O-6 | `local/framework.config.yaml § mockup-spa` + `local/bindings.md` row addition + `CLAUDE.md` reference check | Open — Phase 4 step 4.5 | `team-lead` |
| O-7 | `local/index/*` reconciliation (mockup-app source; `frontend/matrix/` post-migration; CI topology refresh) | Open — Phase 4 step 4.6 | `ai-engineer` |
| O-8 | Variant fixture authoring — `FIXTURE_TOPOLOGY_BRANCHING` + `FIXTURE_TOPOLOGY_DISCONNECTED` (location: `frontend/shared/src/lib/fixtures.ts` or sibling `fixtures-variants.ts`) | Open — Phase 4 step 4.3 sub-batch C | `frontend-engineer` |
| O-9 | `topology-utils.ts` consumer audit — verify no other `frontend/dashboard/src/app/` files import the utility before migration | Open — Phase 4 step 4.3 sub-batch A (propose-phase check) | `frontend-engineer` |
| O-10 | CI workflow change-scope confirmation — `.github/workflows/frontend.yml` currently runs from `frontend/`; switching to root `npm install` changes the working-dir contract | Open — Phase 4 step 4.4 (propose-phase surface) | `devops-engineer` |
| O-11 | `frontend/package.json` `"private": true` verification + `"name"` field non-collision check pre-workspace install | Open — Phase 4 step 4.2 (pre-flight) | `devops-engineer` |
| O-12 | Sibling tech-debt issue label flip (`ginee:blocked` → `ginee:ready`) on this PR's merge | Post-Phase-8 G7 surface (user-triggered per OQ2 default) | `team-lead` / skill-runner |
| O-13 | `#54` branch (`issue-54-swimlane-dag-layered-layout`) cleanup — 6 abandoned iterations; safe to delete after #54 re-pickup as `/variants/swim-lane-layered` PoC succeeds | Out-of-scope this cycle; flag for #54 re-pickup cycle | (deferred) |

## References

- GitHub issue [#79](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/79) — the trigger.
- GitHub issue [#54](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/54) — paused; first PoC consumer of the new substrate post-pivot. Cited in § Motivation as evidence for the dual-implementation cost (6-iteration burn).
- [ADR-0011](./../adr/ADR-0011-mockup-app-architecture.md) — mockup-app architecture (location, workspace mechanism, fixture model, dashboard relationship). Authored by SA in parallel with this CR per the D25 governance-pair pattern.
- [CR-0007](./CR-0007-defer-matrix-layout-to-phase-2.md) — defer Matrix layout to Phase 2.0; analogous CR shape (defer + sibling-tracking pattern) for the retirement-as-follow-up structure used here.
- [CR-0014](./CR-0014-shared-bringup-logic-and-demo-credentials.md) — preceding CR; CR-0015's template + voice baseline.
- [CR-0003](./CR-0003-tree-topology-and-layout-axis.md) — introduces FR-13 layout axis (Swim-lane + Workflow-rows + Matrix); CR-0015 preserves CR-0003's contract by construction (same layout components, just rehosted).
- `docs/architecture.md` §7 "Layout axis (FR-13)" + §"Mockup ↔ Angular SPA bridge" — visual-contract sections that read through this CR + ADR-0011 once the sibling retirement issue updates the SAD citations.
- `frontend/matrix/src/lib/layout-leaf.component.ts` — the shared leaf component the mockup-app composes; already byte-identical-shaped per SAD §"Mockup ↔ Angular SPA bridge".
- `frontend/shared/src/lib/fixtures.ts` — canonical `FIXTURE_*` set; sibling `fixtures-variants.ts` may be authored for variant fixtures per O-8.
- `frontend/tsconfig.base.json` — existing TS path-alias pattern (`@dd/matrix` → `matrix/src/public-api.ts`); mirrored in `mockup/tsconfig.json` with `../` prefix.
- `testing/mockup-visual/harness.config.json` — source of `/invariants` route content; not modified this cycle (harness retargeting is sibling-issue scope).
- `local/framework.config.yaml` — `mockup-spa:` sibling key added; existing `mockup:` key unchanged this cycle.
- `local/bindings.md` — new row for `mockup/`; existing HTML mockup row unchanged this cycle.

<!-- D29 self-lint: pass -->
