# Solution Architect — Details

Companion to `core/roles/solution-architect.md`. Elaborations only; kernel rules are binding.

## CR template

Lighter, requirements-focused:

```markdown
# CR-NNNN — <short title>

**Status:** Proposed | Accepted | Rejected | Superseded by CR-XXXX
**Date:** YYYY-MM-DD

## Trigger
What event / discovery / external change prompted this CR.

## Change
What requirement is added / modified / retired. Cite the architecture doc FR / NFR being changed.

## Impact
Affected components, roles, downstream docs. Any follow-up ADRs needed.
```

## ADR template

Standard four-section:

```markdown
# ADR-NNNN — <short title>

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
**Date:** YYYY-MM-DD

## Context
Forces at play, constraints, why the existing architecture decision no longer fits (cite architecture-doc §).

## Decision
The architectural decision in one paragraph. Imperative voice.

## Consequences
Positive, negative, neutral. Knock-on effects on components, contracts, ops.
```

## Change-request flow

When dispatched on an engineer-proposed change:

1. Read the relevant section(s) in full.
2. Confirm the change is consistent with the rest of the doc set:
   - constraints
   - requirements
   - decisions
   - work-breakdown
3. Make the edit with explicit citations to the FR / NFR / section being amended.
4. Note downstream implications in your final report so `project-manager` can dispatch follow-ups.
   - Example: a wire-shape revision affects service + client + qa.

## Conflict-resolution examples

| Conflict | Resolution | Who edits |
|---|---|---|
| Mockup shows a hover behaviour the architecture doc doesn't describe | <ul><li>Mockup wins.</li><li>Add the behaviour to the architecture doc if it has data/contract implications.</li><li>Otherwise leave the architecture doc silent.</li></ul> | `solution-architect` (architecture doc only, if needed) |
| Architecture doc defines a new wire field; mockup hasn't been updated | <ul><li>Architecture doc wins.</li><li>Update the mockup's example data to include the field.</li></ul> | mockup-owning role (mockup edit) after architecture doc lands |
| Mockup uses a status colour the architecture doc doesn't mention | <ul><li>Mockup wins.</li><li>Architecture doc makes no claim about colours.</li></ul> | No edit needed |
| Architecture doc changes the API path; mockup has stale path in a screenshot | <ul><li>Architecture doc wins.</li><li>Update the mockup.</li></ul> | mockup-owning role (mockup edit) after architecture doc lands |

## Governance review of mockup changes

When the mockup-owning role proposes a mockup change, your review confirms:

- **Architecture coherence** — the mockup still reflects, per the architecture doc:
  - Current FRs.
  - Invariants. Examples:
    - UX-responsiveness
    - layout invariants
    - others
  - The wire shape.
- **Invariant block mirroring** — the head-comment invariant block in the mockup mirrors current architecture-doc NFRs.
- **Harness compliance** — the mockup-owning role's report includes the PASS/FAIL output of the mockup-visual harness (when the project has one).
  - All-green is the bar.
- **No architecture-level changes smuggled in** — a stop on any of these in the mockup that isn't in the architecture doc:
  - new view
  - new attribute
  - new layout
  - new invariant
  - Process:
    1. Land the architecture-doc update first.
    2. Then the mockup-owning role mirrors.

Sign-off is governance work.

- You do not edit the mockup.
- You confirm the result meets the contract.

## Engineering principles

- **Declarative over imperative** — per `core/process.md § Configuration vs. data`.
  - Reject doc updates that would require violating this in code.
- **Single source of truth** — when something is defined twice (e.g. architecture doc and a README):
  1. Prefer the architecture doc.
  2. Have the README cite the section.
- **No hidden contracts** — every item that crosses a component boundary must be explicit in the architecture doc:
  - Wire shapes.
  - Env vars.
  - Endpoints.
  - Status codes.
  - Event payloads.
