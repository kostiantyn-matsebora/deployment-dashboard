# Migration — team-lead strict-domain hardening (issue #50)

**Target release:** next minor after 2026-05-20.
**Affected adopters:** none — clarifications to existing rules; no config, API, or behaviour change for adopter projects.

## What changed

Clarification of the strict-domain rule (D1) and the orchestrator role contract (D5) after an observed regression in this repo: `team-lead` self-executed specialist-owned work on a "feels fast" heuristic, bypassing the strict-domain rule, dispatch-first rule, and estimation-first contract. The fix tightens the kernel + iteration-protocol wording so the failure mode is named and blockable.

Affected files:

- `core/roles/team-lead.md § Forbidden actions` — new bullet: "Never self-execute work in a specialist-owned surface, regardless of estimated size." Includes a "size is not an exemption" clause and the correct dispatch shape for ≤ 15 min work (explicit estimate flag → iteration-protocol load skipped).
- `core/process.md § Dispatch & parallelism rules` — new table row: "Surface owns the dispatch decision" — routing is owned by the touched surface, not by estimated task size.
- `core/process.md § Strict-domain rule` — two sub-bullets appended: "Size is not an exemption" + pointer to the failure-modes catalogue in `team-lead.details.md`.
- `core/protocols/iteration-protocol.md § Stoppable intermediate states` — new sub-section `### Scope-overrun trigger`: > 2× initial estimate → mandatory stop-and-report. Trigger applies symmetrically to specialists and to orchestrator in-thread work.
- `core/roles/team-lead.details.md § Common failure modes` — NEW section (added in iteration 2 of #50): regression-grade catalogue of observed orchestrator violations + self-check shape.

## Why

Observed regression — orchestrator self-executed specialist-owned work on a "feels fast" heuristic. 5–7 min estimates ballooned to ~60 min main-thread sessions with no stop-and-report. The strict-domain rule, dispatch-first rule, and estimation-first contract were all silently bypassed. The kernel wording lacked an explicit "size is not an exemption" guardrail and the iteration protocol lacked a scope-overrun stop trigger; both gaps are now closed.

## Adopter action

None required. Clarifications to existing rules; no config, API, or surface change. The new dispatch-rules row + new strict-domain sub-bullets + new iteration-protocol sub-section are all additive — pre-existing rows / bullets / sub-sections remain intact.

## Behavioural change to expect

- Orchestrator no longer rationalises in-thread edits to specialist-owned surfaces with "this is small / fast". The surface owns the routing decision.
- ≤ 15 min specialist work is dispatched with an explicit estimate flag, which keeps `core/protocols/iteration-protocol.md` unloaded for short tasks.
- Specialists and orchestrator both stop-and-report at the next iteration boundary when apparent scope exceeds the initial estimate by > 2× — never continue silently.

## Backward compatibility

Fully backward-compatible. No removed rules, no renamed sections, no changed defaults. Existing dispatches conforming to the strict-domain rule remain valid; only the previously-implicit "size is not an exemption" sub-rule is now explicit.

## Rollback

Revert the touched files to their pre-change state:

- `core/roles/team-lead.md`
- `core/process.md`
- `core/protocols/iteration-protocol.md`
- `core/roles/team-lead.details.md` (iteration 2 added the `§ Common failure modes` section)

No data migration, no adopter cleanup.

## Cross-references preserved

- D1 — strict-domain rule (`core/process.md § Strict-domain rule`).
- D5 — cardinal roles (`core/roles/team-lead.md`).
- Iteration-protocol load triggers (`core/process.md § Iteration protocol` + `core/protocols/iteration-protocol.md` preamble).
- `local/bindings.md § Project role boundaries` (adopter-owned forbidden-crossings table).

## Issue reference

Implemented per [issue #50](https://github.com/kostiantyn-matsebora/ginee/issues/50) — `team-lead orchestrator violates strict-domain + dispatch-first when work "feels fast"`.
