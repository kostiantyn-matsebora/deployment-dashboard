---
description: Compose a dispatch-prompt-schema payload skeleton for the named cardinal + task. Forces team-lead to fill a schema-bound shape instead of free-form prose.
argument-hint: <role> <task description>
---

Author a dispatch payload for `$1` per `core/protocols/dispatch-prompt-schema.md` — fill every required section; cite by location (never paste rule bodies); end with the self-lint marker.

Task: $ARGUMENTS

Skeleton to fill in:

```
## Reading list
- <path> — <what the specialist needs>

## Task
<verb-first; ≤ 4 sentences>

## Read discipline
Index-first per core/protocols/index-protocol.md § Read order. Raw source reads require one-line justification per core/templates/phase-report.md § Source reads (this dispatch).

## Deliverable
- <id> — <one-line ≤ 80 chars>

## Required output
Phase-report schema per core/templates/phase-report.md. End with <!-- self-lint: pass -->.

## Forbidden                                         (optional — per-task)
- <op> — <cite source rule>

## Capability-tool hints                             (optional — when adapter exposes)
- <tool> — <one-line invocation hint>

## Carry-forward                                     (optional — prior violation)
Return format: schema-bound per core/templates/phase-report.md; last cycle's return missed self-lint (<violation>) — apply the 7 checks + marker this cycle.
```

Self-lint before sending — 5 checks per `core/protocols/dispatch-prompt-schema.md § Self-lint`. End with `<!-- self-lint: pass -->`.
