# CLAUDE-pointer

Append this block to the project's `CLAUDE.md` (or paste at the top if no existing file).

---

## Engineering team framework

### HARD CONSTRAINTS (always)

1. **Self-lint marker** — every cardinal return ends with `<!-- self-lint: pass -->`. No exceptions.
2. **SA never edits** — `solution-architect` returns APPROVE / REJECT / REQUEST-CHANGES only; never `Edit` / `Write` (subagent `tools:` whitelist enforces).
3. **Context-economy trailer** — any commit > ~50 net-added lines on `core/` · `adapters/` · `extras/` carries `Optimized-By: ai-engineer`.
4. **Runtime stays D-free** — `core/**` · `adapters/**` · `extras/**` · migration filenames carry no `D<N>` tokens. `PLAN.md` is the sole D-log.
5. **`local/**` only via discovery** — never edit from main thread; route to the discovery skill.

Project uses the [`ginee`](.agents/ginee/) framework. **Read before any work:**

- `.agents/ginee/core/process.md` — vendor-neutral process spec (lifecycle, dispatch, iteration protocol, doc co-ownership, task model).
- `.agents/ginee/local/bindings.md` — project routing, role boundaries, source-of-truth, stack.
- `.agents/ginee/local/project-profile.md` — discovered project context (filled by `team-lead` on first run).

**Dispatch.** Via cardinal roles in `.claude/agents/` (installed from `.agents/ginee/adapters/_shared/agents/` per `.agents/ginee/adapters/claude/install.md`). Claude Code routes via subagent description match — natural language, no `@` literal.

**Orchestrator.** `team-lead`.

**Workflows.** AgentSkills at `.claude/skills/ginee-*/` (discovery / rediscover / file-bug / file-feature / pick-up / triage / promote-discussion / reindex / update). Type the workflow in natural language — Claude auto-activates the matching skill. See `.agents/ginee/adapters/claude/install.md § How to invoke` for the phrasing cheat sheet.

**Custom roles + cardinal extensions.** `.agents/ginee/local/roles/`. Two uses:

- **Custom new roles** — author a role definition; register under `team-lead` per discovery flow.
- **Cardinal extensions** — author `.agents/ginee/local/roles/<cardinal>.md` (matching name of a cardinal: `team-lead` · `solution-architect` · `backend-engineer` · `frontend-engineer` · `devops-engineer` · `qa-engineer` · `ai-engineer`). The shared pointer auto-loads it as the final read in the cardinal's read chain — augments the charter with project-specific craft notes; never replaces. Absence is a no-op.

**First install.** Type `Run initial discovery` — activates the `ginee-discovery` skill.

### HARD CONSTRAINTS — RECAP

1. **Self-lint marker** — every cardinal return ends with `<!-- self-lint: pass -->`. No exceptions.
2. **SA never edits** — `solution-architect` returns APPROVE / REJECT / REQUEST-CHANGES only; never `Edit` / `Write` (subagent `tools:` whitelist enforces).
3. **Context-economy trailer** — any commit > ~50 net-added lines on `core/` · `adapters/` · `extras/` carries `Optimized-By: ai-engineer`.
4. **Runtime stays D-free** — `core/**` · `adapters/**` · `extras/**` · migration filenames carry no `D<N>` tokens. `PLAN.md` is the sole D-log.
5. **`local/**` only via discovery** — never edit from main thread; route to the discovery skill.

---

## CR convention (local)

GitHub issues are the canonical design-of-record for any work picked up via `/ginee-pick-up #<N>` — the issue body + comment thread + linked PR description carry scope, motivation, decisions, and acceptance criteria. A separate CR markdown file is **redundant** for issue-sourced work and is no longer authored for this project.

**Authoring rule.** A new Change Request (`docs/cr/CR-<N>-*.md`) is authored **only** when the task source is:

- A **free-form** instruction without a GitHub issue (e.g., `pick up "refactor the X service"`), **OR**
- A **TODO line** (e.g., `pick up TODO:42`).

When a free-form task escalates and gains a GitHub issue mid-flight, the in-flight CR is closed in place and the issue body takes over as design-of-record.

**Historical CRs.** `CR-0001..CR-0015` were retired in the branch that introduced this rule. Their substantive decisions live on in: `docs/architecture.md` (FRs / NFRs / invariants), `docs/adr/` (architectural decisions), and the corresponding GitHub issues where back-mappable. See git history for the original CR text.

**Issue registry.** Open + recently-closed issues are summarized in `.agents/ginee/local/index/github-issues-index.idx` (refreshed by `ginee-reindex` and post-acceptance). Consume this index in place of `docs/cr/` lookups.

---

## UI change convention (local)

Every UI change — visual layout, chrome, interactive controls, theme, fixtures shape, view variants — **must be proven in the mockup-app at `mockup/` first**, presented to the user for approval, and only applied to `frontend/` (the SPA) after explicit approval.

**Why.** The mockup-app is the visual source-of-truth + PoC sandbox per [`ADR-0011`](docs/adr/ADR-0011-mockup-app-architecture.md). Skipping the mockup-first step means designing in the SPA where every change pays the full Angular + NgRx + SSE coupling cost; the mockup is the cheap iteration surface.

**Flow.**

1. **PoC in `mockup/`.** Frontend implements the change inside the mockup-app (standalone Angular 20, hand-authored chrome, hardcoded fixtures, port 4201). New variant routes under `mockup/src/app/variants/` are appropriate for per-option exploration.
2. **Capture + present.** Skill-runner captures the relevant view × layout combinations at 1440 × 900 via Playwright (`testing/mockup-visual/capture-*.mjs`), Reads the PNGs side-by-side against the running SPA at `:8080` per [[blueprint-baseline-is-running-spa]], and surfaces the proposed diff to the user.
3. **User approval gate.** No SPA implementation begins until the user explicitly approves the mockup PoC. Forced-interactive — auto mode does not auto-approve.
4. **Apply to `frontend/`.** After approval, frontend ports the chrome / layout / behaviour to the SPA (`frontend/dashboard/`, `frontend/matrix/`, `frontend/drawer/`, `frontend/shared/`). The SPA inherits the visual contract from the approved mockup state.
5. **Retro-sync** (optional). If the SPA implementation surfaces a constraint that requires a mockup adjustment, loop back to step 1 — keep mockup and SPA visually aligned.

**Scope.** Applies to any change in `frontend/` that affects rendered UI. Pure refactors, dep bumps, or build-system changes without visible delta are exempt. When unsure, mockup-first.

**Out-of-scope (do NOT touch in the mockup-first PoC):**

- Real SSE / API / NgRx wiring — mockup stays standalone per ADR-0011.
- Backend wire-contract shape — that's SAD-owned; mockup mirrors the data shape as hardcoded TS constants, doesn't define it.

---

## Separation of concerns (local)

Domain logic must be kept separate from presentation across **backend**, **frontend**, and **devops** artefacts. Mixing them inside a single module is the single biggest cause of "tests pass but the thing doesn't work" cycles in this project — verified by issue #83 where a graph-construction algorithm was authored inline inside an Angular template + ngx-graph custom node template, making it impossible to verify the data layer independently of the rendering layer.

**Rule.** Every change introduces or preserves the boundary between:

- **Domain layer** — pure data, types, transformations, derivation algorithms. No DOM, no Angular template syntax, no SVG, no CSS, no library-specific rendering hooks. Testable in isolation under Karma / dotnet test / pytest without a browser.
- **Presentation layer** — templates, components, styles, layout-engine wiring, theme tokens. Consumes the domain layer's output via a typed interface; never re-derives domain logic inline.

**Per-tier application.**

| Tier | Domain | Presentation |
|---|---|---|
| backend | record types · validators · projection algorithms · five-pass topology derivation per ADR-0001 | Minimal API endpoint handlers · response serialization · SSE emitters |
| frontend | NgRx selectors · DAG builder (`mockup/src/app/fixtures/dag-builder.ts`) · path enumeration · view-mode resolvers | Components · ngx-graph wiring · custom templates · Tailwind classes · `::ng-deep` overrides |
| devops | Compose file authorship · IaC modules · health-probe scripts | Dashboards · Grafana panels · alert templates · GitHub workflow YAML |

**Why this matters here.** Issue #83 cycles 1+2 had the DAG construction algorithm split between `dag-builder.ts` (correctly isolated) and inline component logic that re-mapped + applied rank attributes inside `swim-lane-layout.component.ts`. Karma tests passed against `dag-builder.ts` outputs while the component-level rank logic was silently ignored by dagre. A clean domain-vs-presentation boundary would have caught it: domain produces `{nodes, edges}`, presentation consumes them as-is, no inline re-mapping. The variant route `mockup/src/app/variants/dag-all.route.ts` demonstrates the boundary — same `buildDag()` output, default ngx-graph rendering, zero domain logic in the template.

**Authoring checklist.**

- [ ] Domain functions live in dedicated `.ts` / `.cs` / `.py` files outside component / handler files.
- [ ] Presentation components import domain functions; never re-implement transformations inline.
- [ ] Tests target domain in isolation (no DOM); presentation tests target rendering behaviour against pre-computed domain fixtures.
- [ ] When a domain change needs presentation update, both ship in the same commit but in **different files**; no single file mixes them.

**Out of scope** — adapter shims (`mockup/src/app/fixtures/*.ts` mirroring backend wire shape) and thin orchestration layers (the route component that wires domain → presentation) are acceptable thin glue; they must not contain transformation logic of their own.

---

## Mockup-app authoring convention (local)

**Load-bearing rule — overrules role recommendations including SA.** The mockup-app at `mockup/` is **fully isolated, maximally static, with minimum logic application**. It is kept isolated **deliberately** so it can serve as (a) the visual blueprint for the SPA and (b) a cheap PoC surface for proposed changes. **It does NOT follow and SHOULD NOT follow any existing engineering or software principles** — not SOLID, not DRY, not maximum reuse, not decomposition, not YAGNI, not "single source of truth," not "extract a helper." Duplication between mockup and SPA is **intentional and load-bearing**; reject any cross-tier extraction or "promotion" recommendation, no matter how senior the recommender or how clean the architectural justification.

The mockup-app at `mockup/` is a **mockup**, not a production application. Authoring it like a production app — with reusable components, shared helpers, conditional logic, and abstraction layers — actively harms its purpose (cheap iteration, side-by-side visual variants, decoupled per-view experimentation). Verified by issue #83 where shared `viewMode === '...' ? a : b` conditionals and a shared `serviceGraphFor` cache caused changes intended for one view to silently break another, wasting hours of iteration.

**Rules — enforced in `mockup/` only (not `frontend/`).**

1. **No logic except visual behavior.** Components do not derive, compute, transform, or branch on business rules. The only allowed "logic" is what's needed for visual interactivity (e.g., toggle expand/collapse, set hover state). Domain data lives in fixtures / `dag-builder.ts`; components consume it as-is.
2. **No reuse / no shared state across view-mode × layout-mode combinations.** Each (view × mode) combination — e.g., swim-lane × glance, swim-lane × compact, workflow-rows × detailed — gets its **own component file** with its own template, its own ngx-graph config, its own layoutSettings, its own view-size calc. **Dumb copy-paste between them is preferred over extracting a shared helper.** When the same value (`nodeWidth: 180`) appears in 8 files, that's correct.
3. **No conditional logic over view-mode or layout-mode anywhere.** No `viewMode === 'compact' ? 80 : 150` ternaries. No `@switch (viewMode)` in template-shared blocks. The dispatch happens at the top of the layout component (`@if (viewMode === 'compact') { <dd-mockup-swim-lane-compact />`) and that's it — the dispatched component knows exactly which view × mode it is and hardcodes accordingly.
4. **Shared state only where unavoidable.** The narrow exception: pure-data layers that are by definition the same across all views — fixtures (`mockup/src/app/fixtures/*.ts`), the DAG builder (`dag-builder.ts`), wire-shape type mirrors. These are domain, not presentation. They stay shared. Everything that touches rendering — dimensions, layout settings, node templates, view-size calculations, edge styles — is **per-combination, copy-pasted**.

**Why these rules look wrong but are right.**

- Yes, you'll have 8+ component files (one per view × mode combination) that look 80% similar. That's the point — when you iterate on one, you only edit one file and you cannot accidentally break another.
- Yes, you'll see `nodeWidth: 180` hardcoded in many places. That's the point — when "Compact should have 200-wide nodes", you grep-and-replace per file, deliberately, never via a shared constant.
- Yes, this is the opposite of how you'd build the production app. The production app is in `frontend/`. The mockup is in `mockup/`. They have opposite optimization functions.

**Authoring checklist.**

- [ ] About to extract a shared helper, base class, or utility used by multiple view × mode combinations? **Don't.** Copy-paste instead.
- [ ] About to add `viewMode === '...'` conditional inside a per-view component? **Don't.** Either the component is the wrong scope, or it should be split further.
- [ ] About to derive / compute / transform data inside a template? **Don't.** Fixture-side or builder-side.
- [ ] Caching across hot-reloads? **Don't.** Stale cache hides config changes during iteration.

**What stays shared (unavoidably) — within `mockup/` only.**

- `mockup/src/app/fixtures/index.ts` — data
- `mockup/src/app/fixtures/dag-builder.ts` — domain transformation
- `mockup/src/app/fixtures/variants/*.ts` — variant data
- Deployment-node leaf components (`deployment-detailed.component.ts`, `deployment-compact.component.ts`, `deployment-glance.component.ts`, etc.) — each is itself a per-view artefact, but shared *across modes* (swim-lane × compact and workflow-rows × compact both use `deployment-compact.component.ts`)

Everything else: copy-paste.

**Cross-tier sharing (mockup ↔ frontend) is FORBIDDEN.** The "shared within mockup" list above lives entirely inside `mockup/`. It does **not** extend to imports from `@dd/shared` / `@dd/matrix` / `@dd/drawer` or any other SPA workspace. When the SPA needs an algorithm the mockup already implements (e.g., `dag-builder.ts`), the SPA gets its **own copy** under `frontend/`. The two copies are independent artefacts allowed — expected — to diverge. Do NOT add CI `diff` gates between the copies. Do NOT propose `git mv` from `mockup/` to `frontend/`. Do NOT amend ADR-0011 to relax the standalone constraint for cross-tier sharing. The ADR-0011 standalone scope covers **all** mockup code, not just runtime-stateful modules.

---

## Issue / bug / sub-issue authoring convention (local)

Every GitHub issue, bug report, feature request, and sub-issue dispatch authored by the framework (skill-runner via `ginee-file-*` / `ginee-promote-discussion`; team-lead via sub-issue dispatch contracts; any cardinal authoring a follow-up) is written **for a human reader who is picking it up cold**, not for the AI agent that drafted it. Every artefact MUST be standalone-pickup-able: a contractor / future maintainer / new team member can read the title + first paragraph and understand the *problem or request itself*, not the framework jargon around it.

**Why.** Framework-authored artefacts that read like internal dispatch contracts (`[6:frontend-engineer] Stage 1 forensic — confirm Bug C/D root cause on demo-gha data (#92 iteration 1)`) are unintelligible to anyone outside the current session. Verified during issue #83 iteration 1: every sub-issue (#92–#96) was titled with internal phase tags, role prefixes, internal bug-letter identifiers, and forensic-investigation framing — none describe the actual problem a human picking it up would face. GitHub issues are also a public artefact (per repo visibility); the title + body land in search indexes, notification feeds, and project boards. They must read as bug reports + feature requests, not dispatch notes.

**Rules.**

1. **Title describes the problem or request itself, in user-facing language.**
   - For bugs: name the *symptom the user sees* — what's wrong, where it shows.
   - For features / improvements: name the *capability the user wants* — what should the system do.
   - For sub-issue dispatches: name the *work to do* in terms of the outcome, not the internal investigation framing. The `[<phase>:<cardinal>]` prefix per `core/templates/sub-issue-dispatch.md` stays (framework convention), but the substantive part of the title is human-readable.
   - **Forbidden in title:** internal bug identifiers (`Bug C`, `OV1`, `Stage 1 forensic`, `Bug C/D root cause`), framework-internal phase tags beyond the standard prefix (`(#92 iteration 1)`, `Phase B`, `cycle 2-ter`), file paths or module names (`dag-builder.ts`, `swim-lane-detailed.component.ts`), code-level technical terms (`structured oracles`, `regression class`, `field-location`), references to root causes or fix mechanisms.

2. **First paragraph of body restates the title's problem / request for a human.**
   - 2–4 sentences. What's happening (bug) or what's wanted (feature). No jargon. No assumptions about what the reader has seen.

3. **Bug reports MUST include steps to reproduce** as a numbered list. Each step is a concrete action a human can take (open `:4200`, click X, observe Y). The `Expected behavior` and `Actual behavior` sections name what the user sees, not what the code does.

4. **Body MAY include — clearly labelled as separate sections:**
   - **Technical context / root cause hypothesis** (if known)
   - **Investigation notes** (link to forensic comments on parent issues)
   - **Possible fix directions** (mechanism candidates; ADR amendment scope)
   - **Spec / contract links** (ADRs, dispatch contracts, related PRs)
   - **Acceptance criteria** (per `core/templates/sub-issue-dispatch.md`)
   - These sections come **after** the human-readable summary, never before.

5. **Sub-issue dispatch contracts inherit the same convention.** The dispatch-contract body shape per `core/templates/sub-issue-dispatch.md` (Scope / In scope / Out of scope / Acceptance / Spec links / Verification gate) lives **after** the first-paragraph problem statement. A cardinal AI picking up the sub-issue reads the dispatch contract; a human picking it up reads the problem statement first and uses the dispatch contract as scope guidance.

**Examples — title comparison.**

| ❌ Internal framework jargon | ✅ Human-readable problem |
|---|---|
| `[6:frontend-engineer] Stage 1 forensic — confirm Bug C/D root cause on demo-gha data (#92 iteration 1)` | `[6:frontend-engineer] Investigate why deployment tiles render as isolated nodes without connecting graph edges on the live SPA` |
| `[6:qa-engineer] Overlap-invariants regression spec — permanent CI gate (#83 framework hygiene)` | `[6:qa-engineer] Add automated tests that catch when deployment tiles overlap each other or leak past service-row boundaries` |
| `[6:solution-architect] Stage 2a: ADR-0012 amendment per iteration-1 forensic (§4 + §5 + §2)` | `[6:solution-architect] Update the ngx-graph layout contract so deployment tiles render as a DAG instead of stacked-at-x=0 nodes` |
| `[Feature] Migrate frontend graph + connector rendering to @swimlane/ngx-graph` | `[Feature] Replace bespoke connector lines between deployment tiles with the ngx-graph library so branching pipelines render without crossing arrows` |

**Applies to.** Every GitHub artefact authored by the framework — `ginee-file-bug` / `ginee-file-feature` / `ginee-file-framework-bug` / `ginee-file-framework-feature` / `ginee-promote-discussion` / sub-issue dispatch contracts (team-lead-authored, skill-runner-posted) / follow-up issues filed during a dispatch lifecycle / any `gh issue create` command issued by the framework. Cross-references within issue bodies (PR descriptions, dispatch-map stickies, comment cadences) MAY use framework jargon since they reference internal state, but the issue **title** + **first body paragraph** are always human-facing.

**Out of scope.** Commit messages (governed by conventional-commit format per project's commit history pattern). PR titles (still human-readable but follow conventional-commit shape). Dispatch-map stickies + cycle-summary comments on parent issues (internal framework state; jargon acceptable).

**Pre-publish self-check** (skill-runner before `gh issue create`; team-lead before authoring sub-issue body):

- [ ] Does the title name the *problem* or *request*, not the *investigation*?
- [ ] Does the first body paragraph make sense to someone who has never seen this project's framework / ADRs / prior issues?
- [ ] For bugs: is there a numbered steps-to-reproduce section?
- [ ] Are internal bug letters (`Bug C`, `OV1`), file paths, and module names absent from the title (allowed in body sections)?
- [ ] Are framework-internal phase tags (`Stage 1 forensic`, `Phase B iteration 1`) absent from the substantive part of the title?

If any check fails, rewrite before posting.

---
