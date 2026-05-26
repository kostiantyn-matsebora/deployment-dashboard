---
audience: team-lead-only
load: on-demand
triggers: [ginee:value-prompt, ginee:complexity-estimate, ginee:score-recompute, audit comment, audit trail]
cap-bytes: 6144
reads-before-applying: [core/protocols/triage-scoring.md, core/protocols/github-integration.md]
---

# Audit-comment schema

Loaded when team-lead / skill-runner posts an immutable audit comment — pickup value-prompt response · SA complexity auto-estimate · sticky-score recompute.

Trigger taxonomy + behavioural rules: `core/protocols/triage-scoring.md § Immutable audit comments`. This file binds **shape** across all types.

## Schema

One audit per key event. Append-only; alongside sticky `ginee:score` per `score-comment-schema.md`. **Never edited; never deleted.**

| Element | Required | Source |
|---|---|---|
| Marker line `<!-- ginee:<type> <key=value …> -->` | yes | First line; one of registered types below. |
| Bolded outcome line | yes | `**<outcome>:** <one-line>` |
| Body — one paragraph | yes | Context · cite source rule · digest of inputs |
| Cite footer | yes | `Per <core/protocols/...md § ...section>.` |

## Registered types (closed registry)

| Type | Marker | Body |
|---|---|---|
| **value-prompt** | `<!-- ginee:value-prompt by=<@handle> value=<H\|M\|L> at=<ISO> -->` | One-line outcome (`user set value=high during pickup of #N`) + cite `triage-scoring.md § Auto-estimation on pickup`. |
| **complexity-estimate** | `<!-- ginee:complexity-estimate by=solution-architect value=<H\|M\|L> at=<ISO> -->` | SA signal digest (`<N> files · <M> roles · <pattern-reuse> → <H\|M\|L>`) + cite `triage-scoring.md § Auto-estimation on pickup`. |
| **score-recompute** | `<!-- ginee:score-recompute by=<@handle> at=<ISO> -->` | Reason + delta from previous sticky + cite `triage-scoring.md § Score comment + audit trail`. |

Adding a new type = team-lead proposes a row addition (Phase 2 design surface); marker follows existing `ginee:<type> <key=value …>` shape.

## Templates

```
<!-- ginee:value-prompt by=<@handle> value=<H|M|L> at=<ISO> -->
**Value set by reporter:** <High|Medium|Low>

Pick-up flow — reporter-defined value score per `core/protocols/triage-scoring.md`.
<follow-up: "SA complexity estimate follows." OR "Complexity already set; sticky refresh follows.">
```

```
<!-- ginee:complexity-estimate by=solution-architect value=<H|M|L> at=<ISO> -->
**Complexity auto-estimate: <High|Medium|Low>** — by `@solution-architect`

<N> files · <M> roles · <pattern-reuse note> · <code/no-code note> → <H|M|L>.
<one-line rationale on dominant signal.>

Per `core/protocols/triage-scoring.md § Auto-estimation on pickup`.
```

```
<!-- ginee:score-recompute by=<@handle> at=<ISO> -->
**Sticky score recomputed.**

<reason>. Delta vs previous sticky: <axis>: <old> → <new>.

Per `core/protocols/triage-scoring.md § Score comment + audit trail`.
```

## Forbidden patterns

1. **Editing / deleting a posted audit comment** — immutable.
2. **Audit for user-driven `gh issue edit` changes** — GitHub activity log records it.
3. **Mixing two events in one comment** — one event = one comment; correlate via `at=<ISO>`.
4. **Free-text marker drift** — must match registered form byte-for-byte.
5. **Adopter-secret data** — same rule as `score-comment-schema.md § Forbidden`.

## Worked example

```
<!-- ginee:complexity-estimate by=solution-architect value=M at=2026-05-25T18:20:01Z -->
**Complexity auto-estimate: Medium** — by `@solution-architect`

13 files · 3 roles · 5-section phase-report pattern reuse · 4-of-5 specs consolidate scattered text · no code/validator → M.
File-count leans high, but the *kind* of work is established-pattern doc authoring with heavy consolidation.

Per `core/protocols/triage-scoring.md § Auto-estimation on pickup`.
```

## Self-lint — every comment, before posting

1. Marker = literal registered form; `key=value` pairs match type's contract.
2. Bolded outcome line; one line; verb-first or label-first.
3. Body paragraph cites source rule by `core/protocols/...md § ...section`.
4. No marker-form drift — adding a new audit type requires adding the registry row first.
5. No adopter-secret data — issue body + labels + SA signals only.

Last line: `<!-- self-lint: pass -->`.

<!-- self-lint: pass -->
