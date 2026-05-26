---
name: ginee-pick-up
description: Pick up a task from any source and run it through the ginee Phase 1–8 lifecycle. Task source can be a GitHub issue (`#N`), a TODO line in any TODO file (root or nested), or a freeform description. Use when the user asks to 'pick up #N', 'work on issue N', 'pick up the TODO about X', 'start working on Y', or otherwise explicitly invokes the lifecycle on a specific task.
---

# Pick up task — unified

Single entrypoint for all task sources defined in `core/process.md § Task model`. Detects the source from the user's prompt and routes.

## Activation

User asks "pick up X" / "work on X" / "start on X" / "begin X" where X is:

- GitHub issue: `#<N>` · `issue #<N>` · `issue N`.
- TODO line: file path + line (`TODO:12`) · quoted line text · "the TODO about Y".
- Freeform: description with no issue/TODO reference.

## Procedure

### Step 1 — identify source

`#<N>` / `issue N` → GitHub issue (primary repo). TODO reference → TODO line. Otherwise → freeform.

### Step 2 — per source

**GitHub issue** per `core/protocols/github-integration.md § Inbound — pick up an issue`:

1. Fetch + parse issue · validate `OPEN` + `ready-label`.
2. Scoring labels + sticky per `core/protocols/triage-scoring.md § Score comment + audit trail` — missing `value:*` → ask user H/M/L + audit comment; missing `complexity:*` → dispatch `solution-architect` for estimate + audit comment; post/update sticky `<!-- ginee:score v=1 -->` (one per issue; never duplicate).
3. Swap `ready` → `in-progress`.
4. Run Phase 1–8 · post structured comments at transitions · close on Phase 8 with final summary + PR/commit links.

**TODO line** per `core/process.md § Task model § TODO file rules` — read line at cited path+line · parse `[v:N c:M]` marker · confirm intended task · run Phase 1–8 · flip `☐` → `☒` on acceptance.

**Freeform** — treat prompt as task description · run Phase 1–8.

### Step 2.4 — lite-mode detection (all sources)

`lite:` / `direct:` prefix elides Phase 1–3 per `core/process/dispatch.md § Per-task prefix grammar`. Skill-runner detects + records; orchestration stays team-lead's surface.

Resolution (stop at first match): prefix on task line · GitHub issue with `complexity:low` + exactly one `ginee:role:<cardinal>` + `lifecycle.lite-mode.label-trigger: true` · `lifecycle.lite-mode.default: true` · default lifecycle.

On lite resolved: hand-off carries `lifecycle: lite` + (tier 2) the role-label cardinal. Team-lead consumes the flag + skips Phase 1–3 + dispatches directly into Phase 4. CR / ADR / Phase 7 / Phase 8 gates remain.

Skill-runner never runs the architectural-delta heuristic · drafts a Phase 4 dispatch contract · proposes a cardinal in hand-off — those are team-lead's. Skill-runner records flag + named cardinal only.

### Step 2.5 — sub-issue fast-path (GitHub issue only)

Sub-issues carry the dispatch decision in labels + body per `core/protocols/github-integration.md § Sub-issue dispatch`. Skill-runner dispatches the labelled cardinal, skipping `@team-lead`.

**Detect parentage.** `gh api repos/{owner}/{repo}/issues/{N}` exposes `parent_issue`; confirm via `gh api repos/{owner}/{repo}/issues/{parent}/sub_issues`.

**Fast-path applies when ALL hold** — parent resolves · exactly one `ginee:role:<cardinal>` label · body carries dispatch contract per `core/templates/sub-issue-dispatch.md` (`## Scope` · `## Acceptance` · `## Spec links` · `## Phase` · `## Estimate`).

Parent issues unchanged — Step 3 routes them to `@team-lead`.

**Re-entry — re-load `@team-lead` when ANY trigger fires:**

| Trigger | Source |
|---|---|
| Role label missing / conflicting | pre-dispatch check |
| Cardinal return — `## Open issues` non-empty | cross-cardinal synthesis needed |
| Cardinal return — `## Hand-off` set | routing change — re-plan |
| Cardinal return — `Status: In-progress` | stop-state re-decision |
| Cross-domain bug surfaced | `core/protocols/cross-domain-bugs.md` |

Skill-runner never synthesizes a cardinal return — on trigger, dispatch `@team-lead` with the return as inbound. Same forbiddens as `core/process/dispatch.md § Skill-runner — surface boundary`.

### Step 3 — hand off

After Step 2 mechanical ops, before any Phase 1 plan drafting:

| Source shape | Target | Inbound payload |
|---|---|---|
| Parent issue · TODO · freeform | `@team-lead` | parsed body + scoring labels + label-swap + (issue) branch + (when set) `lifecycle: lite` |
| Sub-issue · fast-path gate pass | `@<cardinal>` (role label) | parsed dispatch body + scoring labels + label-swap + branch + (when set) `lifecycle: lite` |

From here orchestration (Phase 1–8 plan · routing · synthesis · gate text · re-dispatch · defaults) flows through team-lead — or under fast-path through the dispatched cardinal until any re-entry trigger fires. Skill-runner never drafts plans · reads `local/bindings.md` to settle routing · synthesizes returns · picks defaults.

### Step 4 — common lifecycle (team-lead-owned)

team-lead per `core/roles/team-lead.md` + `core/process.md` — dispatches per `local/bindings.md` · iteration protocol when scope > 15 min · gates at Phase 3 / 7 / 8.

## Forbidden

- Never pick up without identifying the source first — rules differ per source.
- GitHub issue: never edit the reporter-authored body — comments only.
- TODO: never auto-add new TODO lines (`§ TODO file rules`).
- Never silently close out — Phase 8 acceptance is always surfaced.
- Never run framework-upstream variant from an adopter project — addressing a framework issue requires working in the framework repo.
- **Skill-runner forbiddens** — after Step 3 hand-off, never draft plans · synthesize returns · answer routing/governance from project files · propose defaults · re-dispatch specialists in the main thread · set/recommend/carry tracking-mode posture (4-tier chain is closed; team-lead re-derives every parent dispatch). Every such decision dispatches `@team-lead`. Full: `core/process/dispatch.md § Skill-runner — surface boundary`.
