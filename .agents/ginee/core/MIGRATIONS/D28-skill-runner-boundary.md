# Migration — D28: skill-runner / team-lead surface boundary

**Target release:** next minor after 2026-05-22.
**Affected adopters:** every adopter on every adapter — opt-in; no breaking change.

## What changed

D28 locks the structural rule that prevents the skill-runner main thread from orchestrating.

**Skill-runner.** The thin mechanical surface running a `ginee-*` skill body — Claude main thread · Cursor main loop · Copilot CLI main loop · AGENTS.md-driven shell. Not a role. Not an orchestrator. Carries only the operations the skill text spells out.

Pre-D28 the framework's role definitions assigned orchestration to `team-lead` but no spec named the skill-runner as a distinct surface or banned it from making orchestration decisions. The slip recurred across long sessions (issue #71): the skill-runner authored Phase 1–8 plans itself, synthesized parallel specialist returns, answered routing-governance questions by reading `local/bindings.md` directly, proposed reconciliation options with default-selection ("I'll pick option 1 if you don't redirect").

D28 fixes this structurally — every `ginee-*` skill dispatches `@team-lead` after its first mechanical batch. From there every orchestration decision flows through team-lead.

## Allowed vs forbidden

| Surface | Pre-D28 | Post-D28 |
|---|---|---|
| Parse prompt + identify task source | skill-runner | skill-runner (mechanical) |
| Label / sticky / audit-comment ops | skill-runner | skill-runner (mechanical) |
| Branch ops per resolved delivery mode | skill-runner | skill-runner (mechanical) |
| First-batch dispatch named in the skill text | skill-runner | skill-runner (one allowed dispatch) |
| Plan drafting (Phase 1–8 dispatch plan) | implicit skill-runner | **`team-lead` (dispatched)** |
| Synthesis of parallel specialist returns | implicit skill-runner | **`team-lead` (dispatched)** |
| Lifecycle gate text (Phase 3 / 7 / 8 prompts) | implicit skill-runner | **`team-lead` (dispatched)** |
| Re-dispatch after the first batch | implicit skill-runner | **`team-lead` (dispatched)** |
| Routing reconciliation on engineer pushback | implicit skill-runner | **`team-lead` (dispatched)** |
| Default selection ("I'll pick option 1") | implicit skill-runner | **`team-lead` (dispatched)** |
| `local/bindings.md` lookup to settle routing | implicit skill-runner | **`team-lead` (dispatched)** |

## Worked counter-example — issue #71

A `/ginee-pick-up #46` invocation slipped the boundary:

| Step | Skill-runner did | Should have |
|---|---|---|
| 1. Parse + label swap + sticky post | OK — mechanical ops | OK |
| 2. First dispatch | Sent **its own** Phase 1–8 plan + dispatched three specialists in parallel directly | Dispatched `@team-lead` with the parsed issue + scoring labels; team-lead drafts the plan |
| 3. User: "who owns the API contract?" | Read `local/bindings.md` + reasoned about tie-breaker in main thread | Dispatched `@team-lead`; team-lead reads bindings and answers |
| 4. Specialists return | Synthesized three memos in main thread | Dispatched `@team-lead`; team-lead synthesizes |
| 5. User: "your plan misroutes the contract" | Proposed two reconciliation options + a default ("Default if you don't redirect: option 1") | Dispatched `@team-lead`; team-lead reconciles, surfaces verdict |
| 6. User pushback again | Finally dispatched `@team-lead` | Same dispatch should have fired at step 2 |

The slip recurred across long sessions and burned user attention twice before correction. The fix is structural: every skill explicitly hands off after the first mechanical batch.

## Files changed (framework upstream)

| Path | Change |
|---|---|
| `core/process.md` | New top-level `## Skill-runner — surface boundary (D28)` section above `## Dispatch & parallelism rules` |
| `core/roles/team-lead.md` | New `Inbound trigger surfaces` section listing four sources including skill-runner hand-back |
| `core/roles/team-lead.details.md § Common failure modes` | New row D28 |
| `core/skills/ginee-pick-up/SKILL.md` | New Step 3 "hand to team-lead"; skill-runner-forbiddens entry |
| `core/skills/ginee-address-review/SKILL.md` | Step 3 "hand to team-lead"; skill-runner-forbiddens entry |
| `core/skills/ginee-triage/SKILL.md` | New Step 6 hand-off; skill-runner-forbiddens entry |
| `core/skills/ginee-promote-discussion/SKILL.md` | Step 4 "hand to team-lead"; skill-runner-forbiddens entry |
| `core/github-integration.md § Inbound — pick up an issue` | Re-narrated with mechanical/team-lead prefixes per step |
| `PLAN.md` · `CLAUDE.md` | D28 row |
| `docs/CONCEPTS.md` · `docs/CHANGELOG.md` | D28 entries |
| `core/MIGRATIONS/D28-skill-runner-boundary.md` | This file (NEW) |

## Action required — none (adopter-side)

**Purely additive.** No `local/` schema change. No new commands. No adapter re-install. Existing skill invocations continue working; the boundary surfaces only when the skill-runner is about to orchestrate, at which point it dispatches `@team-lead` instead of in-thread reasoning.

Adopters on pre-D28 framework versions will see the same outputs from `ginee-pick-up` / `ginee-address-review` / `ginee-triage` / `ginee-promote-discussion` for well-behaved invocations; only the regression path (skill-runner drifting into orchestration) is now structurally forbidden.

## Backward compatibility

- Skill activation phrasings unchanged.
- Skill outputs unchanged on the happy path.
- Specialist dispatch graph unchanged in shape — only the **author** of each dispatch (after the first) shifts from skill-runner to `team-lead`.
- No `framework.config.yaml` additions.

## Rollback

Not recommended. The boundary closes a regression-grade slip that recurs in long sessions. To revert:

1. Remove `core/process.md § Skill-runner — surface boundary`.
2. Remove the hand-to-team-lead steps from the four skill files.
3. Remove the `Inbound trigger surfaces` section from `core/roles/team-lead.md`.
4. Remove the D28 row from `team-lead.details.md § Common failure modes`.

The framework still functions but the regression path returns.

## Issue reference

Closes [#71](https://github.com/kostiantyn-matsebora/ginee/issues/71) — *"Framework Bug: Skill-runner main thread acts as orchestrator — bypasses team-lead for synthesis + lifecycle gates."*
