# Deployment Dashboard — Project Instructions

## Source of truth (read before any work)

Authoritative files (**read** by every agent):

1. `docs/deployment-dashboard-architecture.md` (SAD) — requirements, constraints, components, data model, API contract, decisions, WBS. **Edited by `solution-architect` only.**
2. `docs/deployment-dashboard.html` (mockup) — visual + behavioural contract for the SPA. **Edited by `frontend-engineer`; reviewed by `solution-architect` for SAD coherence + invariant compliance.**

Rules:
- Read the relevant section of both before designing or implementing anything.
- Never invent behaviour, fields, or constraints absent from these docs.
- Conflict between request / instinct / existing code and the docs → **stop, flag for the owning agent**. Doc update lands first, code follows.
- Conflict between the two docs:
  - Visual / interactive behaviour → **mockup wins**; flag the SAD for update.
  - API / data / stack / infrastructure → **SAD wins**; flag the mockup for update.
- SAD / `CLAUDE.md` / `docs/ci-cd-integration.md` / ADRs → only `solution-architect` writes the edit. Other agents propose in their final reports.
- Mockup → only `frontend-engineer` writes the edit. SAD-level changes (new view, new attribute, new invariant) require `solution-architect` to land the SAD update first, then `frontend-engineer` mirrors the change into the mockup.

## Repository structure

Top-level directories — keep work in the directory that matches the concern. No files outside these directories without a doc update.

**Component-per-subdirectory rule:**
- Every deployable or independently-versioned component → its own subdirectory under `backend/` or `frontend/`.
- Shared code between components in the same tier → `shared/` subdirectory.
- No flat single-project layout under `backend/` or `frontend/`.

```
deployment-dashboard/
├── backend/                  # .NET 10 source root — modular monolith host (SAD §7 "Backend module architecture", §10 Decision 11)
│   ├── api/                  # Host project (ASP.NET Core executable) — Program.cs, single Dockerfile,
│   │                         # composition root. Wires Write + Read surface libraries into one host.
│   ├── write-api/            # LIBRARY project — Write surface endpoint group (POST /api/deployments,
│   │                         # PATCH /api/config/topology); NOTIFY dispatch. API-key middleware
│   │                         # is applied here only — Read group is unauthenticated.
│   ├── read-api/             # LIBRARY project — Read surface endpoint groups (matrix / history /
│   │                         # discovery / SSE / health / GET topology config). JSON only — no SPA.
│   ├── shared/               # Class library — EF Core DbContext, entities, migrations, DTOs,
│   │                         # NOTIFY/LISTEN abstractions, ApiKeyMiddleware implementation.
│   ├── Dashboard.sln         # Solution referencing all backend projects
│   └── (per-project unit tests live alongside their source project)
│   # Owned by: backend-engineer
│
├── frontend/                 # Angular 20 workspace root (modular monolith — SAD §7)
│   ├── dashboard/            # Application project — shell, routes, SSE bootstrap, Tailwind entry.
│   │                         # Also holds the deployable container artefacts (Dockerfile + nginx.conf).
│   ├── matrix/               # Feature library — pipeline matrix, 6 box states, hover highlight, filters
│   ├── drawer/               # Feature library — history drawer, lazy history fetch
│   ├── shared/               # Shared library — Signal Store, API client, SSE service, models, tokens
│   ├── angular.json          # Single workspace; one ng build produces one SPA bundle
│   └── tailwind.config.js    # Single Tailwind config for the whole workspace
│   # Angular source: frontend-engineer. Dockerfile + nginx.conf: devops-engineer.
│
├── gateway/                  # App Gateway — single public-facing nginx reverse proxy
│   ├── Dockerfile            # nginx:alpine base
│   └── nginx.conf            # Routing matrix (path + method) + SSE pass-through tuning
│   # Owned by: devops-engineer
│
├── infrastructure/           # Terraform modules and per-environment workspaces (dev/, prod/)
│   # Owned by: devops-engineer
│
├── dev_env/                  # Local development environment — docker-compose.local.yml,
│                             # docker-compose.scaled.yml, start.ps1, stop.ps1
│   # Owned by: devops-engineer
│
├── testing/                  # All test code outside per-project unit tests
│   # Owned by: qa-engineer
│
├── docs/                     # Authoritative specs — do not duplicate; cite sections instead
│   # Owned by: solution-architect, EXCEPT:
│   #   - docs/deployment-dashboard.html (mockup) — authored by frontend-engineer;
│   #     governance review by solution-architect (no edits).
│
├── .github/                  # GitHub Actions workflows + composite actions
│   # Owned by: devops-engineer
│
├── .claude/                  # Agent definitions (agents/*.md) and Claude Code settings
│
└── CLAUDE.md                 # This file
```

### `backend/`
- Modular monolith host (SAD §7 "Backend module architecture", §10 Decision 11). One deployable container; two logical API surfaces; libraries kept separate so a future re-split is host-project + gateway-config only.
- Every backend project is its own .NET project.
- `api/` is the **only** ASP.NET Core executable — it has the only backend `Dockerfile`. `write-api/` and `read-api/` are **library projects** (`Microsoft.NET.Sdk` with `OutputType` library) — they expose endpoint-group extension methods (e.g. `MapWriteEndpoints`, `MapReadEndpoints`) and DO NOT have `Program.cs` or a Dockerfile.
- Dependency rules (mirror the frontend modular-monolith pattern):
  - `api/` → references `write-api/`, `read-api/`, `shared/`. Only `api/` references the two surface libraries.
  - `write-api/` and `read-api/` → reference only `shared/`. Never each other; never `api/`.
  - `shared/` → references neither surface library nor `api/`.
- `shared/` holds: EF Core `DbContext`, entities, migrations, NOTIFY/LISTEN abstractions, `ApiKeyMiddleware`. One migration set serves both surfaces.
- API-key middleware is applied **only** to the Write endpoint group at composition time in `api/Program.cs` — `MapGroup("/api").RequireApiKey()` on the write group. No global `UseMiddleware<ApiKeyMiddleware>()`. The Read group is unauthenticated (SAD §8).
- SQLite-in-memory unit tests live alongside their source project.
- The API container serves **JSON only** — no `wwwroot`, no static-file middleware. SPA hosting lives in `frontend/dashboard/`.
- No third API surface in the matrix tier — new responsibility → doc update first.
- Re-splitting the host into two container apps is a documented future option (SAD §7 "Future split — trigger conditions"). Backend engineers DO NOT pre-split; the trigger conditions in the SAD govern.

### `frontend/`
- Modular monolith Angular workspace (SAD §7 "Module architecture").
- Dependency rules:
  - Feature libraries (`matrix/`, `drawer/`) → depend only on `shared/`. Never on each other or on `dashboard/`.
  - `shared/` → depends on no feature library.
  - Only `dashboard/` imports from feature libraries.
- New feature area → new library under `frontend/`, never a folder inside `dashboard/`.
- Cross-cutting concerns → `shared/`.
- Enforcement: `@angular-eslint/no-restricted-imports` + workspace `tsconfig.base.json` path mappings.
- Build: `ng build dashboard` → one SPA bundle → copied into `frontend/dashboard/Dockerfile`'s nginx image.
- `frontend/dashboard/` container serves static assets + SPA history fallback only — **no upstream proxying** (the App Gateway does that).

### `gateway/`
- Single public-facing nginx reverse proxy.
- Only container with public ingress (host port `8080` locally; ACA public ingress in Azure).
- Routing (path + method-based; per SAD §7). Both API surfaces resolve to a single `api` upstream today; the path+method matrix is preserved so a future re-split is a config-only change (SAD §7 "Future split").
  | Method + Path | Upstream | Surface |
  |---|---|---|
  | `POST /api/deployments` | `api:8080` | Write |
  | `PATCH /api/config/topology` | `api:8080` | Write (admin) |
  | `GET /api/*`, `GET /api/stream`, `GET /health` | `api:8080` | Read |
  | Everything else | `dashboard:80` | n/a |
- SSE pass-through requirements:
  - `proxy_buffering off`
  - `proxy_cache off`
  - `proxy_read_timeout 1h`
  - forward `Last-Event-ID` and `X-Accel-Buffering: no`
- Zero per-request state — adding routes requires no backend or frontend changes.

### `infrastructure/`
- `infrastructure/terraform/modules/` → reusable modules.
- `infrastructure/terraform/envs/{dev,prod}/` → per-environment roots.
- Terraform state lives in Azure Storage — **never** in the repo.

### `dev_env/`
- Anything a developer runs to bring up a local stack.
- Compose files reference images built from `backend/api/` (single backend image hosting both Write and Read surfaces), `frontend/dashboard/`, and `gateway/`.

### `testing/`
- Layered organisation:
  | Subdirectory | Contents |
  |---|---|
  | `testing/functional/` | API/integration tests |
  | `testing/e2e/` | Playwright specs + Gherkin scenarios |
  | `testing/scripts/` | PowerShell seed/cleanup/notify/init |
  | `testing/pester/` | Pester suites for non-trivial PowerShell |
  | `testing/fixtures/` | Canonical 6-state fixtures |

## Agents — deterministic routing

Five subagents in `.claude/agents/`. Route work per the table — do not do agent-owned work yourself in the main thread.

| Concern | Agent |
|---|---|
| `docs/deployment-dashboard-architecture.md` (SAD) edits | `solution-architect` |
| `docs/deployment-dashboard.html` (mockup) — HTML/CSS/JS/Alpine.js/SVG/embedded fixture edits | `frontend-engineer` |
| `docs/deployment-dashboard.html` (mockup) — review for SAD coherence + invariant compliance (governance only, no edits) | `solution-architect` |
| `docs/ci-cd-integration.md` edits | `solution-architect` |
| `CLAUDE.md` rules / routing / repo-structure edits | `solution-architect` |
| ADRs and other architectural artefacts under `docs/` | `solution-architect` |
| Coherence audits between the SAD and the mockup; resolving the tie-breaker | `solution-architect` |
| ASP.NET Core Minimal APIs — Write surface, Read surface, and the `api/` host that composes them | `backend-engineer` |
| EF Core 10 entities, `DbContext`, migrations | `backend-engineer` |
| PostgreSQL schema, indexes, matrix/history SQL, `LISTEN/NOTIFY`, pruning job | `backend-engineer` |
| API-key middleware, SSE endpoint, `Last-Event-ID` reconnect | `backend-engineer` |
| Matrix derivation (`lastSuccessful`, `previousFailed`), wire-format JSON contract | `backend-engineer` |
| Angular 20 standalone components, zoneless change detection | `frontend-engineer` |
| NgRx Signal Store, derived signals, slot-update dispatch | `frontend-engineer` |
| Tailwind layout, 6 box states, hover highlight, history drawer, filters, stats bar | `frontend-engineer` |
| Browser-native `EventSource` client and reconnect logic | `frontend-engineer` |
| Functional / API tests against running stack | `qa-engineer` |
| Playwright end-to-end tests + scenario specs | `qa-engineer` |
| `seed.ps1`, `cleanup.ps1`, `test-notify.ps1`, `init-data.ps1` | `qa-engineer` |
| Smoke suite (post-deploy validation) | `qa-engineer` |
| Pester tests for any non-trivial PowerShell or composite-action logic | `qa-engineer` |
| Dockerfile, `docker-compose.*.yml`, scaled compose | `devops-engineer` |
| Terraform (ACR, ACA, Postgres Flexible B1ms, Key Vault, networking) | `devops-engineer` |
| GitHub Actions CI and release workflows, ACA revision updates | `devops-engineer` |
| GitHub Actions composite `notify` action under `.github/actions/notify/` | `devops-engineer` |
| Secret provisioning, cost tracking against the ≤ $30/month cap | `devops-engineer` |

Task spans two agents (e.g. wire contract touches backend + frontend) → dispatch to both, in the order below.

## Parallelization rules

- **Independent work** (no shared contract change) → dispatch agents in parallel in a single message.
- **Parallel-by-default for cross-domain cycles.** The **default** for Phase 2 of a cross-domain cycle (see "Cross-domain bugs — integration + compliance cycle" below) is parallel dispatch. The orchestrator must justify any sequential Phase 2 dispatch in the dispatch prompt itself (one sentence — e.g., "frontend needs qa's generated mock types as input"). Habitual serialization is the failure mode to avoid.
- **Contract changes** (JSON shape, SSE wire payload, DB schema, env vars, secrets) map onto the four-phase model:
  | Phase | Dispatch | Agents |
  |---|---|---|
  | 1 — contract | sequential | `solution-architect` lands the SAD update (and mockup if SAD-level invariant) |
  | 2 — domain implementations | **parallel by default** | `backend-engineer`, `frontend-engineer`, `qa-engineer`, `devops-engineer` — each implements their own part against the now-fixed contract; serialize only when one domain's output is a literal input to the next (e.g., a generated type) |
  | 3 — integration verification | sequential | the agent closest to the user-facing surface runs the shared oracle end-to-end |
  | 4 — compliance review | sequential | `solution-architect` signs off against SAD invariants and mockup contract |
- **Doc-only changes** (rename, clarification, ADR) → `solution-architect` only (SAD-family) or `frontend-engineer` only (mockup-only HTML/CSS/JS tweak with no SAD implication).
- **Infrastructure changes affecting application config** (new env var, new secret, new endpoint URL) → coordinate `devops-engineer` and `backend-engineer`; backend first to confirm the app reads the new value, devops second.

## Task lifecycle — phased pipeline with maximum parallelism

**Guidance — binding, not flavour.** Operate the lifecycle as a real software-engineering team operates: apply established best practices (separation of concerns, contract-driven parallelism, testing as a first-class deliverable, fail-fast on contract drift, no idle agents). Phases are named and ordered; agents within a phase run in parallel; phases overlap wherever a contract surface decouples them.

### Phases

| # | Phase | Produced by | Contract surface that gates the next phase |
|---|---|---|---|
| 1 | Analysis | discovering agent (often `solution-architect`) | problem statement + scope boundary |
| 2 | Design & architecture — system design, API design, visual design, high-level implementation plan | `solution-architect` (system + SAD ratification), `backend-engineer` (HTTP/JSON API contract), `frontend-engineer` (visual via mockup + SPA-visible API surface), all engineers (impl plan) | fixed wire shape + fixed mockup behaviour + fixed WBS |
| 3 | Design review — user review of the proposed solution | user (reviews phase-2 artefacts: SAD edits, mockup, API contract, impl plan) | explicit user approval (or remarks routed back to phase 2) |
| 4 | Implementation | `backend-engineer`, `frontend-engineer`, `devops-engineer` | working code against the approved contracts |
| 5 | Testing | `qa-engineer` | test plan + executable suite against the same approved contracts |
| 6 | Bug fixing (iterative until clean) | engineer that owns the failing surface | green oracle |
| 7 | SA review — requirements + architecture compliance | `solution-architect` | sign-off note in PR / final report |
| 8 | User approval | user | `☒` on the TODO line |

Notes on phase 2:

- **API design ownership.** The engineer who owns the surface authors the contract (`backend-engineer` for HTTP/JSON, `frontend-engineer` for the SPA-visible side); `solution-architect` ratifies the contract into the SAD before phase 3 opens.
- **Contract-surface column unchanged.** "Fixed wire shape" already covers the API contract; growing the column would duplicate, not clarify.

Notes on phase 3 (design-review gate):

- **Synchronous gate.** Implementation does NOT start until the user signs off OR explicitly delegates the call.
- **Loop on remarks.** Remarks (not approval) route back to phase 2 with the remarks as fresh input; the phase 2 ↔ phase 3 loop iterates until approval or until the user redirects.
- **Explicit prompt.** The orchestrator MUST ask via `AskUserQuestion` (or equivalent), presenting the phase-2 artefacts (SAD diff, mockup link, API contract, WBS) for review.
- **Distinct from phase 8.** Phase 8 closes the TODO line after delivery; this earlier gate approves the design before any engineering effort is spent.
- **Distinct from the TODO-workflow checkpoint.** That checkpoint ("Elaborate / Start implementing / Something else") sits *before* phase 1 starts; the design-review gate sits at the design ↔ implementation boundary.

### Parallelism rules

- **Within a phase — every independent agent dispatched in ONE message.** Independent = no source-tree input/output dependency. Habitual serialization is the failure mode.
- **Across phases — overlap on contract, not on code.** The next phase starts the moment its contract surface is fixed, not when the prior phase's code lands.
- **Implementation gated on design review.** Implementation (phase 4) starts when the phase-2 contract surface is fixed AND the phase-3 design-review gate has passed. No engineer codes against an unapproved design.

Three concrete overlap patterns:

- **Test authoring overlaps implementation.** Once the wire shape / mockup behaviour is fixed (phase 2 output), `qa-engineer` authors specs and fixtures **in parallel with** `backend-engineer` / `frontend-engineer` coding. Both reference the contract, not each other's source. Decoupling surface: the fixed contract from phase 2.
- **Bug fix overlaps continued testing.** When QA reports a defect, the owning engineer fixes immediately while QA continues exercising **other** scenarios. The fix loop does not freeze the test run. Decoupling surface: the test plan partitions scenarios; one failing scenario blocks only itself.
- **Doc update overlaps implementation.** `solution-architect` hands engineers the necessary context (decision wording, FR/NFR delta, wire-shape change) and engineers proceed; SA updates SAD / `CLAUDE.md` / `ci-cd-integration.md` / ADRs in parallel. Engineers do NOT wait for the doc commit. Decoupling surface: the verbal/written contract context delivered upfront; the doc commit is a paper trail, not a gate.

### Dispatch pattern — orchestrator rules

- **N independent agents in one phase → ONE message with N `Agent` tool calls.** Never serialize independent dispatches across multiple messages.
- **Cross-phase overlap (e.g. qa authoring tests while frontend implements) → ONE message with all overlapping agents.** Each dispatch prompt names the shared contract surface they reference (SAD §X, mockup behaviour Y, wire shape Z) so neither agent waits on the other's code.

### Relation to the cross-domain-bugs cycle

The four-phase model in "Cross-domain bugs — integration + compliance cycle" below is the specific instantiation of this lifecycle for bugs that cut across two or more domains. Its Phases 1–4 map onto lifecycle phases 2 (contract change), 4 (domain implementations), 5–6 (integration + bug fixing), and 7 (compliance review) — the design-review gate (lifecycle phase 3) still applies when the bug requires user-visible behaviour change. The general lifecycle here is the frame; the four-phase cycle is the worked pattern. Both apply — this section governs the overall flow; the cycle governs cross-domain bug coordination.

## Engineering principles — apply across all agents

### Configuration vs. data — declarative over imperative

Binds every agent. "Hard to change without editing imperative code" = signal it belongs in a declarative file.

**Configuration** (URLs, ports, env vars, feature flags, retention windows, defaults) → declarative files per tier:

| Tier | File |
|---|---|
| .NET | `appsettings.json` / env vars |
| Angular | `environment.ts`, `proxy.conf.json` |
| Compose | `docker-compose.*.yml` |
| Terraform | `*.tfvars` |
| PowerShell tooling | `*.json` config files |

Never as literals inside controllers, components, PowerShell scripts, or test specs.

**Data** (fixtures, seed sets, snapshot baselines, expected JSON, scenarios) → dedicated declarative files:
- `testing/fixtures/*.json`
- `testing/e2e/scenarios/*.md`
- etc.

Never as inline literals inside test code.

**Imperative code stays thin** — scripts, runners, entry-point wrappers read from declarative files and call the underlying tool. A 200-line wrapper baking in URLs, tokens, and fixture payloads is a refactor target.

Exceptions require a doc update before they land.

### Test oracles can be wrong

A test that passes against broken software is a defect in the oracle, not a green light. When test results contradict observed behaviour, trust the observed behaviour and route to the test owner to tighten the assertion. Examples:

- A geometric harness that anchors against the wrapper instead of the inner element will pass on connectors that visibly don't touch.
- A test that POSTs and asserts 201 without asserting the response body shape will pass even if the API returns garbage.
- A test that opens a UI element without exercising its action will pass on a broken action.

The oracle is part of the contract. Tightening it is `qa-engineer`'s job; respecting that signal is everyone's.

## Documentation style — structure over prose

Applies to **all** written artefacts: `CLAUDE.md`, agent definitions (`.claude/agents/`), future skills, the SAD, the mockup, ADRs, per-component READMEs.

- **Default to structure.** Bullets, numbered lists, tables, headings — not prose paragraphs.
- **Steps / actions / instructions → bullet list.** Never a multi-sentence paragraph.
- **Pairs, mappings, choices → table.** "Before / after", "old / new", "concern → owner", "endpoint → status code" all read as tables.
- **One idea per bullet.** Short, declarative, parseable. A bullet wanting three sentences → promote to sub-list or table.
- **Headings carry weight.** `##` / `###` to chunk; don't bury rules inside walls of prose.
- **Code shapes go in fenced code blocks.** Wire formats, env vars, file paths, commands.
- **Cross-reference, don't duplicate.** Cite the section ("per SAD §7"); don't restate.
- **Drop filler.** No "It is important to note that…", "Please ensure…", "In general…". Lead with the verb or the noun.
- **Prose is for narrative exposition only** — explaining *why* something is the way it is. Keep tight.

When editing a doc, watch for prose paragraphs that should be a list, table, or table-of-rules — convert them.

## TODO-driven workflow

`TODO` at the repo root tracks the user's intended next steps. User-curated — never auto-generated, never auto-extended. Glyphs: `☐` = open, `☒` = completed.

**After every completed user request** (work delivered or question answered), in this order:

1. **Read `TODO`** at the repo root.
2. **Find the first `☐` item** (top-down). If none, say so and stop — never invent an item.
3. **Ask the user via `AskUserQuestion`** — three fixed options, include the verbatim TODO line in the prompt:
   | Option | Effect |
   |---|---|
   | **Elaborate** | User explains the item before any work begins. Wait for their explanation, then proceed. |
   | **Start implementing** | Proceed immediately using the routing rules above. |
   | **Something else** | Wait for the user's next message; handle as a new request. |
4. **When the chosen item is implemented**, ask via `AskUserQuestion`:
   | Option | Effect |
   |---|---|
   | **Yes — mark complete** | Edit `TODO` to change that line's `☐` → `☒`. No reorder, no delete, no commit unless asked. |
   | **No — needs more work** | Keep as `☐`; ask what's missing; iterate. |

Rules:
- TODO check happens **between** user requests — not in the middle of one.
- TODO items are user-grained, larger than in-conversation tasks (`TaskCreate` / `TaskUpdate`). Mark both when same work completes.
- Never auto-add to TODO. Mention follow-up work → *offer* to add it; do not act unilaterally.
- User says "skip TODO" for this turn → honour it; resume next turn.

## Coordination protocol

- Every PR description cites the FR/NFR/section of the SAD — or the mockup section — implemented or validated.
- Wire-contract breaking changes (API shape, SSE event format, env var names) → flag in the PR title; backend, frontend, and devops all confirm before merge.
- Cost-relevant changes (new resource, larger SKU) → fresh estimate vs. the $30/month cap in the PR description; `devops-engineer` owns this.

### Strict-domain rule — no agent works outside its domain

Clear boundaries between agents are non-negotiable. A bug in domain X is fixed by the engineer who owns X — never by an adjacent agent "while they're in the area". Cross-domain bugs require collaboration, not single-agent heroics.

**Forbidden role-crossings** (each is a hard stop — propose a hand-off in the final report instead):

- Solution-architect editing mockup HTML/CSS/JS/Alpine.js/SVG. Mockup authoring is `frontend-engineer`. Solution-architect reviews for SAD coherence + invariant compliance only.
- Solution-architect editing backend C# code (controllers, EF entities, migrations, middleware).
- Solution-architect editing Angular code (components, services, store, templates).
- Solution-architect editing Terraform, Dockerfiles, `docker-compose.*.yml`, or `.github/` CI workflows.
- Frontend-engineer editing backend C# code (including SQL queries inside Read API endpoints).
- Frontend-engineer editing Terraform, Dockerfiles, or `.github/` CI workflows.
- Backend-engineer editing Angular code, Tailwind, or `docs/deployment-dashboard.html` (mockup).
- Backend-engineer editing Terraform, Dockerfiles, or `.github/` CI workflows.
- Devops-engineer editing `.csproj`, NuGet config, or any C# source to dodge a build issue.
- Devops-engineer editing Angular code or Tailwind config.
- QA-engineer editing mockup HTML, backend production C#, or frontend production TypeScript. QA owns test code, fixtures, scenarios, runner scripts — never production surfaces.

**Cross-reference:** NFR-09 (UX-RESPONSIVENESS) is the canonical example of the collaboration pattern this rule enforces — an invariant defined by `solution-architect` in the SAD, encoded as a harness assertion by `qa-engineer`, and satisfied by `frontend-engineer` in mockup CSS/JS. Each domain stays in its lane; the result is end-to-end correctness through composition, not through any one agent crossing boundaries.

### Cross-domain bugs — integration + compliance cycle

When a bug spans two or more domains, the work follows a four-phase model. The orchestrator dispatches each phase deliberately — parallel where the work is independent, sequential only where a real dependency exists.

**Phase 1 — contract change (sequential).** If the bug requires a contract change (SAD invariant, FR/NFR addition, wire shape, env var), `solution-architect` lands the doc change first. Engineers cannot start their parts until the contract wording exists.

**Phase 2 — domain implementations (parallel by default).** Each engineering domain implements its own part independently. The orchestrator MUST dispatch all independent domain parts in a single message (parallel agents), not sequentially. Domain parts are independent when:
  - Domain A's deliverable is not required to compile, run, or pass tests in domain B's source tree.
  - Both domains can reference the Phase 1 contract wording without needing each other's code.
Sequential is only correct when one domain's output is a literal input to the next (e.g., a generated TypeScript type the next agent imports).

**Phase 3 — integration verification (sequential, at the join point).** The agent closest to the user-facing surface (`frontend-engineer` for UI bugs, `backend-engineer` for API bugs, `devops-engineer` for deploy bugs) runs the shared oracle (harness, integration test, e2e) end-to-end and confirms all Phase 2 deliverables compose correctly.

**Automated tests are necessary but not sufficient.** For any change that adds or modifies user-facing behaviour, Phase 3 also requires a **manual browser smoke** by the integrator:

1. Wipe and re-seed the local stack to a clean state before opening the browser.
2. Exercise every NEW user-facing flow in a real browser — clicks, dropdowns, toggles, switchers, picker UIs. Not "the page renders"; "the feature does the thing".
3. Compare against the mockup or the SAD's described behaviour. If a feature looks wrong but tests say "PASS", that's a sign the test oracle is broken (route to `qa-engineer` to tighten assertions) — NOT a sign to call it green.
4. Record the manual smoke results in the Phase 3 report (one line per new feature: e.g., "PATCH picker works; correlation attribute round-trips").

If the integrator cannot run a browser (e.g. headless environment), state so explicitly. Do not claim manual smoke as PASS without doing it.

If integration fails (automated OR manual), return to the specific Phase 2 domain that broke — not a full rerun.

**Phase 4 — compliance review (sequential, final).** `solution-architect` reviews the result against SAD invariants and the mockup contract. Sign-off, no edits. If invariants are violated, returns to Phase 2.

- SA's compliance review must verify the integrator's manual-smoke report was actually written (not omitted). Empty manual-smoke section in a Phase 3 report = REJECT, return to Phase 3.

**Sign-off in PR description.** Each domain notes which part it owned; the integrator notes the verification command/output; `solution-architect` notes which FR/NFR/§ the result satisfies.

**Canonical worked example — Glance env-tag-inside-pill cycle (NFR-09 exception).** A view-specific exception to the NFR-09 invariant: in the Glance view, the env tag renders inside the pill rather than as a separate label.

| Phase | Dispatch | Agent(s) | Work |
|---|---|---|---|
| 1 | sequential | `solution-architect` | Amend SAD NFR-09 with the Glance exception sentence. |
| 2 | **parallel — one message** | `qa-engineer` **and** `frontend-engineer` | qa: add `viewExceptions.glance` flag to `testing/mockup-visual/harness.config.json` + branch the spec. frontend: implement inside-pill render in the Glance template + mirror NFR-09 into the mockup head comment in `docs/deployment-dashboard.html`. |
| 3 | sequential | `frontend-engineer` | Run the harness; expect 12/12. |
| 4 | sequential | `solution-architect` | Compliance review against amended NFR-09; sign-off without edits. |

**Anti-pattern:** dispatching `qa-engineer` and `frontend-engineer` serially in Phase 2 of this cycle. Their deliverables touch different source trees (`testing/mockup-visual/` vs `docs/deployment-dashboard.html`) and both reference only the Phase 1 SAD wording — there is no input/output dependency between them. Serializing them doubles the wall-clock time for no coordination benefit.

**Prior worked example — QAHOTFIX-overlap (UX-RESPONSIVENESS / NFR-09):** the bug was CSS comment-nesting + grid template + Alpine.js wiring — a frontend bug. Phase mapping:

| Phase | Agent | Work |
|---|---|---|
| 1 | `solution-architect` | Write NFR-09 invariant in SAD. |
| 2 | `qa-engineer` **and** `frontend-engineer` (parallel) | qa: encode invariant as harness assertion. frontend: fix CSS / Alpine / SVG in the mockup. |
| 3 | `frontend-engineer` | Run `testing/mockup-visual/run-tests.ps1`; all-green is the definition of done. |
| 4 | `solution-architect` | Review for SAD coherence and invariant compliance; sign off without editing mockup code. |

The anti-pattern this replaces: `solution-architect` editing mockup HTML/CSS/JS directly across three failed rounds. That was a strict-domain violation regardless of intent — mockup edits are frontend craft.

### Cross-agent handoff — diagnose ≠ fix

When an agent discovers a root cause **outside** their domain while working on their own task:

1. **Diagnose fully; do NOT fix.** Cross-domain patches cause silent contract drift. Write up:
   - failing command
   - verbatim error
   - file + line
   - chain of reasoning
2. **Hand off** to the owning agent (routing table above). Hand-off package includes:
   - symptom
   - verified root cause with evidence
   - what the discovering agent tried and ruled out
   - any local workaround in place + whether to remove it once the proper fix lands
3. **Both agents stay engaged.** Owner fixes; discoverer reviews and removes any workaround. Not throw-over-the-wall.
4. **Workarounds are temporary, labelled as such.** Example: devops adds a defensive `.dockerignore` to mask a host-side leak. Stays only until the owning agent lands the proper fix; both agents acknowledge in reports.
5. **Out-of-competence fixes are disallowed** — see the Strict-domain rule above for the complete forbidden list. Examples:
   - Frontend "just tweaks" SQL in a Read API endpoint → no.
   - Devops "just edits" a `.csproj` to dodge a NuGet issue → no.
   - Backend "just rewrites" a Playwright spec → no.
   - Solution-architect "just patches" mockup CSS to satisfy an invariant → no; hand off to `frontend-engineer`.

Main thread orchestrates the hand-off — when an agent flags a root cause outside their domain in their final report, dispatch the owning agent next with the prior diagnosis verbatim.

**Doc updates always route through the doc's owner.**
- SAD / `CLAUDE.md` / `docs/ci-cd-integration.md` / ADRs → `solution-architect`.
- Mockup (`docs/deployment-dashboard.html`) → `frontend-engineer` for HTML/CSS/JS/SVG edits; `solution-architect` for governance review only.

When any engineer flags a needed change, the next dispatch is the owning agent with the flagged change. Engineers outside the owning domain never edit these files directly.

## Stack — non-negotiable (per SAD §6, §7)

| Layer | Choice |
|---|---|
| Backend | C# / .NET 10, ASP.NET Core Minimal API, EF Core 10 + Npgsql |
| Storage | PostgreSQL 16 (prod + dev); SQLite in-memory (unit tests only) |
| Real-time | PostgreSQL `LISTEN/NOTIFY` + SSE (`text/event-stream`) |
| Frontend | Angular 20 (standalone, zoneless), NgRx Signal Store, Tailwind CSS |
| Edge | nginx (`gateway/`) — single public ingress, no CORS, SSE-tuned |
| Container runtime | OCI-compliant, port 8080 (no Azure Functions / proprietary bindings) |
| Hosting | Azure Container Apps + Azure Container Registry + Azure Database for PostgreSQL Flexible Server (B1ms) + Azure Key Vault |
| IaC | Terraform (`azurerm` ≥ 4.x), state in Azure Storage |
| CI/CD | GitHub Actions |

**Do not introduce:**
- SignalR
- Redis
- In-memory event buses
- MediatR
- AutoMapper
- FluentValidation
- Material / PrimeNG / Bootstrap
- Sass / Less
- Azure Functions
- Sticky sessions
- In-process SSE fan-out across instances
- Any cloud-proprietary compute model

## Hard constraints (from NFRs and §6)

- **NFR-01 / §6** — Azure-only hosting.
- **NFR-02 / §6** — ≤ $30/month total infrastructure cost.
- **NFR-03** — Live updates within 5 s of a successful ingest.
- **NFR-04 / §6** — Internal-only; no public internet exposure.
- **NFR-05** — Stateless backend; no sticky sessions.
- **NFR-06** — All infrastructure defined in Terraform.
- **NFR-07** — ≥ 90 days of deployment history retained (default 365).
- **NFR-08** — Dashboard loads in a browser with no build step (SPA pre-built into the image).
- **§6 platform agnosticism** — Backend deployable as a standard container on any OCI-compliant host.

Task that would violate any → stop, propose a doc update first.

## Out of scope (do not implement)

- Triggering or managing deployments — the system is read-only / notification-only.
- Querying any CI/CD tool — push-based only.
- Multi-organisation or multi-repo aggregation.
- Role-based access control on read endpoints (delegated to a sidecar per §8).
- The v2.0 desktop Notification Client is planned but not part of MVP. Do not implement unless explicitly requested.
</content>
</invoke>