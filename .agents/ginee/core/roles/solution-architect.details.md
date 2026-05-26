---
audience: solution-architect
load: on-demand
triggers: [sa-details, atam, asr, sad, adr, cr, governance]
cap-bytes: 8192
reads-before-applying: []
---

# Solution Architect — Details

Companion to `core/roles/solution-architect.md`. Elaborations only; kernel rules are binding.

**Note:** CR template moved to `team-lead.details.md § CR template` — CRs are coordination decisions, not architectural ones. SA reviews CRs for architectural coherence per `core/protocols/doc-roles.md § SA architectural-coherence review` but does NOT author them.

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

## ADR-gate

Companion to `solution-architect.md § ADR-gate`. Kernel carries the 6-branch table + delta triggers + SA-judgment cases; this section carries the non-trivial heuristic + skip-reason enum + phase-report logging shape.

**Non-trivial heuristic.** Fires when EITHER:

- Proposal touches ≥ 2 architectural-delta triggers (per kernel § ADR-gate trigger list), OR
- `local/requirements.md` register-diff is non-empty (any FR / NFR / Constraint added · modified · retired in the current task).

Below-threshold proposals (single trigger AND empty register-diff) stay silent unless `prompt-before-create: always`.

**Skip-reason enum.** Logged under `## Decisions made` in the phase-report when the gate skips authorship:

| Value | Trigger |
|---|---|
| `config-disabled` | `change-governance.adr.enabled: false` |
| `no-architectural-delta` | `require-architectural-delta: true` AND no delta trigger fires |
| `prefix-override` | Task prefix `noadr:` |
| `user-declined` | Forced-interactive prompt; user declined |

**Logging shape.** One row under `## Decisions made` — `ADR skipped — skip-reason: <value>`. Forced-interactive outcome — `ADR authored — user yes` (gate authored) or `ADR declined — user no` with `skip-reason: user-declined`.

## Architectural-change review flow

Two routing paths:

**Path A — Architectural delta (SA's authority).** Engineer proposes contract / topology / stack / NFR-affecting change:

1. Read relevant section(s) + proposal.
2. Apply § Review verdict — APPROVE / REJECT / REQUEST-CHANGES.
3. APPROVE → author ADR (or amend architecture doc if not finalized) citing FR / NFR / ASR. List downstream dispatches (e.g. *"wire-shape revision affects service + client + qa"*).
4. SA never edits engineer's code; engineer implements after APPROVE.

**Path B — Requirements / scope delta (team-lead's authority).** Engineer proposes adding / modifying / retiring FR / NFR / Constraint:

1. Engineer flags in final report.
2. team-lead drafts CR per `team-lead.details.md § CR template` → `<cr-directory>`.
3. SA reviews CR for architectural coherence (new ASR? new ADR needed?).
4. APPROVE → CR `Accepted`; SA updates `local/requirements.md` + (if scope warrants) `asr-utility-tree.md` + new ADR.
5. REJECT / REQUEST-CHANGES → team-lead iterates CR.

## Conflict-resolution examples

| Conflict | Resolution | Who edits |
|---|---|---|
| Mockup shows hover behaviour architecture doc doesn't describe | Mockup wins. Add to architecture doc IF behaviour has data/contract implications; otherwise doc stays silent. | SA (doc, if needed) |
| Architecture doc defines new wire field; mockup not updated | Doc wins. Update mockup example data to include field. | Mockup owner after doc lands |
| Mockup uses status colour doc doesn't mention | Mockup wins. Doc makes no claim about colours. | No edit needed |
| Doc changes API path; mockup has stale path in screenshot | Doc wins. Update mockup. | Mockup owner after doc lands |

## Governance review of mockup changes

Confirm: **architecture coherence** (mockup reflects current FRs · invariants — UX-responsiveness · layout · etc. · wire shape) · **invariant block mirroring** (mockup head-comment mirrors architecture-doc NFRs) · **harness compliance** (mockup-owning role's report includes PASS/FAIL from mockup-visual harness · all-green is the bar) · **no architecture-level changes smuggled** (new view · attribute · layout · invariant in mockup not in doc → stop · land doc update first · mockup owner mirrors after).

You don't edit the mockup — you confirm result meets contract.

## Engineering principles

- **Declarative over imperative** per `core/process.md § Configuration vs. data` — reject doc updates that would require violating this in code.
- **Single source of truth** — when defined twice (e.g. doc + README), prefer architecture doc; README cites the section.
- **No hidden contracts** — every cross-component item explicit in architecture doc: wire shapes · env vars · endpoints · status codes · event payloads.
