---
audience: team-lead-only
load: on-demand
triggers: [dispatch prompt, dispatch contract, specialist dispatch, dispatch payload]
cap-bytes: 6144
reads-before-applying: [core/process/dispatch.md, core/templates/phase-report.md]
---

# Dispatch-prompt schema

Loaded when team-lead drafts a specialist dispatch payload — Phase 1–8 cardinal · sub-issue · review-cycle · skill-runner first-batch.

Sister schema to `core/templates/phase-report.md` (return surface). Same machinery — cardinality · templates · forbidden · self-lint.

## Schema

| Section | Cardinality | Shape |
|---|---|---|
| `## Reading list` | required (else `(none)`) | Bullets — `<path> — <what the specialist needs>` |
| `## Task` | required | One paragraph — verb-first; ≤ 4 sentences |
| `## Read discipline` | required | One paragraph citing `core/protocols/index-protocol.md § Read order` |
| `## Deliverable` | required | Bullets — `<id> — <one-line>`; ≤ 80 chars |
| `## Required output` | required | One line citing `core/templates/phase-report.md` + per-task addenda |
| `## Forbidden` | optional | Per-task forbidden ops; cite source rule |
| `## Capability-tool hints` | optional | Per-tool one-liner per `core/process/dispatch.md § Host capability-tool affinity injection` |
| `## Carry-forward` | optional | Single-line reminder per `phase-report.md § Carry-forward rephrasing` |

## Templates

```
## Reading list
- core/protocols/<spec>.md — <what the specialist needs>
- local/index/<entry>.yaml — <which entries cover the task surface>

## Read discipline
Index-first per core/protocols/index-protocol.md § Read order. Raw source reads
require one-line justification per core/templates/phase-report.md § Source reads
(this dispatch).

## Required output
Phase-report schema per core/templates/phase-report.md. <addenda — e.g. "sub-issue
mode: include ## Time spent">. End with <!-- self-lint: pass -->.

## Carry-forward                                    (optional — on prior violation)
Return format: schema-bound per core/templates/phase-report.md;
last cycle's return missed self-lint (<violation>) — apply the 6 checks + marker this cycle.
```

## Forbidden patterns

1. **Narrative preamble** ("Please go look at X, then think about Y…") → `## Task` paragraph directly.
2. **Restated framework rules** — cite by location; never paste rule body.
3. **Free-text `## Read discipline`** ("skim affected paths" · "read relevant files" · "explore the codebase") per `core/process/dispatch.md § Index-first read discipline in dispatch payload`.
4. **Mixed surfaces in `## Deliverable`** crossing role boundaries → decompose into parallel dispatches per `core/process/dispatch.md § Dispatch & parallelism rules`.
5. **Skill-runner carrying tracking-mode posture · warm-vs-fresh · routing reconciliation** per `core/process/dispatch.md § Skill-runner — surface boundary`.

## Worked example

```
## Reading list
- core/protocols/triage-scoring.md — H/M/L scale + WSJF formula
- local/index/repo-map.idx — files touching pickup flow

## Task
Auto-estimate complexity for issue #131 per the auto-estimation hook on pickup;
return H/M/L with one-line signal digest.

## Read discipline
Index-first per core/protocols/index-protocol.md § Read order. Raw source reads
require one-line justification per core/templates/phase-report.md § Source reads
(this dispatch).

## Deliverable
- complexity-estimate — H/M/L + one-line signal digest for the sticky reasoning column

## Required output
Phase-report schema per core/templates/phase-report.md. End with <!-- self-lint: pass -->.

## Forbidden
- Auto-set value — cite core/protocols/triage-scoring.md § Forbidden
```

## Self-lint — pre-send gate

Team-lead authors the dispatch + runs the gate before sending. Different machinery from `core/templates/phase-report.md § Orchestrator behaviour on non-compliant returns` — that surface receives another role's draft, so a one-line advisory is the proportionate response. Dispatch-prompts are the author's own draft; a non-compliant draft MUST restructure inline before sending.

1. No paragraph contains > 2 rules (sentence terminators).
2. Inventories are tables / bullets, not prose.
3. Reading-list entries cite a path; MUST NOT restate the rule.
4. `## Read discipline` cites `core/protocols/index-protocol.md § Read order` verbatim.
5. No narrative preamble — first non-header line is a `##` section header.

**Pre-send gate:**

- All 5 checks pass + marker present → send.
- Any check fails OR marker absent → restructure inline; re-run gate; MUST NOT dispatch a non-compliant payload.
- No carry-forward mechanism (no prior author to carry the rule to). The author is the orchestrator; the fix is the author's own pre-send restructure.
- Pre-send-restructure count surfaces in the orchestrator's user-response per `core/templates/user-response.md § Synthesis from phase-report returns` — `## Notes` line: `Dispatch pre-send restructures this turn: <N>.` Tracking signal; MUST NOT auto-disable the gate.

Last line: `<!-- self-lint: pass -->`.

<!-- self-lint: pass -->
