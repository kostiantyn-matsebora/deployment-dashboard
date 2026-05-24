# Migration — D32: Claude adapter subagent dispatch — accept-orchestrated execution

**Target release:** next minor after 2026-05-23.
**Affected adopters:** Claude Code adapter only — opt-in adapter-specific carve-out; no breaking change.

## What changed

D32 narrows the D28 skill-runner / team-lead surface boundary **on the Claude Code adapter** to accommodate Claude Code's tool-inheritance model: **subagents do not receive the `Agent` / `Task` tool** in their inherited tool surface. The top-level session can spawn subagents, but spawned subagents cannot fan out further.

Pre-D32 the framework assumed every adapter could dispatch from inside a subagent (D28 hand-back rule: skill-runner dispatches `@team-lead`, team-lead then dispatches specialists). On Claude Code that second-hop dispatch silently fails — team-lead-as-subagent has no `Agent` tool and degrades to "answer from its own context."

D32 fixes the regression structurally by splitting **decision authority** (stays with team-lead) from **mechanical dispatch execution** (moves to the skill-runner on Claude only):

| Step | Pre-D32 (every adapter) | Post-D32 — Claude Code only |
|---|---|---|
| Plan drafting | team-lead (dispatched once) | team-lead (dispatched once per cycle — re-invoked) |
| User approval of plan | user | user (unchanged) |
| Mechanical dispatch of approved specialists | team-lead | **skill-runner** (verbatim execution of team-lead's approved contract surface) |
| Collecting specialist returns | team-lead | **skill-runner** (passes through; no synthesis) |
| Synthesis of returns | team-lead | team-lead (re-invoked) |
| Next-decision authoring | team-lead | team-lead (re-invoked) |
| Gate text · routing reconciliation · default selection | team-lead | team-lead (unchanged — re-invoked) |

The cycle on Claude becomes: `skill-runner mechanical batch → @team-lead (plan) → user approve → skill-runner (mechanical dispatch verbatim) → skill-runner collect returns → @team-lead (synthesis + next decision) → loop`.

## Why a Claude-specific carve-out and not a framework-wide change

- Other adapters (Cursor · Copilot CLI · Codex · generic) either run the whole lifecycle in a single LLM impersonation OR provide tool inheritance to subagents — D28 as written remains correct on those surfaces.
- A framework-wide rewrite would inflate every adapter's surface boundary to handle a limitation only one adapter has.
- The vendor-neutral spec keeps the D28 contract; D32 documents the adapter-specific narrowing.

## Decision authority partition (Claude adapter)

| Authority | Owner | Why |
|---|---|---|
| Plan authorship (Phase 1–8 dispatch plan · routing decisions · option selection) | `team-lead` (re-invoked) | Reasoning surface; the work D28 forbids the skill-runner from doing. |
| User approval of the plan | user | Phase 3 design-review gate (or auto-mode delivery handoff per D12) — unchanged. |
| Mechanical dispatch of named specialists per the user-approved contract | skill-runner | No discretion involved; the specialist · scope · contract surface are all team-lead's verbatim output. |
| Pass-through of specialist returns to team-lead | skill-runner | No synthesis; no editing; one return → one re-invocation. |
| Synthesis + next decision | `team-lead` (re-invoked) | Reasoning surface; the orchestration loop's hinge. |

The skill-runner remains structurally banned from every D28-forbidden reasoning surface — plan drafting, synthesis, gate text, routing reconciliation, default selection, `local/bindings.md` lookup to settle routing. D32 only permits **execution** of team-lead's already-decided dispatches, not origination.

## Self-check (Claude adapter — every loop iteration)

Before any main-thread reasoning during a skill run, ask both questions:

1. **Allowed by D28?** Mechanical op in the allowed-ops row, **or** verbatim execution of a team-lead-approved dispatch contract? If yes → proceed.
2. **Decision surface?** Plan drafting · synthesis · gate text · routing reconciliation · default selection · `local/bindings.md` lookup? If yes → re-invoke `@team-lead`. No "fast" / "trivial" exception.

The carve-out applies *only* to mechanical execution of an approved contract — synthesizing returns, picking which specialist to dispatch next, drafting reply text, or answering a user routing question all remain `@team-lead` work.

## Hand-back rule (extended for Claude adapter)

Every `ginee-*` skill still dispatches `@team-lead` after its first mechanical batch (D28 hand-back rule — unchanged). On Claude, **every subsequent dispatch round also runs through team-lead first** — team-lead authors the dispatch plan; skill-runner executes; team-lead synthesizes the returns. Loop terminates when team-lead's return marks the phase complete.

## Worked example — `ginee-pick-up #87`

| Step | Surface | Action |
|---|---|---|
| 1 | skill-runner | Parse `#87`; `gh issue view 87 --comments`; fetch sub-issues; swap `ginee:ready` → `ginee:in-progress`; create branch `fix/87-claude-subagent-dispatch`. |
| 2 | skill-runner → `@team-lead` | First mechanical batch done; dispatch team-lead with parsed issue + scoring labels + branch. |
| 3 | team-lead (subagent) | Phase 1 grounding; reads `core/process.md` · `core/roles/*.md` · current `adapters/claude/install.md`. Returns Phase 2 plan: *"Dispatch `ai-engineer` for shape pass on the new migration file; dispatch `solution-architect` for architectural review of the carve-out."* |
| 4 | user | Approves plan (Phase 3 / auto-mode delivery-handoff equivalent). |
| 5 | skill-runner | **Mechanical dispatch** — calls `Agent(subagent_type: ai-engineer, prompt: <team-lead's verbatim ai-engineer contract>)` and `Agent(subagent_type: solution-architect, prompt: <team-lead's verbatim SA contract>)` in parallel (one message, two tool calls). |
| 6 | skill-runner | Collects both returns; passes them through to team-lead unmodified. |
| 7 | team-lead (re-invoked) | Synthesizes; decides next dispatch. If phase complete → returns Phase 8 delivery handoff payload. Otherwise → next plan; loop to step 4. |

## Files changed (framework upstream)

| Path | Change |
|---|---|
| `adapters/claude/install.md` | New `## Subagent dispatch limitation (D32)` section after `## How to invoke` — documents the inheritance gap + accept-orchestrated cycle + self-check. |
| `core/process.md § Skill-runner — surface boundary (D28)` | One-line adapter-aware caveat citing D32. |
| `CLAUDE.md` | D32 row in the locked-decisions table. |
| `docs/CHANGELOG.md` | D32 entry under Unreleased. |
| `core/MIGRATIONS/D32-claude-adapter-subagent-dispatch.md` | This file (NEW). |

## Action required — none (adopter-side)

**Purely additive.** No `local/` schema change. No `framework.config.yaml` additions. No installer change. The accept-orchestrated cycle is the *correct* behaviour on Claude Code — pre-D32 invocations were silently degrading; D32 makes the contract explicit.

Adopters on the Claude adapter see no behaviour change on `ginee-*` skill invocations beyond the silent degradation now visibly running the documented loop. Adopters on other adapters are unaffected.

## Backward compatibility

- Skill activation phrasings unchanged.
- Skill outputs unchanged on the happy path.
- D28 surface boundary unchanged for non-Claude adapters.
- D28 hand-back rule unchanged (still fires after first mechanical batch).
- No new commands; no per-task prefixes.
- No `local/framework.config.yaml` keys.

## Rollback

Not recommended. The carve-out documents an existing degradation; reverting reinstates the silent failure mode where team-lead-as-subagent cannot dispatch on the Claude adapter.

To revert:

1. Remove the `## Subagent dispatch limitation (D32)` section from `adapters/claude/install.md`.
2. Remove the D32 caveat from `core/process.md § Skill-runner — surface boundary`.
3. Remove the D32 row from `CLAUDE.md`.

The framework continues to function on non-Claude adapters; the Claude adapter returns to silent dispatch degradation under the D28 hand-back contract.

## Issue reference

Closes [#87](https://github.com/kostiantyn-matsebora/ginee/issues/87) — *"[Framework Bug] Claude Code adapter: subagents lack Agent primitive — team-lead can't fan out to specialists."*
