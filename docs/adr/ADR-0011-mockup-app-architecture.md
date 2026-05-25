---
title: "ADR-0011: Mockup-App Architecture"
parent: ADRs
nav_order: 11
---

# ADR-0011 — Static Angular mockup application at `mockup/` replaces the HTML/Alpine mockup; standalone install + hand-authored chrome mirroring SPA visual output

- **Status:** accepted (2026-05-25) — *Amended 2026-05-25 — standalone architecture per user constraint; supersedes npm-workspaces + shared-library-reuse mechanism. See Revision Log.* — paired with GitHub issue [#79](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/79) — *"[Feature] Static Angular mockup app — replace HTML mockup at mockup/ (repo root)"*.

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
  - **Per-tier dependency rules unchanged.** `frontend/matrix/` + `frontend/drawer/` may import only from `@dd/shared`; `frontend/shared/` imports nothing else in the workspace; each library exposes a single `public-api.ts`; no deep imports (`local/bindings.md § Per-tier dependency rules (frontend)`). These rules constrain the SPA's internal library graph; the mockup-app's standalone architecture sits outside this graph entirely.
  - **SPA build stays green throughout.** Any prerequisite component migration touches import paths only; no behaviour change in `frontend/dashboard/`.
  - **Zero new runtime dependencies on the SPA.** The mockup-app does not import any SPA library; under the standalone amendment (see § Decision item 2) it installs independently, so its dependency choices have zero impact on `frontend/package.json` or the SPA bundle.
  - **Mockup must be small + independent.** User constraint surfaced mid-Phase-4: the mockup must not pull the SPA's dependency graph into its resolution scope. This constraint is the proximate driver of the standalone amendment (see § Decision item 2 + § Alternatives Considered (c) + § Revision Log).
  - **Staged switch.** Retirement of `docs/ui/mockups/*.html` + retargeting of `testing/mockup-visual/` Playwright harness defer to sibling issue #80 (separate PR). One cycle of co-existence preserves a comparison surface.

  Four chrome-composition + integration mechanisms were evaluated (see § Alternatives Considered): file-based npm packages, TS path aliases only, npm workspaces + TS path aliases, and standalone-app + hand-authored chrome. The first three assume the mockup reuses the SPA's shared libraries; the fourth — chosen — drops the reuse assumption itself, accepting chrome-drift risk as the trade-off for mockup isolation.

- **Decision.**

  > **Replace the HTML/Alpine mockup with a standalone Angular 20 application at `mockup/` (repo root, sibling of `frontend/`, `backend/`, `gateway/`). The mockup-app is a truly independent Angular application: its own `package.json`, its own `node_modules`, its own `npm install`, NO workspace integration, NO shared-library consumption from `@dd/matrix` / `@dd/shared` / `@dd/drawer`. Chrome is hand-authored Angular templates + Tailwind classes mirroring the SPA's visual output. Fixtures are hardcoded TypeScript constants inline under `mockup/src/`, bound to components via `@Input()`. The mockup-app is the visual source-of-truth, the PoC sandbox, and the blueprint for SPA visual changes; chrome-drift between mockup + SPA is a manual maintenance discipline mitigated by the `testing/mockup-visual/` harness (issue #80) + manual visual review.**

  Mechanics:

  1. **Location.** `mockup/` at repo root, sibling of `frontend/`, `backend/`, `gateway/`, `install/`, `dev_env/`, `testing/`, `docs/`. NOT under `frontend/` (would imply per-tier library status under the per-tier dependency rules; mockup is an *application*, not a library; further, the standalone-architecture amendment makes the placement decisive — `mockup/` is its own install root, not a workspace member).
  2. **Install model — standalone (Amended 2026-05-25; supersedes npm-workspaces decision).** No root `package.json`; no npm workspaces; no hoisting. Two independent dependency trees by design:

     | Tree | Contents | Install command |
     |---|---|---|
     | `frontend/node_modules` | Full SPA dep graph (Angular CDK, NgRx Signal Store, RxJS, SSE wiring, test toolchain) — roughly 1+ GB | `cd frontend && npm install` |
     | `mockup/node_modules` | Minimal mockup deps — `@angular/{common,core,platform-browser,router}` + `tailwindcss` + dev toolchain — roughly 150–200 MB | `cd mockup && npm install` |

     The two installs are independent operations. Version drift between the two apps' shared peers (Angular major, Tailwind major) is possible by construction and acceptable — they are two independent apps with no shared runtime.

     The original commit (`2845e39` — root `package.json` + npm workspaces declaration) was reverted at `fe0d550` per user constraint surfaced mid-Phase-4: the mockup must be small + independent + must not pull the SPA's dep graph into its resolution scope ("the monster" per user vocabulary). § Alternatives Considered records the rejection rationale.
  3. **Chrome composition — hand-authored (Amended 2026-05-25; supersedes shared-library-reuse decision).** Mockup-app does NOT import `@dd/matrix` / `@dd/shared` / `@dd/drawer`. The mockup hand-authors its own Angular components for header, layout switcher, view switcher, theme switcher, swim-lane layout, workflow-rows layout, stats bar, history drawer, attribute + topology pickers. Chrome equivalence to the SPA is achieved by mirroring Tailwind class composition + template structure — a visual discipline rather than a structural guarantee. Chrome-drift risk is real and mitigated by two complementary surfaces: the `testing/mockup-visual/` Playwright harness retargeting (sibling issue #80) catches geometric drift via the I0–I12 invariant catalogue; manual visual review catches subjective drift; the mockup surface is small enough that both gates are cheap.
  4. **State bootstrap — hardcoded fixtures inline (Amended 2026-05-25; supersedes `DeploymentMatrixStore` reuse decision).** Mockup-app does NOT use the SPA's `DeploymentMatrixStore`, does NOT subscribe to SSE, does NOT call any API client. Fixtures live as TypeScript constants under `mockup/src/app/fixtures/` (e.g. `MOCKUP_ENVIRONMENTS`, `MOCKUP_SERVICES`, `MOCKUP_MATRIX`, `MOCKUP_TOPOLOGY`, `MOCKUP_TOPOLOGY_CONFIG`) and are bound directly to component inputs via Angular `@Input()` (or via route resolvers for variant routes). No store machinery, no SSE service, no API client. Shape conformance to the SPA's wire models (`@dd/shared/lib/models.ts`) is a manual discipline — TypeScript does not enforce it across the boundary.
  5. **Angular project shape.** Standalone Angular 20 application (no NgModules), same major as `frontend/` (drift acceptable per item 2). Selector prefix `dd-mockup` (collision-free against `dd-*` SPA selectors when both apps are loaded in adjacent browser windows during cross-render comparison).
  6. **Dev server.** `ng serve` from `mockup/` on port **4201**. `frontend/dashboard/` keeps its default 4200; the two apps run concurrently during PoC work.
  7. **Frontend library cleanup migration (independent of mockup; landed at commit `57714f5`).** Originally framed as a structural prerequisite for mockup chrome sharing; under the standalone-mockup amendment, the mockup does NOT consume `@dd/matrix`, so the mockup-sharing rationale is moot. The migration is **retained on independent grounds** as a frontend library organisational cleanup: the three components + one utility were always shared-shaped within frontend (the dashboard-shell vs matrix-library boundary was semantically misplaced); the migration formalises a cleaner library boundary that benefits the SPA alone.

     | Component | Current path | Migration target |
     |---|---|---|
     | `DashboardHeaderComponent` | `frontend/dashboard/src/app/dashboard-header.component.ts` | `frontend/matrix/src/lib/` + re-export via `@dd/matrix` public-api |
     | `SwimLaneLayoutComponent` | `frontend/dashboard/src/app/` | `frontend/matrix/src/lib/` + re-export via `@dd/matrix` public-api |
     | `WorkflowRowsLayoutComponent` | `frontend/dashboard/src/app/` | `frontend/matrix/src/lib/` + re-export via `@dd/matrix` public-api |
     | `topology-utils.ts` | `frontend/dashboard/src/app/topology-utils.ts` | `frontend/matrix/src/lib/` (no public-api re-export needed if internal-only) |

     Migration touches import paths inside `frontend/dashboard/` only; dashboard behaviour + build stay green. Mockup-app neither consumes nor depends on `@dd/matrix` after this migration.
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
  9. **Retirement deferred to follow-up PR.** Sibling tech-debt issue [#80](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/80) covers retirement of `docs/ui/mockups/*.html` + retargeting of the `testing/mockup-visual/` Playwright harness (Playwright `webServer:` block + URL switch + CI workflow review) at the new `mockup/` (`ng serve` on port 4201). The sibling is labelled `ginee:blocked` until this PR merges. Staged switch lets users compare HTML vs mockup-app for one cycle before commitment. Under the standalone-mockup amendment, the retargeted harness *is* the geometric oracle that catches chrome drift between mockup-app + SPA (see § Consequences — Negative).

- **Consequences.**

  - **Positive.**
    - **Dual-implementation tax replaced with a smaller, isolated one.** The Alpine + inline-JS surface goes away; in its place is a small standalone Angular app whose chrome is hand-authored Tailwind templates mirroring the SPA. The PR #54 burn pattern (six-iteration Alpine-scope debugging inside `<foreignObject>`) does not recur — the mockup substrate is now typed Angular components.
    - **Visually-equivalent chrome via hand-authoring + harness gate.** Mockup chrome is structurally independent of the SPA's component tree; visual equivalence is achieved by mirroring Tailwind class composition and verified by the retargeted `testing/mockup-visual/` harness (issue #80) + manual review. The fidelity is *visual*, not byte-identical-by-construction.
    - **Mockup stays small + independent.** `mockup/node_modules` carries only Angular core + Tailwind + minimal dev tooling — roughly 150–200 MB versus `frontend/node_modules`'s 1+ GB. The mockup is cheap to install, fast to build, fast to onboard, and does not pull the SPA's dependency graph into its resolution scope.
    - **PoC sandbox.** Variant routes are first-class. Issue #54's layered-DAG PoC re-picks up as `/variants/branching-dag` inside the new substrate without touching `frontend/dashboard/` and without dragging in the SPA's runtime.
    - **Verification gate via retargeted harness.** Once issue #80 lands, `testing/mockup-visual/` runs against the mockup-app — the same I0–I12 catalogue exercise that ran against the HTML mockup. The harness is the geometric oracle on chrome drift.
  - **Negative.**
    - **Chrome drift risk between mockup + SPA.** Visual fidelity is a manual maintenance discipline, not a byte-identical-by-construction guarantee. Two divergence modes: (a) geometric drift (spacing, sizing, alignment) — caught by the issue #80 mockup-visual harness retargeting; (b) subjective drift (typography, micro-interaction polish) — caught by manual visual review. Mitigation rationale: the mockup chrome surface is small enough that both gates are cheap; the harness catches the structural cases; manual review covers the rest.
    - **Wire-model shape conformance is unenforced.** Mockup fixtures are hardcoded TypeScript constants, not instances of `@dd/shared` model types — so the TypeScript compiler does not flag if `MOCKUP_MATRIX` drifts from `Matrix`'s real shape. Mitigation: small fixture surface + visual review catches gross mismatches; the wire models are slow-moving by design.
    - **Transitional dual source-of-truth.** `local/framework.config.yaml` carries both `mockup:` (HTML, retiring) and `mockup-spa:` (Angular, new) for one cycle. The tie-breaker rule in `local/bindings.md` § Tie-breakers (visual → mockup wins) applies to *whichever* mockup is the current visual SoT; the SoT pivot itself is captured in GitHub issue #79.
    - **New top-level directory.** `mockup/` raises the repo-root directory count; flagged in `local/project-profile.md § Staleness watchlist` ("new top-level directory not listed above").
    - **Two `node_modules` trees to manage.** Contributors now run `npm install` in two locations (`frontend/` and `mockup/`); CI workflows install both. The friction is small (the `frontend/` install was already mandatory; the `mockup/` install is a one-line addition) and bounded by design — exactly two roots, never three.
  - **Neutral.**
    - **No NFR amendment.** The decision records architectural substrate, not a user-facing system requirement. No FR / NFR / Constraint changes; ASR utility tree unaffected.
    - **`frontend/dashboard/` runtime unchanged.** The frontend library cleanup migration (item 7) shifts dashboard import paths to `@dd/matrix` for three components + one utility; bundle composition + behaviour identical. Mockup does not enter the dashboard's dep graph.
    - **SPA bundle size unaffected.** Mockup-app installs independently; no new dependency lands in `frontend/package.json`.
    - **Public deployment of `mockup/dist/` out of scope.** Static bundle exists for local rendering; whether it ships to GitHub Pages or remains contributor-only is a future decision.

- **Alternatives considered.**

  Four chrome-composition + integration mechanisms were evaluated. Options (a), (b), (c) assume the mockup-app reuses the SPA's shared libraries (`@dd/matrix` / `@dd/shared` / `@dd/drawer`) and differ on the integration mechanism. Option (d) — chosen — drops the reuse assumption itself in favour of hand-authored chrome.

  | Option | Verdict | Rationale |
  |---|---|---|
  | (a) File-based npm packages (`file:../frontend/matrix`) | rejected | Requires per-tier `npm pack` + reinstall cycle on every edit; defeats the live-reload property; bloats `node_modules` with duplicated copies; adds build-step friction + `dist/` sync overhead. |
  | (b) TS path aliases only (no workspace) | rejected | Aliases work at compile time but don't resolve runtime peer dependencies (Angular core, RxJS, NgRx). Mockup-app would need its own `node_modules` with versions pinned manually against `frontend/`, then keep them aligned by hand — two `node_modules` trees with version-drift exposure across shared peers. |
  | (c) npm workspaces at repo root + TS path aliases | **rejected post-user-feedback (Amended 2026-05-25)** | Initially chosen + landed as commit `2845e39` (root `package.json` + `"workspaces": ["frontend", "mockup"]`). Reverted at commit `fe0d550` per user constraint surfaced mid-Phase-4: workspace hoisting bundles the SPA's full dependency graph (Angular CDK, NgRx Signal Store, RxJS, SSE wiring, full test toolchain — "the monster" per user vocabulary) into the mockup's resolution scope. The mockup ceases to be a *small + independent* artefact and becomes a workspace member subject to SPA dep-graph evolution. Idiomatic for Angular monorepos but wrong for *this* project's mockup-isolation goal. |
  | **(d) Standalone install + hand-authored chrome — chosen** | accepted | Mockup-app installs independently (`cd mockup && npm install`); has its own minimal `node_modules` (~150–200 MB vs the SPA's 1+ GB); imports no SPA libraries; hand-authors chrome via Angular templates + Tailwind classes mirroring the SPA's visual output. Matches the user constraint ("small + independent"). Accepts chrome-drift risk as the trade-off; mitigates via the sibling issue #80 mockup-visual harness (geometric oracle) + manual visual review (subjective drift). The mockup surface is small enough that both gates are cheap. |

- **Relationship to prior decisions.**

  - **[ADR-0001](./ADR-0001-topology-derivation-five-pass.md)** — read-side five-pass topology derivation. Unaffected. Mockup-app consumes pre-derived `MOCKUP_TOPOLOGY` constants; the five-pass algorithm runs only in the read API.
  - **[ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md)** — microservices architecture + container co-location. Unaffected. Mockup-app is a frontend-only addition; no backend container topology change.
  - **[ADR-0010](./ADR-0010-dev-env-compose-derives-from-release.md)** — dev_env compose derives from release. Unaffected. Mockup-app is a contributor-time tool (`ng serve` from `mockup/`); no compose file touches it; release-install stack inventory unchanged.
  - **`docs/architecture.md` §7** — layout axis (FR-13) chrome contract. The chrome contract is the architectural source-of-truth for what the mockup renders; this ADR records the *substrate* for mockup expression, not the contract itself. Under the standalone amendment, the mockup mirrors the chrome contract through **hand-authored** Angular templates + Tailwind classes — not shared components — so contract conformance is a visual + harness discipline rather than a structural guarantee.
  - **NFR-09** — reflow invariant. Honoured *visually*: the mockup hand-authors components that obey the invariant; the `/invariants` route renders the I0–I12 catalogue from `testing/mockup-visual/harness.config.json` (single source-of-truth) so the invariant catalogue itself stays unduplicated. Harness retargeting via sibling issue #80 is the geometric gate.
  - **Supersedes:** none.

- **References.**

  - GitHub issue [#79](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/79) — the triggering requirement + full plan (acceptance criteria, out-of-scope list, sibling tech-debt issue model).
  - GitHub issue [#80](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/80) — sibling tech-debt issue: HTML mockup retirement + `testing/mockup-visual/` Playwright harness retargeting to `mockup/`. The geometric oracle for chrome drift under the standalone amendment.
  - GitHub issue #54 (paused) — six-iteration `dagre` + `<foreignObject>` burn cited as the dual-implementation-cost evidence; first PoC consumer of the new substrate.
  - [ADR-0010](./ADR-0010-dev-env-compose-derives-from-release.md) — most recent ADR; ADR-0011 is the next in sequence; same shape (Status / Context / Decision / Consequences / Alternatives / References / Revision Log).
  - `docs/architecture.md` §7 — Layout axis (FR-13) chrome contract; the architectural anchor the mockup-app expresses by hand-authoring.
  - `testing/mockup-visual/harness.config.json` — source for the `/invariants` route content (no duplication); the harness's I0–I12 catalogue is the geometric oracle once issue #80 retargets the harness at `mockup/`.
  - `local/framework.config.yaml § mockup` — current pointer; carries both `mockup:` + `mockup-spa:` for one transitional cycle (pivot tracked in GitHub issue #79).
  - `local/bindings.md` — Source-of-truth ownership table; `mockup/` row added by team-lead at Phase 4.5 (commit `953eb2f`).

- **Revision Log.**

  - **2026-05-25 (Amendment).** Standalone mockup architecture replaces npm-workspaces + shared-library reuse mechanism. Trigger: user constraint surfaced mid-Phase-4 G5 — mockup must be small + independent + must not pull the SPA's dep graph ("the monster"). Changes: Decision banner reworked; § Decision items 2 (workspace mechanism → standalone install), 3 (library consumption → hand-authored chrome), 4 (state bootstrap → hardcoded inline fixtures) rewritten; § Decision items 5/6 (project shape + dev server) carried forward; § Decision item 7 (frontend library cleanup migration) reframed as independent-grounds cleanup; § Decision items 8/9 (routes + retirement) carried forward with #80 reference clarified; § Alternatives Considered restructured from 3 to 4 options with (c) reframed as rejected-post-user-feedback and (d) standalone-with-hand-authored-chrome as chosen; § Consequences (Positive / Negative / Neutral) reworked — dropped "byte-identical chrome by construction" + "`@dd/matrix` becomes true layout surface", added chrome-drift risk + wire-model-conformance trade-offs + two-`node_modules` operational note; § Cross-refs updated to reflect hand-authored mirroring rather than reuse; § References add issue #80 context; references to `frontend/matrix/src/lib/layout-leaf.component.ts` + `frontend/shared/src/lib/fixtures.ts` removed (no longer consumed by mockup). Trigger commits: `2845e39` (original workspaces commit) reverted at `fe0d550`.
  - **2026-05-25 (Original).** Initial accepted version — Static Angular mockup-app at `mockup/` via npm workspaces + TS path aliases targeting `@dd/matrix` / `@dd/shared` / `@dd/drawer`; shared `DeploymentMatrixStore` bootstrap from `FIXTURE_*`.

<!-- D29 self-lint: pass -->
