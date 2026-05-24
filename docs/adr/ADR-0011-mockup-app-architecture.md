---
title: "ADR-0011: Mockup-App Architecture"
parent: ADRs
nav_order: 11
---

# ADR-0011 — Static Angular mockup application at `mockup/` replaces the HTML/Alpine mockup; component reuse via npm workspaces + TS path aliases

- **Status:** accepted (2026-05-25) — paired with GitHub issue [#79](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/79) — *"[Feature] Static Angular mockup app — replace HTML mockup at mockup/ (repo root)"*.

- **Context.**

  The visual source-of-truth is currently `docs/ui/mockups/deployment-dashboard.html` (~4400 LOC Alpine + Tailwind). The production SPA at `frontend/dashboard/` is a separate implementation of the same UI. Both render the same chrome (header, layout switcher, view switcher, theme switcher, swim-lane / workflow-rows layouts, stats bar, history drawer, attribute + topology pickers); both consume the same conceptual `FIXTURE_*` data set; both honour the same NFR-09 reflow invariant. They share intent, not code.

  The dual-implementation tax is concrete. Every visual change pays it twice — once in Alpine + inline JS against `<template x-if>` scopes, once in standalone Angular against typed components and the Signal Store. Surfaces diverge along axis lines:

  | Surface | Mockup (HTML/Alpine) | SPA (Angular) |
  |---|---|---|
  | Layout chrome | `<template x-if>` blocks + Alpine-scoped state | `<dd-layout-leaf>` component composed with row components |
  | Switchers | inline `x-data` | `<dd-view-switcher>` · `<dd-layout-switcher>` |
  | Theme | Alpine + `localStorage` | `ThemeService` + `<dd-theme-switcher>` |
  | Fixtures | embedded JS constants | `@dd/shared` exports (`FIXTURE_*`) |

  The PR #54 burn surfaced the cost in measurable form. Six iterations were spent integrating `dagre` into the mockup via `<foreignObject>` before the approach was abandoned because Alpine scope leaks broke deterministically inside SVG embeds. The equivalent SPA work (planned via `<ng-template #nodeTemplate>` projection) is mechanically clean inside Angular's component tree but was blocked behind a mockup-first sync. The cycle ended with both implementations partially broken and the SPA work deferred entirely.

  Constraints:

  - **Mockup remains the visual source-of-truth.** The tie-breaker in `local/bindings.md` § Tie-breakers (visual / interactive behaviour → mockup wins) survives; only the substrate changes (HTML → Angular).
  - **Per-tier dependency rules unchanged.** `frontend/matrix/` + `frontend/drawer/` may import only from `@dd/shared`; `frontend/shared/` imports nothing else in the workspace; each library exposes a single `public-api.ts`; no deep imports (`local/bindings.md § Per-tier dependency rules (frontend)`).
  - **SPA build stays green throughout.** Any prerequisite component migration touches import paths only; no behaviour change in `frontend/dashboard/`.
  - **Zero new runtime dependencies on the SPA.** The mockup-app consumes existing libraries (`@dd/matrix` · `@dd/shared` · `@dd/drawer`) by path-alias; SPA bundle is unaffected.
  - **Staged switch.** Retirement of `docs/ui/mockups/*.html` + retargeting of `testing/mockup-visual/` Playwright harness defer to a sibling tech-debt issue (separate PR). One cycle of co-existence preserves a comparison surface.

  Three workspace-integration options were considered. npm workspaces with TS path aliases (Option c) is the idiomatic in-tree mechanism for this pattern in the existing Angular toolchain.

- **Decision.**

  > **Replace the HTML/Alpine mockup with a standalone Angular 20 application at `mockup/` (repo root, sibling of `frontend/`, `backend/`, `gateway/`). Integrate via npm workspaces at the repo root + TypeScript path aliases targeting the existing `@dd/matrix` + `@dd/shared` + `@dd/drawer` libraries' public-api surfaces. Bootstrap a shared `DeploymentMatrixStore` from `FIXTURE_*` data synchronously on init (no SSE, no REST). The mockup-app is the visual source-of-truth, the PoC sandbox, and the blueprint for SPA visual changes.**

  Mechanics:

  1. **Location.** `mockup/` at repo root, sibling of `frontend/`, `backend/`, `gateway/`, `install/`, `dev_env/`, `testing/`, `docs/`. NOT under `frontend/` (would imply per-tier library status under the per-tier dependency rules; mockup is an *application* that composes libraries).
  2. **Workspace mechanism.** npm workspaces at repo root. New root `package.json`:
     ```json
     { "workspaces": ["frontend", "mockup"] }
     ```
     Single `npm install` at repo root hoists into a single `node_modules`; no duplicated dependency trees; lockfile is single-source-of-truth.
  3. **Library consumption.** TS path aliases in `mockup/tsconfig.json`:

     | Alias | Target |
     |---|---|
     | `@dd/matrix` | `../frontend/matrix/src/public-api.ts` |
     | `@dd/shared` | `../frontend/shared/src/public-api.ts` |
     | `@dd/drawer` | `../frontend/drawer/src/public-api.ts` |

     Aliases target only `public-api.ts`; the per-tier dependency rule against deep imports is preserved. Zero build step between source edit and mockup render — `ng serve` recompiles libraries through the alias.
  4. **Angular project shape.** Standalone Angular 20 application (no NgModules), same major as `frontend/`. Selector prefix `dd-mockup` (collision-free against `dd-*` SPA selectors when both apps are loaded in adjacent browser windows during cross-render comparison).
  5. **Dev server.** `ng serve` from `mockup/` on port **4201**. `frontend/dashboard/` keeps its default 4200; the two apps run concurrently during PoC work.
  6. **Component reuse via library migration prerequisite.** The dashboard shell currently holds three components + one utility that are shared-shaped but reside in `frontend/dashboard/src/app/`:

     | Component | Current path | Migration target |
     |---|---|---|
     | `DashboardHeaderComponent` | `frontend/dashboard/src/app/dashboard-header.component.ts` | `frontend/matrix/src/lib/` + re-export via `@dd/matrix` public-api |
     | `SwimLaneLayoutComponent` | `frontend/dashboard/src/app/` | `frontend/matrix/src/lib/` + re-export via `@dd/matrix` public-api |
     | `WorkflowRowsLayoutComponent` | `frontend/dashboard/src/app/` | `frontend/matrix/src/lib/` + re-export via `@dd/matrix` public-api |
     | `topology-utils.ts` | `frontend/dashboard/src/app/topology-utils.ts` | `frontend/matrix/src/lib/` (no public-api re-export needed if internal-only) |

     Migration touches import paths inside `frontend/dashboard/` only; dashboard behaviour + build stay green. Post-migration both `dashboard/` and `mockup/` consume the same `@dd/matrix` surface.
  7. **State.** Shared `DeploymentMatrixStore` from `@dd/shared` (same store the SPA uses). Mockup-app `app.component.ts` bootstrap calls these four setters synchronously on init:

     | Call | Source |
     |---|---|
     | `store.setEnvironments(FIXTURE_ENVIRONMENTS)` | `@dd/shared` fixtures |
     | `store.setServices(FIXTURE_SERVICES)` | `@dd/shared` fixtures |
     | `store.setMatrix(FIXTURE_MATRIX)` | `@dd/shared` fixtures |
     | `store.setTopology(FIXTURE_TOPOLOGY)` | `@dd/shared` fixtures |

     No SSE subscription, no REST fetch — fixtures are the universe.
  8. **Routes (v1).** Seven routes, two lazy bands:

     | Path | Purpose | Loading |
     |---|---|---|
     | `/` | redirect to `/swim-lane` | eager |
     | `/swim-lane` | canonical Swim-lane layout, canonical fixtures | eager |
     | `/workflow-rows` | canonical Workflow-rows layout, canonical fixtures | eager |
     | `/invariants` | NFR-09 + I0-I12 catalogue rendered from `testing/mockup-visual/harness.config.json` | eager |
     | `/variants/branching-dag` | PoC slot for issue #54 — Swim-lane + branching topology fixture | lazy |
     | `/variants/disconnected` | PoC slot — disconnected sub-components fixture | lazy |
     | `/variants/env-tag-a` | ported from `docs/ui/mockups/env-tag-column-alignment-variant-a.html` | lazy |
     | `/variants/env-tag-b` | ported from `docs/ui/mockups/env-tag-column-alignment-variant-b.html` | lazy |

     Canonical routes stay fast; variant bundles defer until visited.
  9. **Retirement deferred to follow-up PR.** A sibling tech-debt issue covers retirement of `docs/ui/mockups/*.html` + retargeting of the `testing/mockup-visual/` Playwright harness (Playwright `webServer:` block + URL switch + CI workflow review). The sibling is labelled `ginee:blocked` until this PR merges. Staged switch lets users compare HTML vs mockup-app for one cycle before commitment.

- **Consequences.**

  - **Positive.**
    - **Dual-implementation tax eliminated.** Visual changes touch the mockup-app *or* propagate through shared `@dd/matrix` / `@dd/shared` / `@dd/drawer` components — never duplicated against an Alpine surface.
    - **Byte-identical chrome by construction.** Both apps mount the same component tree against the same store; visual divergence is structurally impossible above the fixture-injection boundary.
    - **PoC sandbox.** Variant routes are first-class. Issue #54's layered-DAG PoC re-picks up as `/variants/swim-lane-layered` inside the new substrate without touching `frontend/dashboard/`.
    - **`@dd/matrix` becomes the true layout surface.** Header + layouts move out of the dashboard shell into the shared library where they always belonged; both consumers (mockup-app + SPA) import from the same public-api.
    - **Verification surface collapses.** "Does mockup render correctly" + "does SPA render correctly" become one question after harness retargeting; until then, manual screenshots per route serve as the visual-verification fallback.
  - **Negative.**
    - **npm workspaces is a new top-level mechanism.** Root `package.json` did not previously exist as a workspace declarer; contributors learn one new pattern (`npm install` at root, not per-app).
    - **Transitional dual source-of-truth.** `local/framework.config.yaml` carries both `mockup:` (HTML, retiring) and `mockup-spa:` (Angular, new) for one cycle. The tie-breaker rule in `local/bindings.md` § Tie-breakers (visual → mockup wins) applies to *whichever* mockup is the current visual SoT; team-lead's CR-0015 captures the SoT pivot precisely.
    - **New top-level directory.** `mockup/` raises the repo-root directory count (currently 7 directories + governance files); flagged in `local/project-profile.md § Staleness watchlist` ("new top-level directory not listed above").
    - **Library-migration prerequisite must land cleanly.** Three components + one utility moving out of `frontend/dashboard/` is a non-trivial structural change. If the migration regresses dashboard behaviour, the mockup-app substrate is blocked. Mitigation: migration is the *first* Phase-4 dispatch + `frontend/dashboard/` rebuild + existing dashboard tests gate the migration before any mockup-app code lands.
  - **Neutral.**
    - **No NFR amendment.** The decision records architectural substrate, not a user-facing system requirement. No FR / NFR / Constraint changes; ASR utility tree unaffected.
    - **`frontend/dashboard/` runtime unchanged.** Dashboard import paths shift to `@dd/matrix` for the migrated components; bundle composition + behaviour identical.
    - **SPA bundle size unaffected.** Mockup-app consumes libraries via path-alias for development; no new dependency lands in `frontend/package.json`.
    - **Public deployment of `mockup/dist/` out of scope.** Static bundle exists for local rendering; whether it ships to GitHub Pages or remains contributor-only is a future decision.

- **Alternatives considered.**

  | Option | Rejected because |
  |---|---|
  | (a) File-based npm packages (`file:../frontend/matrix`) | Requires per-tier `npm pack` + reinstall cycle on every edit; defeats the live-reload property; and bloats `node_modules` with duplicated copies. Path aliases provide the same import surface with zero rebuild lag. |
  | (b) TS path aliases only (no workspace) | Aliases work at compile time but don't resolve runtime peer dependencies (Angular core, RxJS, NgRx). Mockup-app would need its own `node_modules` with versions pinned manually against `frontend/`. Workspace hoist + lockfile-of-record is the standard solve. |
  | **(c) npm workspaces + TS path aliases — chosen** | Workspaces handle the dependency hoist (single `npm install`, single `node_modules`, single lockfile); aliases handle the dev-loop (no rebuild lag); together they are the idiomatic Angular-monorepo pattern. Both pieces are platform-native — no Nx, no Lerna, no Turborepo. |

- **Relationship to prior decisions.**

  - **[ADR-0001](./ADR-0001-topology-derivation-five-pass.md)** — read-side five-pass topology derivation. Unaffected. Mockup-app consumes pre-derived `FIXTURE_TOPOLOGY`; the five-pass algorithm runs only in the read API.
  - **[ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md)** — microservices architecture + container co-location. Unaffected. Mockup-app is a frontend-only addition; no backend container topology change.
  - **[ADR-0010](./ADR-0010-dev-env-compose-derives-from-release.md)** — dev_env compose derives from release. Unaffected. Mockup-app is a contributor-time tool (`ng serve` from `mockup/`); no compose file touches it; release-install stack inventory unchanged.
  - **`docs/architecture.md` §7** — layout axis (FR-13) chrome contract. The chrome contract is the architectural source-of-truth for what the mockup renders; this ADR records the *substrate* for mockup expression, not the contract itself. The chrome contract continues to live in `docs/architecture.md`; the mockup-app mirrors it through shared components.
  - **NFR-09** — reflow invariant. Honoured by reuse — the same `@dd/matrix` components implement the invariant for both consumers. The `/invariants` route renders the I0–I12 catalogue from `testing/mockup-visual/harness.config.json` (single source-of-truth).
  - **Supersedes:** none.

- **References.**

  - GitHub issue [#79](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/79) — the triggering requirement + full plan (acceptance criteria, out-of-scope list, sibling tech-debt issue model).
  - GitHub issue #54 (paused) — six-iteration `dagre` + `<foreignObject>` burn cited as the dual-implementation-cost evidence; first PoC consumer of the new substrate.
  - **CR-0015** (team-lead-authored, paired with this ADR) — source-of-truth pivot governance: `local/framework.config.yaml § mockup-spa` addition, `local/bindings.md § mockup/` row, retirement plan handoff to the sibling tech-debt issue.
  - [ADR-0010](./ADR-0010-dev-env-compose-derives-from-release.md) — most recent ADR; ADR-0011 is the next in sequence; same shape (Status / Context / Decision / Consequences / Alternatives / References).
  - `docs/architecture.md` §7 — Layout axis (FR-13) chrome contract; the architectural anchor the mockup-app expresses.
  - `frontend/matrix/src/lib/layout-leaf.component.ts` — shared leaf component (pre-existing; consumed unchanged).
  - `frontend/shared/src/lib/fixtures.ts` — canonical `FIXTURE_*` set the mockup-app boots from.
  - `testing/mockup-visual/harness.config.json` — source for the `/invariants` route content (no duplication).
  - `local/framework.config.yaml § mockup` — current pointer; carries both `mockup:` + `mockup-spa:` for one transitional cycle (CR-0015 captures the pivot).
  - `local/bindings.md` — Source-of-truth ownership table; `mockup/` row addition lands via CR-0015.

<!-- D29 self-lint: pass -->
