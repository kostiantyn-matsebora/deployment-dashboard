---
description: Intake & docs-first activity of .claude/team-process/process.md. Read the owning spec before any code; restate its acceptance criteria (spec = contract + regression gate). Need a code area's state to scope? Delegate the assessment to the owning role — never read code to scope it.
argument-hint: <issue number | task description>
---

# /intake

The **Intake & docs-first** activity of the orchestration process
([`.claude/team-process/process.md`](../team-process/process.md)).

0. **Resume check first.** Before scoping new work, check for an active run already on this
   issue/feature and **propose to resume it** (don't fork a parallel run): issue mode →
   `python3 scripts/hooks/invoke_team_mode_guard.py --find-session --issue <ref>`; informal ask → match against the active runs'
   `summary` in the SessionStart reminder. See [`process.md`](../team-process/process.md) →
   *Session state & resume*.

1. **Docs-first.** Read the owning spec before any code; navigate the project's docs index to the
   relevant specification. For API features, the contract artifact is the source of truth.
   - Record a one-line `summary` in the session record (the issue title or the feature's essence) —
     it shows in the statusline + resume reminder so a glance answers "what is this run".
2. **Restate acceptance criteria** from the spec — it is the **contract *and* the regression gate**.
   Store them in the session record's `acceptance` so they survive compaction and publish to the issue.
3. **Explore by delegation, not by reading.** Need broad discovery — *where the relevant code lives, how it works today, what the solution options are*?
   - **Dispatch a read-only `Explore` agent.** Its exploration loops run in its disposable context; it returns a [`RESEARCH`](../team-process/protocol.md) form (`topic` · `findings` · `options` · `refs` · `open`).
   - `Explore` can't write: persist its returned form via the normalizer; fold `findings`/`options` into the run ledger.
   - Do **not** run the exploration loops in your own context.
4. **Scope by delegation, not by reading.** Need the *state* of a code area judged against a role's bar (refactor, audit, "is X clean / what's needed", feasibility)?
   - **Delegate to the owning role**; it returns a `REVIEW`. Do **not** open the code yourself — that applies a generic / line-count proxy and pollutes the lead's context.
   - `Explore` (discovery: where/how/options) **complements** the owning-role `REVIEW` (bar judgment: does it meet the non-negotiables) — they are not interchangeable.
   - Code-cognition (`Read`/`Grep`/`Glob` over source) is **tool-blocked** for the orchestrator while a run is active — discovery + scoping MUST be delegated.
5. **Analyze by delegation, not in your head.** Need the approach *chosen* — which `RESEARCH.option` wins, is X feasible, what does the lane map imply?
   - **Delegate an `ANALYSIS`** to an analyst (owning role for in-domain judgment; a `Plan`/general agent for cross-cutting / architectural decisions); it returns `question` · `evaluated` · `recommendation` · `rationale`.
   - **Ratify** the `recommendation` — fold it into `decisions[]`; do **not** synthesize the approach in your own context.
   - `RESEARCH` = discovery, no verdict. `ANALYSIS` = evaluation → recommendation. The lead ratifies, never derives.

6. **Capture intake decisions.** Any design choice settled at intake (with the user, by ratifying an
   `ANALYSIS`, or resolving a `FINDING`) → append a `decisions[]` entry to the session record,
   `supersedes` set when it overrides the issue text. See
   [`.claude/team-process/process.md`](../team-process/process.md) → *Decision record*.

**Output:** restated acceptance criteria (in `acceptance`) + any `decisions[]` captured + (if discovery
was needed) the `Explore` agent's `RESEARCH` + (if the approach needed evaluating) the analyst's
`ANALYSIS` + (if scoping was needed) the owning role's `REVIEW`.
