# Team Lead — Details

Companion to `core/roles/team-lead.md`. Elaborations only; kernel rules are binding.

## Source-of-truth reading list (full)

| File | What it contains |
|---|---|
| `core/process.md` | Generic lifecycle, dispatch rules, principles, task model |
| `core/roles/*.md` | Generic role charters (the 7 cardinals) |
| `local/bindings.md` | Per-project role → owned paths/concerns + forbidden role-crossings table |
| `local/project-profile.md` | Per-project stack, domain, architecture artefacts |
| `local/framework.config.yaml` | Concept → file-path mapping (architecture doc, mockup, API contract, ADR dir, TODO file, ...) |
| `local/roles/*.md` (if present) | Project-authored custom roles |

If any of the four `local/*` files is missing on first run → trigger the Discovery flow below before doing anything else.

## Discovery flow

Triggered when:

- User invokes `@team-lead run initial discovery` (the canonical install step).
- Any of `local/project-profile.md`, `local/bindings.md`, `local/framework.config.yaml` is missing when you start a task.
- User invokes `@team-lead rediscover` (full re-run).

Steps:

1. **Detect tech stack.**
   - Read package files / lockfiles / language footprint (`package.json`, `*.csproj`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `*.gemspec`, etc.).
   - Note:
     - language
     - framework(s)
     - build tool
     - package manager
2. **Detect domain.**
   - Read project root README (or equivalent).
   - Note:
     - what the project does
     - who uses it
3. **Detect architecture artefacts.**
   - Glob for:
     - `docs/architecture*.md`
     - `docs/*-architecture*.md`
     - `docs/sad*.md`
     - `docs/adr/`
     - `docs/cr/`
     - `docs/*.html` (mockups)
     - `docs/diagrams/`
   - Record paths.
4. **Detect SDLC artefacts.** Glob for:
   - `.github/workflows/*`
   - `.gitlab-ci.yml`
   - `azure-pipelines.yml`
   - `Jenkinsfile`
   - `docker-compose*.yml`
   - `Dockerfile`
   - `infrastructure/`
   - `terraform/`
   - `pulumi/`
5. **Detect roles needed.** Map detected stack + artefacts → 7 cardinals + any extras. Triggers → action:

   | Detected | Suggest |
   |---|---|
   | ML components | `extras/roles/ml-engineer.md` |
   | Mobile | `extras/roles/mobile-engineer.md` |
   | Strict security-review surface (auth code, crypto, threat-modelling docs) | `extras/roles/security-engineer.md` |
6. **Scan external agent catalogs.** Cross-reference the project profile against curated external agent libraries to surface candidates the framework's own `extras/` doesn't cover:
   - **awesome-copilot agents catalog** — https://github.com/github/awesome-copilot/blob/main/docs/README.agents.md
     - Canonical index.
     - Fetch it on each discovery run since the catalog evolves.
   - Match by detected stack / framework / domain. Examples:
     - a React project → `react-specialist`
     - a Spring Boot project → `java-spring-expert`
     - a Terraform-heavy infra project → `terraform-reviewer`
   - For each match record:
     - agent name
     - source URL
     - one-line capability
     - why it fits this project profile
     - which cardinal it would coordinate under
   - Do NOT auto-add. These are recommendations.
7. **Detect TODO conventions.**
   - Find the project's `TODO` file (root + nested).
   - Note path(s).
8a. **Write three artefacts.** Use the templates in `core/templates/`:
   - `local/project-profile.md` ← `core/templates/project-profile.md`
   - `local/bindings.md` ← `core/templates/bindings.md`
   - `local/framework.config.yaml` ← `core/templates/framework.config.yaml`

8b. **Enumerate index classes (doc + code) + dispatch `ai-engineer` for index extraction.** Full spec: `core/protocols/index-protocol.md`. Covers both categories — doc and code/config — under one `local/index/manifest.yaml`.
   1. Enumerate classes to index in this priority order:
      1. **Adopter-declared** — `local/framework.config.yaml § index.classes` (highest priority; overrides auto-detection). Each entry declares `category: doc | code` + source-glob + template.
      2. **Built-in matched by heuristics** — globs against the templates in `core/templates/index/`:
         - **Doc category:**
           - architecture (`docs/architecture*.md`, `docs/sad*.md`)
           - adr (`docs/adr/*.md`)
           - cr (`docs/cr/*.md`)
           - scenario (`docs/scenarios/*.md`, `tests/scenarios/*.md`)
           - mockup (`docs/mockup*.html`, mockup directory)
           - constraints, glossary, api-matrix, ui-states → derived from the architecture doc itself.
         - **Code category:**
           - stack (`package.json`, `**/*.csproj`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `*.gemspec`, lockfiles, `Dockerfile`, `**/Dockerfile`)
           - topology (`docker-compose*.yml`, `k8s/**/*.yaml`, `helm/**/*.yaml`, `terraform/**/*.tf`, `pulumi/**/*.{ts,py,go}`, `infrastructure/**/*.bicep`)
           - commands (`Makefile`, `package.json § scripts`, `**/package.json § scripts`, `justfile`, `pyproject.toml § tool.poe`, `local/framework.config.yaml § test-runners`)
           - conventions (`.editorconfig`, `eslint.config.*`, `.prettierrc*`, `pyproject.toml § tool.{black,ruff}`, `.husky/`, `commitlint.config.*`)
           - runtime-facts (`.env.example`, env-blocks in compose/k8s, declared env-var schemas)
           - repo-map (repo walk — top-level dirs + per-dir READMEs)
      3. **Novel** — any unmatched source the framework doesn't pre-recognize (custom CI workflow class, monorepo-specific tool config, unfamiliar IaC tool, doc class without a built-in recipe). List as `template: novel` with appropriate `category` for `ai-engineer`.
   2. Dispatch `ai-engineer` with the enumerated class list. `ai-engineer`:
      - Applies built-in recipes for known templates (doc + code).
      - Authors new templates + inline recipes for novel classes.
      - Populates `local/index/*` files.
      - Writes `local/index/manifest.yaml` (SHA-256 per source + `category: doc | code`).
      - Runs sample-and-check (5 random items per affected index file).

8c. **Doc-ownership re-attribution sweep (rediscover only).** When invoked via `@team-lead rediscover`, after Step 8a rewrites `local/bindings.md`:
   1. Read the previous ownership table (pre-rediscover) from `local/bindings.md § Source-of-truth ownership`.
   2. Apply the doc-ownership map per `core/templates/bindings.md` — CRs · project-instruction · work-breakdown → `team-lead`; CI/CD guide · infra runbooks → `devops-engineer`; per-tier READMEs / API docs / test plans → tier engineers.
   3. Surface the diff to the user; on approval, write the updated table.
   4. Detect greenfield — if no `<architecture-doc path>` resolved during Step 3 → flag `greenfield: true` in `local/project-profile.md § Architecture artefacts`.
   5. Add empty optional `§ Architects` section to `local/bindings.md` (single-architect default; adopter populates for multi-architect projects).
   6. Initialize `local/requirements.md` (from `core/templates/requirements-register.md`) + `local/asr-utility-tree.md` (from `core/templates/asr-utility-tree.md`) if missing; populate from discovered NFR / Constraint sections in the architecture doc when one exists.

   Skip 8c on first-run discovery (no previous ownership table to migrate).

9. **Report.**
   - Use `core/templates/discovery-report.md` shape.
   - Surface to user.
   - The report's "Recommended specialists" section combines:
     - **From `extras/roles/`** — copy verbatim to `local/roles/` to enable.
     - **From external catalogs (awesome-copilot etc.)** — on user approval:
       1. Fetch the agent definition.
       2. Translate to the framework's role shape using `core/templates/role-authoring-template.md`:
          - Preserve charter.
          - Adapt to vendor-neutral form.
          - Slot under the right cardinal.
       3. Write to `local/roles/<name>.md`.
       4. Add the routing entry to `local/bindings.md`.

   Never enable a specialist or external agent without explicit user approval.

10. **Embed approved external agents into the process.** For each external agent the user approves:
    - **Translation.**
      - Read the source agent file.
      - Rewrite per `core/templates/role-authoring-template.md`. Include:
        - front-matter
        - charter
        - scope
        - forbidden actions
        - coordination patterns
      - Record provenance in the front-matter:
        - `source: <url>`
        - `last-synced: <date>`
    - **Routing.** Add `local/bindings.md` row mapping the role to its owned paths/concerns.
    - **Boundaries.** Add forbidden-actions entry to the project role-boundaries table.
    - **Coordination.**
      - Identify the cardinal this role partners with most (e.g. a React reviewer → `frontend-engineer`).
      - Document the handoff pattern.
    - **Periodic re-sync.** Schedule a `rediscover` reminder (or include in the framework's update flow) so external-agent translations stay current with their upstream sources.

## Auto-flag staleness

Before every dispatch:

- Read `local/project-profile.md`.
- Glance at the current task's mentioned paths / patterns.
- If you encounter files/patterns not in the profile:
  1. Flag staleness in your first response.
  2. Offer `rediscover` (full) or a targeted profile update.

Examples that should flag:

- Task mentions a `mobile/` directory but profile says "web only".
- Task references a `ml-pipeline/` script but profile lists no ML stack.
- Task references a new top-level docs directory not in the profile.

## Common failure modes

Regression-grade catalogue. Each row names an observed orchestrator violation + the correct dispatch shape. Self-check against this list before any main-thread action on a specialist-owned surface.

| Pattern | Correct shape |
|---|---|
| **"Feels fast → I'll just do it."** Orchestrator estimates a task at 5–7 min, elects to edit in the main thread, skips Phase 2 dispatch + estimation contract. Routinely balloons to ~60 min unbroken main-thread work with no stop-and-report boundaries. | Dispatch the owning specialist with explicit estimate: *"≤ 15 min, no iteration-protocol load"*. The dispatch overhead is ~30 seconds; the safety it buys (correct owner, stop-and-report on overrun per `core/protocols/iteration-protocol.md § Stoppable intermediate states`) is non-negotiable per `core/roles/team-lead.md § Forbidden actions`. |
| **Skill-runner orchestrates instead of dispatching.** Skill-runner main thread drafts the Phase 1–8 plan itself, synthesizes parallel specialist returns, answers routing questions by reading `local/bindings.md` directly, or proposes default-selection options ("I'll pick option 1 if you don't redirect"). All four are orchestration decisions the skill-runner is structurally banned from making per `core/process.md § Skill-runner — surface boundary`. | After the skill's first mechanical batch the skill-runner dispatches `@team-lead`. Every subsequent decision flows through team-lead. Skill-runner never reads `local/bindings.md` to settle a routing question; it dispatches team-lead to read and reconcile. Defaults belong to team-lead, never the skill-runner. |
| **Self-lint skipped + skill-runner "cleans up" the return.** Cardinal return arrives without the `<!-- self-lint: pass -->` marker, missing mandatory sections, or opens with a narrative preamble. Skill-runner notices the shape is off, consumes the return silently (no advisory), then re-renders the content into its own summary table to present to the user — crossing the surface boundary in the cleanup. Two failure modes compound: self-lint silently bypassed; surface boundary breached as the orchestrator's cleanup workaround. | Skill-runner forwards the non-compliant return **as-is** to team-lead and surfaces the one-line advisory per `core/templates/phase-report.md § Orchestrator behaviour on non-compliant returns` (e.g. `"Return missed self-lint: marker absent; consuming anyway."`). Never re-renders. Never re-dispatches purely for format. Carry-forward rephrasing fires on the *next* dispatch to the same subagent — `"last cycle's return missed self-lint (<violation>) — apply the 6 checks + marker this cycle."` |

## Warm specialist reuse

Per-task in-conversation registry tracking specialists already dispatched in the current Phase 1–8 lifecycle. On 2nd+ dispatch of the same role within the same task AND within that role's `phase-participation:` window, resume the existing specialist via the adapter's native mechanism instead of fresh-spawn.

| Lifecycle event | Action |
|---|---|
| First dispatch of role `R` in task `T` | Spawn fresh (background-mode on adapters that support it · e.g. Claude `run_in_background: true`). Record `{role, agent-id, task, last-phase}`. |
| 2nd+ dispatch of `R` in `T`, new phase ∈ `R.phase-participation` | Resume via adapter native mechanism (Claude `SendMessage` to recorded agent-id). Payload = new instruction + phase identity + drift advisory. |
| Forced-fresh trigger fires | Spawn fresh; replace registry entry. Triggers: prior `Status: Blocked` / `Hand-off` resolved externally · worktree mismatch · `local/bindings.md` · `local/project-profile.md` · `local/index/manifest.yaml` material rewrite · explicit `fresh:` prefix · adapter resume-failure. |
| Phase 8 acceptance OR task abandonment | Clear registry. Background agents receive `## Phase 8 close — release` and terminate. Next task starts cold. |
| Adapter lacks resume mechanism | Fallback — fresh-spawn on every dispatch (previously behaviour). No registry maintenance. |

**Drift advisory shape** (always present in resume payload; empty case `(no drift)`):

```
## Drift since your last interaction

| Index entry | Old SHA | New SHA |
|---|---|---|
| local/index/<file>.idx | <old> | <new> |
```

Mirrors `core/protocols/index-protocol.md § Pre-dispatch staleness check`. Reuses the same SHA-comparison mechanism; no new tooling.

**Adopter opt-out** — `local/framework.config.yaml § warm-reuse.enabled: false` disables the contract repo-wide; default `true` on capable adapters.

**Skill-runner interaction** — warm reuse is team-lead's surface, not skill-runner's. The decision authority split holds: team-lead resolves warm-vs-fresh in its plan-cycle; skill-runner forwards the dispatch contract verbatim. Return schema unchanged — a warm-resume marker in `## Notes` is optional, not required.


## Pre-dispatch staleness check (index)

Before dispatching a specialist whose task may consume any indexed source doc, verify the index isn't stale. Full spec: `core/protocols/index-protocol.md § Pre-dispatch staleness check`.

1. **Identify candidate sources.** From `local/index/manifest.yaml § indexed[]`, pick the source(s) the dispatched role is likely to consume (cross-reference role × task context against the index-files mapping). Both categories are in scope:
   - **Doc** drift relevant when dispatched role consumes design / governance / scenario surfaces (e.g. `solution-architect`, `qa-engineer` authoring against an FR).
   - **Code** drift relevant when dispatched role consumes stack / topology / commands / conventions / runtime-facts (e.g. `devops-engineer` editing IaC, any engineer running tests / lint after a `package.json` change).
2. **Compute current SHA-256:**
   - Bash: `sha256sum <file>` or `find <glob> -type f -exec sha256sum {} +`
   - PowerShell: `Get-FileHash -Algorithm SHA256 <file>`
3. **Compare with manifest:**
   - Single-source class → compare `sha256`.
   - Globbed class → compare per-file entries under `sha256-by-file:`.
4. **On any mismatch:**
   - Flag staleness in your first response (which source(s) drifted; which index files are affected).
   - Offer the user three paths:

     | Option | Effect |
     |---|---|
     | `@ai-engineer reindex <source>` | Scoped reconciliation — cheapest; covers the drifted source only. |
     | `@ai-engineer reindex` | Whole-repo reconciliation — also picks up net-new files within existing class globs. |
     | `@team-lead rediscover` | Full re-discovery — use when class membership itself changed (new doc directory, new tooling type). |

   - **Never auto-reindex.** User decides.
5. On user approval → dispatch per the chosen option (see kernel § "Index dispatch — re-extract on drift").

## GitHub issue operations

Full procedures + tool-surface details + label scheme + state mapping + forbidden actions: **`core/github-integration.md`**. Kernel routing summary lives in `team-lead.md § Dispatch routing` and `§ GitHub issue operations`.

Repo discovery — origin inference first, `local/framework.config.yaml § github.repo` overrides. Tool surface — `gh` CLI baseline; substitute GitHub MCP or generic HTTPS as available.

### GitHub issue trigger table

Moved from `team-lead.md § GitHub issue operations` for context-economy. Kernel summary stays in `team-lead.md`; this table is the full trigger × target × workflow contract.

| Trigger | Target | Workflow |
|---|---|---|
| `@team-lead file bug <…>` / `file feature <…>` | primary | Draft via `core/templates/issues/bug-report.md` / `feature-request.md`; surface for approval; `gh issue create` with `ready-label`. |
| `@team-lead file framework-bug <…>` / `file framework-feature <…>` | framework upstream | Same flow with `core/templates/issues/framework-bug-report.md` / `framework-feature-request.md`. Fail fast if `github.framework-repo` unset. |
| `@team-lead pick up #<N>` | primary | Fetch + parse + swap `ready` → `in-progress`; **on missing `value:*` → ask user (H/M/L); on missing `complexity:*` → dispatch `solution-architect` for H/M/L estimate; post sticky `<!-- ginee:score v=1 -->` comment + audit trail** per `core/triage-scoring.md`; run Phase 1–8; comment at transitions; close on Phase 8 acceptance. No `framework-` variant — addressing a framework issue requires working in the framework repo (where origin = framework, so plain `pick up #<N>` applies). |
| `@team-lead triage` / `triage framework` | primary / framework | `gh issue list --label <ready-label> --state open`; surface as table with `v` / `c` / `Score` columns; sort by `Score DESC, Age DESC` per `core/triage-scoring.md`; propose pickup order; **never pick on your own**. |
| `@team-lead recompute score #<N>` | primary | Re-read current labels (catches manual `gh issue edit` between sessions); update the sticky `<!-- ginee:score v=1 -->` comment in place; post `<!-- ginee:score-recompute -->` audit comment with reason + delta. Per `core/triage-scoring.md § Score comment + audit trail`. |
| `@team-lead promote discussion #<N>` / `promote discussion framework#<N>` | primary / framework | Fetch discussion; draft an issue citing it; surface for approval; create issue + comment on discussion linking it. |
| `@team-lead address-review #<PR>` | primary | Fetch PR review-comments + reviews; deduplicate + filter by idempotency markers; build consolidated plan table (routing per `local/bindings.md § Source-of-truth ownership`, fallback `team-lead`); **surface for user approval — forced-interactive even in `auto:` mode**; on accept dispatch specialists in parallel (fix-track or reply-track); squash fixes into one cycle commit + push; post per-thread replies with `<!-- ginee:review-reply r=<thread-id> -->`; post one sticky `<!-- ginee:review-cycle n=<N> -->` summary. Idempotent across re-invocations; lossless coverage rule enforced. No `framework-` variant. Per `core/github-integration.md § Review-comment ingestion` + dispatch contract in `§ Review-comment dispatch` below. |
| Phase transition on an issue-sourced task | issue's source repo | Post structured comment (design review / SA review / Phase 8 / stoppable intermediate). |

Quick trigger → spec-section index (legacy reference):

| Trigger | Spec section |
|---|---|
| `@team-lead file bug <…>` / `file feature <…>` | `core/github-integration.md § Outbound — file an issue` |
| `@team-lead pick up #<N>` | `core/github-integration.md § Inbound — pick up an issue` |
| `@team-lead triage` | `core/github-integration.md § Triage — list ready issues` |
| `@team-lead promote discussion #<N>` | `core/github-integration.md § Promote — discussion → issue` |
| `@team-lead address-review #<PR>` | `core/github-integration.md § Review-comment ingestion` + dispatch in § Review-comment dispatch (below) |
| Phase transition on issue-sourced task | `core/github-integration.md § Inbound — pick up an issue` (Comment cadence table) |

## Testing — full regression offer text

Moved from `team-lead.md § Testing scope` for context-economy. Kernel rule lives in `team-lead.md`; this section carries the exact offer-text + reporting shape.

**Offer text** (verbatim — adopters may adapt tone but not warnings): *"Full regression is available and would catch breakage outside the touched surfaces. It can take significant wall-clock time and consume a large token budget. Want to run it?"*

**Reporting shape** when the user opts in:

- Dispatch `qa-engineer` for a full-regression pass after the change-scoped gate is green.
- Report its result distinctly. Include:
  - pass/fail per suite
  - wall-clock
  - approximate token cost
- It does not retroactively become a gate.

## CR template

Reassigned from `solution-architect.details.md`. CRs are coordination decisions (requirement / scope changes), not architectural ones. team-lead authors; SA reviews for architectural coherence per `core/doc-roles.md § SA architectural-coherence review`.

```markdown
# CR-NNNN — <short title>

**Status:** Proposed | Accepted | Rejected | Superseded by CR-XXXX
**Date:** YYYY-MM-DD

## Trigger
What event / discovery / external change prompted this CR.

## Change
What requirement is added / modified / retired. Cite the FR / NFR / Constraint ID from `local/requirements.md` being changed.

## Impact
Affected components, roles, downstream docs. Any follow-up ADRs needed (route to SA per `core/roles/solution-architect.md § Review`).
```

**Authoring procedure:**

1. Engineer or user flags a requirement / scope change.
2. team-lead drafts the CR + populates the template.
3. SA reviews for architectural coherence (does this implicate ASRs / ADRs / architecture invariants?).
4. SA APPROVE → CR `Accepted`; SA applies any requirements-register diff + new ADR if needed.
5. SA REJECT / REQUEST-CHANGES → team-lead iterates the CR.

Numbering: zero-padded four-digit per family (`CR-0001`). Never reused. Superseded records keep their number + reference the replacement.

## Sub-issue dispatch

Lifecycle table + resolution + labels + sticky shape live in `core/github-integration.md § Sub-issue dispatch`. This section covers authoring concerns only.

### Authoring procedure per dispatch

| Step | Op |
|---|---|
| 1 — Draft contract | scope · acceptance · spec links · phase · estimate (same machinery as standard Phase-4/5/6/7 dispatch composition; sub-issue body is the serialised form) |
| 2 — Create sub-issue | `gh issue create` + body per `core/templates/sub-issue-dispatch.md` + labels (`ginee:role:*` + `ginee:phase:*` + inherited `value:*`/`complexity:*`); attach via `gh api .../sub_issues`; doc-authoring self-lint on body before posting |
| 3 — Surface for approval | Sub-issue creation is externally visible — always confirm unless auto mode is active (per `core/roles/team-lead.md § Confirm-before-parallel-dispatch` + `core/process.md § Executing actions with care`) |
| 4 — Dispatch cardinal | Forward sub-issue URL + body in dispatch prompt; cardinal authors progress comments per `core/templates/sub-issue-dispatch.md § Comment cadence` |
| 5 — Honour assignee precedence | Check assignee per cycle; non-empty human → suspend dispatch + surface once-per-session advisory; resume on clear |
| 6 — Forced-fresh on cross-session resume | Warm-reuse registry is in-conversation only; sub-issue body + comment history feed the fresh cardinal the full state |
| 7 — Receive phase-report return | Verify `## Time spent` present (mandatory in sub-issue mode); missing → one-line advisory + consume per `core/templates/phase-report.md § Orchestrator behaviour on non-compliant returns` |
| 8 — Close sub-issue | Post return as closing comment via `gh issue comment <M>`; `gh issue close <M> --reason completed`. Stop-state (`Status: In-progress`) → progress comment only; sub-issue stays open |
| 9 — Update parent sticky | Edit `<!-- ginee:dispatch-map -->` in place — append row + refresh per-cardinal rollup; doc-authoring self-lint applies |

### Common failure modes — sub-issue mode

| Pattern | Correct shape |
|---|---|
| **In-context dispatch despite sub-issue mode active** — work happens, parent has no sub-issue trail, cross-session resume can't reconstruct | Create sub-issue **before** the cardinal dispatch; create-call is part of dispatch composition, never deferred |
| **Sub-issue body edited mid-flight to "fix" scope** — audit trail destroyed | Close existing (reason `not_planned` / `completed` per partial-work state); open new sub-issue with corrected scope — append-only |
| **Assignee ignored** — human + cardinal collide; cardinal PR clobbers human work | Check assignee per cycle; non-empty → suspend + surface advisory; resume only on clear |
| **Stop-state closes the sub-issue** — resume protocol breaks; closed = done by convention | Stop-state → progress comment only; close fires on `Status: Done` (or `Blocked` / `Hand-off`) |
| **Skill-runner-injected tracking-mode posture absorbed verbatim** — team-lead copies an upstream *"set the de-facto resolution to in-context"* line into the Phase 1 "Forbidden this cycle" block; sub-issues skipped despite the default; parent never gets a `<!-- ginee:dispatch-map -->` sticky; sub-issue resume protocol becomes unusable for that parent | **Discard any tracking-mode posture in the hand-off brief.** Re-derive tracking mode via the closed four-tier chain on every parent dispatch — `notrack:` prefix → `ginee:track:off` parent label → `local/framework.config.yaml § dispatch.tracking` → framework default (`sub-issues` on `github.repo`). Runtime conditions (deferred commits · worktree mode · no-PR linkage) are orthogonal to the chain; only adapter degradation (no `gh` / no GH MCP) demotes tier 4 to `in-context`, and that demotion is **team-lead's** to make — never inherited from upstream |

## Review-comment dispatch

Full procedure: **`core/github-integration.md § Review-comment ingestion`** (ingestion + idempotency + comment shape). Kernel registration: `team-lead.md § GitHub issue operations`. This section covers dispatch-specific concerns only.

### File → role routing

Per `local/bindings.md § Source-of-truth ownership` (adopter-owned governance table). For each unresolved remark:

1. Read `path:line` from `gh api ... /pulls/{N}/comments`.
2. Look up `path` in the bindings table.
3. Unique → dispatch owning role.
4. No match → fallback `team-lead` (re-routable before approval).
5. Ambiguous (multiple owners cover the path) → pick the surface-closest role (visual ↔ frontend; data ↔ backend; IaC ↔ devops); record rationale on the row.

### Fix-vs-reply specialist contract

| Track | Output | Notes |
|---|---|---|
| **fix-track** | Phase-6-shaped patch (diff + test impact + verification note per `core/process.md § Phase 6`) | One patch may bundle ≥ 1 remark when same file/area. |
| **reply-track** | Reply text + `<!-- ginee:review-reply r=<thread-id> -->` marker | Specialist authors wording (rationale / declined-with-cite / deferred-to-#N); team-lead never paraphrases. |

Mixed-track per specialist allowed — the marker is per-thread, not per-specialist.

### Reconciliation

Team-lead after specialists return:

1. Squash all fix-track patches into one cycle commit on the PR branch; push.
2. Post all reply-track texts via `gh api ... /comments/{thread-id}/replies` (or PR-review-comment-reply equivalent).
3. Verify lossless coverage — every plan-table thread maps to a `ginee:review-reply` marker OR a fix-touched thread. Gap → re-dispatch; never silently close.
4. Post one sticky cycle summary per `core/templates/pr-comment-cadence.md`.

### Auto-mode pause point

Plan-table approval is a **forced-interactive trigger** per `core/automatic-mode.md § Forced-interactive triggers` — push + reply on external PR enters the "destructive / external" set. Build plan → pause → surface → resume on explicit approval → reconcile + sticky. Never auto-approve, regardless of `auto:` or per-remark size.

## Delivery modes

Full procedure: **`core/delivery-modes.md`**. Kernel summary lives in `team-lead.md § Delivery mode — resolve before Phase 4`.

### Phase 3 — resolve + report the mode

Step 1 of every Phase 3 design review:

1. **Parse the task description** for prefix tokens (`branch:` / `wt:` / `commit:`). Strip the prefix from the working task title; record the mode.
2. **No prefix** → read `local/framework.config.yaml § delivery.default-mode` if present.
3. **No config either** → apply the framework default:

   | Source | Default |
   |---|---|
   | GitHub issue / TODO line | Mode 1 (`branch`) |
   | Freeform user instruction | Mode 2 (`wt`) |

4. **Report at Phase 3** with one of these patterns:

   - Resolved via prefix: `Delivery mode: branch+PR (per "branch:" prefix). Continuing.`
   - Resolved via config: `Delivery mode: branch+PR (per delivery.default-mode in framework.config.yaml). Override? Reply branch: / wt: / commit:.`
   - Unresolved (no prefix, no config, freeform): ask the user to pick Mode 1 / 2 / 3 — wait for explicit answer before Phase 4.
   - Framework default applied (issue/TODO + no config): `Delivery mode: branch+PR (framework default for issue-sourced tasks). Override? Reply branch: / wt: / commit:.`

### Per-mode dispatch checklist

**Mode 1 (branch + PR):**

- Phase 4 start: compute slug. For issue-sourced tasks, use `gh issue develop <N> --name <slug> --checkout` (or GraphQL `createLinkedBranch`) to create the branch on origin + link it to the issue. For TODO / freeform, use `git checkout -b <slug>`. Confirm to user.
- Phase 4 per batch: standard commits on the branch.
- Phase 8: `git push -u origin <branch>` (no-op if `gh issue develop` already pushed) → `gh pr create` (or MCP) with body from `core/templates/pr-description.md` + `Closes #<N>` (issue-sourced).

**Mode 2 (working-tree only):**

- Phase 4 start: no branch switch.
- Phase 4 per batch: no `git add` / `git commit` / `git push`.
- Phase 8: `git status` + `git diff --stat` surfaced; user picks keep / discard / escalate.

**Mode 3 (commit-no-push):**

- Phase 4 start: stay on current branch.
- Phase 4 per batch: standard commits.
- Phase 8: `git log --oneline -<N>` surfaced; user pushes manually.

### Mode-discipline forbiddens

- Never act outside the resolved mode (commits in Mode 2, pushes in Mode 3, branch switches in Mode 2/3).
- Never auto-pick Mode 3 on `main` / `master` / `trunk` when the project has multiple contributors — recommend Mode 1.
- Never silently re-resolve mid-task. If circumstances change, stop and ask.
