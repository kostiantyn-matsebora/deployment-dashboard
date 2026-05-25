# Solution Architect — Details

Companion to `core/roles/solution-architect.md`. Elaborations only; kernel rules are binding.

**Note:** CR template moved to `team-lead.details.md § CR template` — CRs are coordination decisions, not architectural ones. SA reviews CRs for architectural coherence per `core/doc-roles.md § SA architectural-coherence review` but does NOT author them.

## Doc-ownership redistribution table

Moved from `solution-architect.md § What you own` for context-economy. Kernel keeps the bulleted summary; this is the full table.

| Doc class | New owner |
|---|---|
| CRs (requirement-change records) | `team-lead` |
| Project-instruction file | `team-lead` |
| Work-breakdown doc | `team-lead` |
| CI/CD guide · infra runbooks | `devops-engineer` |
| Backend READMEs · API docs · service docs | `backend-engineer` |
| Frontend READMEs · component docs | `frontend-engineer` |
| Test plans · scenario docs · QA reports | `qa-engineer` |
| Mockup | mockup-owning role (unchanged) |

Each role's doc edits are SA-reviewed for architectural coherence on PRs that touch SA-owned files per the Review activity in the kernel.

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

## Architectural-change review flow

Two routing paths depending on what the engineer is proposing:

### Path A — Architectural delta (SA's authority)

Engineer proposes a contract / topology / stack / NFR-affecting change. Procedure:

1. Read the relevant section(s) in full + the engineer's proposal.
2. Apply § Review verdict — APPROVE / REJECT / REQUEST-CHANGES.
3. On APPROVE:
   - Author the ADR (or amend the architecture doc if not yet finalized) with explicit citations to the FR / NFR / ASR being addressed.
   - List downstream dispatches required (example: *"wire-shape revision affects service + client + qa"*).
4. SA never edits the engineer's code; engineer implements after APPROVE.

### Path B — Requirements / scope delta (team-lead's authority)

Engineer proposes adding / modifying / retiring an FR / NFR / Constraint. Procedure:

1. Engineer flags it in their final report.
2. `team-lead` drafts a CR per `team-lead.details.md § CR template` and lands it in `<cr-directory>`.
3. SA reviews the CR for architectural coherence (does the requirement change have hidden architectural implications? — new ASR? new ADR needed?).
4. SA APPROVE → CR moves to `Accepted`; SA updates `local/requirements.md` and (if scope warrants) `local/asr-utility-tree.md` + a new ADR.
5. SA REJECT / REQUEST-CHANGES → team-lead iterates CR.

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
