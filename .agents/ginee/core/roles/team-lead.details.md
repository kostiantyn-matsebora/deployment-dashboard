---
audience: team-lead-only
load: on-demand
triggers: [team-lead-details, dispatch, routing, discovery, rediscover]
cap-bytes: 36864
reads-before-applying: []
---

# Team Lead — Details

Companion to `core/roles/team-lead.md`. Elaborations only; kernel rules are binding.

## Discovery flow

**Triggered when** — `@team-lead run initial discovery` · any of `local/project-profile.md` · `local/bindings.md` · `local/framework.config.yaml` missing · `@team-lead rediscover`.

| Step | Detect / produce | Notes |
|---|---|---|
| 1 | Tech stack — language · framework(s) · build tool · package manager | Read `package.json` · `*.csproj` · `pyproject.toml` · `Cargo.toml` · `go.mod` · `pom.xml` · `*.gemspec` · lockfiles. |
| 2 | Domain — what the project does · who uses it | Read project-root README. |
| 3 | Architecture artefacts — paths | Glob `docs/architecture*.md` · `docs/*-architecture*.md` · `docs/sad*.md` · `docs/adr/` · `docs/cr/` · `docs/*.html` (mockups) · `docs/diagrams/`. |
| 4 | SDLC artefacts | Glob `.github/workflows/*` · `.gitlab-ci.yml` · `azure-pipelines.yml` · `Jenkinsfile` · `docker-compose*.yml` · `Dockerfile` · `infrastructure/` · `terraform/` · `pulumi/`. |
| 5 | Specialist roles needed | ML → `extras/roles/ml-engineer.md` · Mobile → `mobile-engineer.md` · auth/crypto/threat-modelling surface → `security-engineer.md`. |
| 6 | External agent candidates | Cross-reference the [awesome-copilot catalog](https://github.com/github/awesome-copilot/blob/main/docs/README.agents.md) (fetched each run — catalog evolves) by detected stack / framework / domain. Record name · URL · one-line capability · fit · coordinating cardinal. **Never auto-add.** |
| 7 | TODO file path(s) | Root + nested. |
| 8a | Write `local/project-profile.md` · `local/bindings.md` · `local/framework.config.yaml` | From `core/templates/*`. |
| 8b | Enumerate index classes + dispatch `ai-engineer` | See § Index enumeration below. |
| 8c | (rediscover only) Doc-ownership re-attribution sweep | See § 8c below. Skip on first-run. |
| 9 | Report per `core/templates/discovery-report.md` | Recommended specialists combine `extras/roles/` (verbatim copy → `local/roles/`) + external-catalog matches (translate per `core/templates/role-authoring-template.md` on user approval). **Never enable any specialist without explicit user approval.** |
| 10 | Embed approved external agents | Translation (frontmatter · charter · scope · forbidden actions · coordination patterns) + provenance (`source: <url>` · `last-synced: <date>`). Add `local/bindings.md` row + forbidden-actions entry + cardinal-handoff pattern. Schedule `rediscover` re-sync. |

### Index enumeration (Step 8b)

Full spec: `core/protocols/index-protocol.md`. Class-detection priority (stop at first match per class):

| Tier | Source |
|---|---|
| 1 | Adopter-declared — `local/framework.config.yaml § index.classes` (overrides auto-detect). |
| 2 | Built-in heuristics — globs against `core/templates/index/` templates. |
| 3 | Novel — unmatched sources marked `template: novel` for `ai-engineer`. |

**Built-in glob heuristics:**

| Class | Category | Globs |
|---|---|---|
| architecture | doc | `docs/architecture*.md` · `docs/sad*.md` |
| adr · cr · scenario | doc | `docs/{adr,cr,scenarios}/*.md` · `tests/scenarios/*.md` |
| mockup | doc | `docs/mockup*.html` · mockup directory |
| constraints · glossary · api-matrix · ui-states | doc | Derived from architecture doc |
| stack | code | `package.json` · `**/*.csproj` · `pyproject.toml` · `Cargo.toml` · `go.mod` · `pom.xml` · `*.gemspec` · lockfiles · `**/Dockerfile` |
| topology | code | `docker-compose*.yml` · `k8s/**/*.yaml` · `helm/**/*.yaml` · `terraform/**/*.tf` · `pulumi/**/*.{ts,py,go}` · `infrastructure/**/*.bicep` |
| commands | code | `Makefile` · `package.json § scripts` (incl. nested) · `justfile` · `pyproject.toml § tool.poe` · `local/framework.config.yaml § test-runners` |
| conventions | code | `.editorconfig` · `eslint.config.*` · `.prettierrc*` · `pyproject.toml § tool.{black,ruff}` · `.husky/` · `commitlint.config.*` |
| runtime-facts | code | `.env.example` · env-blocks in compose / k8s · declared env-var schemas |
| repo-map | code | Repo walk — top-level dirs + per-dir READMEs |

`ai-engineer` then applies built-in recipes · authors templates + inline recipes for novel classes · populates `local/index/*` · writes `manifest.yaml` (SHA-256 + `category: doc | code`) · runs sample-and-check (5 random items per affected index file).

### Step 8c — Doc-ownership re-attribution (rediscover only)

1. Read previous `local/bindings.md § Source-of-truth ownership`.
2. Apply doc-ownership map per `core/templates/bindings.md`.
3. Surface diff; on approval write updated table.
4. Greenfield detection — no `<architecture-doc>` resolved at Step 3 → flag `greenfield: true` in `local/project-profile.md § Architecture artefacts`.
5. Add empty optional `§ Architects` section to `local/bindings.md` (multi-architect adopters populate).
6. Initialize `local/requirements.md` + `local/asr-utility-tree.md` if missing; populate from discovered NFR / Constraint sections.

## Auto-flag staleness

Pre-dispatch: read `local/project-profile.md`; check task paths/patterns. Unmatched (e.g. task mentions `mobile/` but profile says web-only · `ml-pipeline/` but no ML stack · new top-level docs dir) → flag staleness in first response; offer `rediscover` or targeted profile update.

## Common failure modes

Self-check before any main-thread action on a specialist-owned surface.

| Failure pattern | Correct shape |
|---|---|
| **"Feels fast → I'll just do it."** Estimates 5–7 min · main-thread edit · skips Phase 2 dispatch / estimation; routinely balloons to ~60 min without stop-and-report boundaries. | Dispatch owning specialist with explicit estimate: *"≤ 15 min, no iteration-protocol load"*. ~30 s dispatch overhead; buys correct owner + stop-and-report on overrun per `iteration-protocol.md § Stoppable intermediate states`. Non-negotiable per `team-lead.md § Forbidden actions`. |
| **Skill-runner orchestrates.** Drafts Phase 1–8 plan · synthesizes returns · reads `local/bindings.md` to settle routing · proposes defaults ("I'll pick option 1"). All structurally banned per `process/dispatch.md § Skill-runner — surface boundary`. | After first mechanical batch, dispatch `@team-lead`. Every subsequent decision flows through team-lead. Defaults belong to team-lead. |
| **Self-lint skipped + skill-runner "cleans up" return.** Return missing marker / sections / opens with preamble; skill-runner consumes silently then re-renders to user — surface-boundary breach. | Skill-runner forwards as-is + one-line advisory per `phase-report.md § Orchestrator behaviour`. Never re-renders, never re-dispatches purely for format. Carry-forward fires on next dispatch: `"last cycle's return missed self-lint (<violation>) — apply the 7 checks + marker this cycle."` |

## Warm specialist reuse

Per-task in-conversation registry. On 2nd+ dispatch of role `R` within task `T` AND new phase ∈ `R.phase-participation`, resume the existing specialist via the adapter's native mechanism.

| Lifecycle event | Action |
|---|---|
| First dispatch of `R` in `T` | Fresh-spawn (background-mode where available — Claude `run_in_background: true`); record `{role, agent-id, task, last-phase}`. |
| 2nd+ dispatch of `R`, new phase ∈ window | Resume via adapter mechanism (Claude `SendMessage` to recorded id). Payload = new instruction + phase identity + drift advisory. |
| Forced-fresh trigger | Fresh-spawn + replace registry. Triggers: prior `Status: Blocked` / `Hand-off` resolved externally · worktree mismatch · `local/bindings.md` / `project-profile.md` / `index/manifest.yaml` material rewrite · explicit `fresh:` prefix · adapter resume-failure. |
| Phase 8 acceptance / abandonment | Clear registry; background agents receive `## Phase 8 close — release` and terminate. |
| Adapter lacks resume | Fresh-spawn on every dispatch (no registry). |

**Drift advisory** in resume payload (empty case `(no drift)`):

```
## Drift since your last interaction

| Index entry | Old SHA | New SHA |
|---|---|---|
| local/index/<file>.idx | <old> | <new> |
```

Mirrors `core/protocols/index-protocol.md § Pre-dispatch staleness check`; same SHA machinery. Opt-out: `local/framework.config.yaml § warm-reuse.enabled: false`. Skill-runner interaction: team-lead decides; skill-runner forwards verbatim.

## Pre-dispatch staleness check (index)

Full spec: `core/protocols/index-protocol.md § Pre-dispatch staleness check`.

1. **Identify candidate sources** from `local/index/manifest.yaml § indexed[]` by role × task context. Doc drift = design / governance / scenario surfaces. Code drift = stack / topology / commands / conventions / runtime-facts.
2. **Compute SHA-256** — bash `sha256sum <file>` or PowerShell `Get-FileHash -Algorithm SHA256 <file>`.
3. **Compare** — single-source `sha256` · globbed per-file under `sha256-by-file:`.
4. **On mismatch** — flag staleness; offer:

   | Option | Effect |
   |---|---|
   | `@ai-engineer reindex <source>` | Scoped reconciliation — drifted source only. |
   | `@ai-engineer reindex` | Whole-repo — also picks up net-new files within existing class globs. |
   | `@team-lead rediscover` | Full re-discovery — class membership changed. |

   **Never auto-reindex.** User decides; dispatch per chosen option.

## GitHub issue operations

Full procedures · tool surface · labels · state mapping · forbidden actions: `core/protocols/github-integration.md`. Repo discovery — origin inference first; `local/framework.config.yaml § github.repo` overrides. Tool surface — `gh` CLI baseline; substitute GitHub MCP / generic HTTPS as available.

### Trigger × target × workflow

| Trigger | Target | Workflow / spec section |
|---|---|---|
| `file bug` / `file feature` | primary | `core/templates/issues/{bug-report,feature-request}.md` → surface → `gh issue create --label <ready-label>`. Spec: `github-integration.md § Outbound`. |
| `file framework-bug` / `file framework-feature` | framework | Same flow with `framework-*` templates. Fails fast if `github.framework-repo` unset. |
| `pick up #<N>` | primary | Fetch · parse · swap `ready` → `in-progress`; missing `value:*` → ask user; missing `complexity:*` → dispatch SA for estimate; sticky `<!-- ginee:score v=1 -->` + audit per `triage-scoring.md`; run Phase 1–8; close on acceptance. No `framework-` variant — work in framework repo. Spec: `github-integration.md § Inbound`. |
| `triage` / `triage framework` | primary / framework | `gh issue list --label <ready-label> --state open` → table with `v` / `c` / `Score`; sort `Score DESC, Age DESC` per `triage-scoring.md`; propose. **Never picks.** |
| `recompute score #<N>` | primary | Re-read labels (catches manual `gh issue edit` between sessions); update sticky in place; post `<!-- ginee:score-recompute -->` audit with reason + delta. Per `triage-scoring.md § Score comment + audit trail`. |
| `promote discussion #<N>` / `promote discussion framework#<N>` | primary / framework | Fetch discussion · draft issue citing it · surface · create + comment on discussion linking it. Spec: `github-integration.md § Promote`. |
| `address-review #<PR>` | primary | Fetch comments + reviews · dedupe by idempotency markers · build plan table (routing per `bindings.md § Source-of-truth ownership`, fallback `team-lead`) · **surface for approval (forced-interactive even in `auto:`)** · parallel dispatch (fix-track / reply-track) · squash fixes to one cycle commit + push · per-thread replies `<!-- ginee:review-reply r=<thread-id> -->` · sticky `<!-- ginee:review-cycle n=<N> -->` summary. Idempotent · lossless coverage. No `framework-` variant. Spec: `github-integration.md § Review-comment ingestion` + § Review-comment dispatch below. |
| Phase transition on issue-sourced task | issue's source | Structured comment (design review · SA review · Phase 8 · stoppable intermediate). |

## Testing — full regression offer

**Offer text** (verbatim — adopters may adapt tone but not the warnings): *"Full regression is available and would catch breakage outside the touched surfaces. It can take significant wall-clock time and consume a large token budget. Want to run it?"*

**On opt-in:** dispatch `qa-engineer` after the change-scoped gate is green; report pass/fail per suite + wall-clock + approximate token cost; never retroactively a gate.

## CR authoring

Companion to `team-lead.md § CR-gate`.

**Non-trivial heuristic.** ≥ 2 architectural-delta triggers (per `solution-architect.md § ADR-gate`) OR `local/requirements.md` register-diff non-empty.

**Skip-reason enum** — under `## Decisions made` when gate skips authorship:

| Value | Trigger |
|---|---|
| `config-disabled` | `change-governance.cr.enabled: false` |
| `issue-source-skip` | `cr.skip-when-issue-source: true` AND task is issue-sourced |
| `prefix-override` | `nocr:` prefix |
| `user-declined` | Forced-interactive prompt declined |

**Logging.** One row — `CR skipped — skip-reason: <value>` when skip · `CR authored — user yes` / `CR declined — user no` on forced-interactive.

## CR template

```markdown
# CR-NNNN — <short title>

**Status:** Proposed | Accepted | Rejected | Superseded by CR-XXXX
**Date:** YYYY-MM-DD

## Trigger
What event / discovery / external change prompted this CR.

## Change
What requirement is added · modified · retired. Cite FR / NFR / Constraint ID from `local/requirements.md`.

## Impact
Affected components · roles · downstream docs. Follow-up ADRs (route to SA per `core/roles/solution-architect.md § Review`).
```

**Authoring procedure:** engineer/user flags scope change → team-lead drafts CR → SA reviews architectural coherence (implicates ASRs / ADRs / invariants?) → APPROVE → CR `Accepted` + SA applies requirements diff + new ADR if needed; REJECT / REQUEST-CHANGES → team-lead iterates.

Numbering: zero-padded four-digit per family (`CR-0001`); never reused; superseded records keep number + reference replacement.

## Sub-issue dispatch

Lifecycle / resolution / labels / sticky: `core/protocols/github-integration.md § Sub-issue dispatch`. Authoring procedure:

| Step | Op |
|---|---|
| 1 | Draft contract — scope · acceptance · spec links · phase · estimate. |
| 2 | `gh issue create` + body per `core/templates/sub-issue-dispatch.md` + labels (`ginee:role:*` · `ginee:phase:*` · inherited `value:*`/`complexity:*`) · attach via `gh api .../sub_issues`. Doc-authoring self-lint on body before posting. |
| 3 | Surface for user approval (externally visible). Skip only in auto mode per `team-lead.md § Confirm-before-parallel-dispatch`. |
| 4 | Forward sub-issue URL + body in dispatch prompt. Cardinal authors progress comments per `core/templates/sub-issue-dispatch.md § Comment cadence`. |
| 5 | Check assignee per cycle — non-empty human → suspend + once-per-session advisory; resume on clear. |
| 6 | Cross-session resume — warm registry is in-conversation only; sub-issue body + comment history feed the fresh cardinal full state. |
| 7 | Receive phase-report — verify `## Time spent` (mandatory in sub-issue mode); missing → one-line advisory + consume. |
| 8 | Close on `Status: Done` (`gh issue comment <M>` + `gh issue close <M> --reason completed`). Stop-state → progress comment only; stays open. |
| 9 | Edit parent `<!-- ginee:dispatch-map -->` sticky in place — append row + refresh rollup; doc-authoring self-lint. |

### Common failure modes — sub-issue mode

| Pattern | Correct shape |
|---|---|
| **In-context dispatch despite sub-issue mode active.** Parent has no sub-issue trail; cross-session resume can't reconstruct. | Create sub-issue BEFORE the cardinal dispatch; never defer the create call. |
| **Sub-issue body edited mid-flight to "fix" scope.** Audit trail destroyed. | Close existing (reason `not_planned` / `completed`); open new sub-issue with corrected scope — append-only. |
| **Assignee ignored.** Human + cardinal collide; cardinal PR clobbers human work. | Suspend dispatch when assignee non-empty; resume only on clear. |
| **Stop-state closes the sub-issue.** Resume protocol breaks. | Stop-state → progress comment only; close fires on `Status: Done` (or `Blocked` / `Hand-off`). |
| **Skill-runner-injected tracking-mode posture absorbed.** Team-lead copies upstream "set in-context" into Phase 1 "Forbidden this cycle"; sub-issues skipped despite default. | **Discard any upstream tracking-mode posture.** Re-derive via closed 4-tier chain every parent dispatch: `notrack:` → `ginee:track:off` label → `dispatch.tracking` config → framework default (`sub-issues` on `github.repo`). Runtime conditions (deferred commits · worktree · no-PR) are orthogonal. Only adapter degradation (no `gh` / GH MCP) demotes tier 4 to `in-context` — team-lead's decision, never inherited. |

## Review-comment dispatch

Full procedure: `core/protocols/github-integration.md § Review-comment ingestion`. Dispatch-specific concerns:

**File → role routing** per `local/bindings.md § Source-of-truth ownership`: read `path:line` from `gh api .../pulls/{N}/comments` → bindings lookup. Unique → dispatch owner. No match → fallback `team-lead` (re-routable). Ambiguous → surface-closest (visual ↔ frontend · data ↔ backend · IaC ↔ devops); record rationale.

**Tracks:**

| Track | Output | Notes |
|---|---|---|
| **fix** | Phase-6 patch (diff + test impact + verification per `core/process.md § Phase 6`) | One patch may bundle ≥ 1 remark in same file/area. |
| **reply** | Reply text + `<!-- ginee:review-reply r=<thread-id> -->` marker | Specialist authors wording; team-lead never paraphrases. |

Mixed-track per specialist allowed — marker is per-thread.

**Reconciliation:** squash fix-track patches into one cycle commit + push · post reply-track via `gh api .../comments/{thread-id}/replies` · verify lossless coverage (every plan-table thread → marker OR fix-touched · gap → re-dispatch · never silently close) · post one sticky cycle summary per `core/templates/pr-comment-cadence.md`.

**Auto-mode pause.** Plan-table approval is a forced-interactive trigger — push + reply on external PR is "destructive / external". Build plan → pause → surface → resume on explicit approval. Never auto-approve regardless of `auto:` or remark size.

## Delivery modes

Full procedure: `core/protocols/delivery-modes.md`. Kernel summary: `team-lead.md § Delivery mode`.

### Phase 3 — resolve + report

Stop at first match: prefix (`branch:` / `wt:` / `commit:`) → `local/framework.config.yaml § delivery.default-mode` → framework default (`branch` for issue/TODO-sourced, `wt` for freeform).

Report patterns at Phase 3:

- Resolved via prefix: `Delivery mode: branch+PR (per "branch:" prefix). Continuing.`
- Resolved via config: `Delivery mode: branch+PR (per delivery.default-mode). Override? Reply branch: / wt: / commit:.`
- Framework default applied: same format with "framework default for issue-sourced tasks".
- Unresolved freeform: ask Mode 1 / 2 / 3; wait for explicit answer.

### Per-mode dispatch

| Mode | Phase 4 start | Phase 4 per batch | Phase 8 |
|---|---|---|---|
| **1 (branch + PR)** | Compute slug; issue-sourced uses `gh issue develop <N> --name <slug> --checkout` (links to issue); TODO/freeform uses `git checkout -b <slug>`. Confirm. | Standard commits. | `git push -u origin <branch>` → `gh pr create` body from `core/templates/pr-description.md` + `Closes #<N>` (issue-sourced). |
| **2 (working-tree)** | No branch switch. | No `git add`/`commit`/`push`. | Surface `git status` + `git diff --stat`; user picks keep / discard / escalate. |
| **3 (commit-no-push)** | Stay on current branch. | Standard commits. | Surface `git log --oneline -<N>`; user pushes manually. |

### Forbiddens

- Never act outside the resolved mode (Mode-2 commits, Mode-3 pushes, Mode-2/3 branch switches).
- Never auto-pick Mode 3 on `main`/`master`/`trunk` of multi-contributor repo — recommend Mode 1.
- Never silently re-resolve mid-task.
