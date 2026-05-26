---
audience: team-lead-only
load: on-demand
triggers: [ginee:score, sticky score comment, recompute score, triage score sticky]
cap-bytes: 6144
reads-before-applying: [core/protocols/triage-scoring.md]
---

# Score-comment schema

Loaded when team-lead posts / refreshes the sticky `ginee:score` comment — pickup · `recompute score #<N>` · any ginee-driven label change.

Rules (axes · formula · triggers · forbidden): `core/protocols/triage-scoring.md § Score comment + audit trail`. This file binds **shape**.

## Schema

One sticky per issue. Idempotent via marker. **Refresh in place; never duplicate.**

| Element | Required | Source |
|---|---|---|
| Header marker `<!-- ginee:score v=1 -->` | yes | Fixed; first line; case-sensitive |
| `## Triage score: <combo> = <number>` | yes | `<combo>` = `<value-letter><complexity-letter>` (unscored → `—`); `<number>` per formula |
| Axes table — 5 columns | yes | `Axis · Label · Numeric · Set by · Reasoning` |
| Formula line | yes | `Formula: <formula> (<scoring-formula key>)` |
| Last-updated line | yes | `Last updated: <ISO 8601 UTC> by ginee team-lead` |
| Recompute note | yes | One line citing `ginee-triage` re-derivation from labels |

## Template

```
<!-- ginee:score v=1 -->
## Triage score: <combo> = <number>

| Axis | Label | Numeric | Set by | Reasoning |
|---|---|---|---|---|
| value | `<high|medium|low|unscored>` | <3|2|1|—> | <@handle (source)> | <one-line | —> |
| complexity | `<high|medium|low|unscored>` | <3|2|1|—> | <@handle (source)> | <one-line | —> |

- Formula: `<formula>` (`<scoring-formula key>`)
- Last updated: <ISO 8601 UTC> by ginee team-lead
- Recomputed live by `ginee-triage` from labels — see audit trail below.
```

**`Reasoning` column** — most-recent change ginee auto-estimate → one-line digest (`1 file · 1 role · pattern reuse → L`); user-set (reporter / manual edit) → `—`; axis not set → `unscored`.

**`Set by` values** — user-set: `@<handle> (reporter | manual edit)`; SA complexity: `@solution-architect (auto-estimate)`; team-lead imputed c=L: `@team-lead (imputed c=L)`; user reply to ginee prompt: `@<handle> (user reply to ginee prompt)`.

## Forbidden patterns

1. **Multiple stickies per issue** — always update via marker.
2. **Editing / deleting an immutable audit comment** per `audit-comment-schema.md`.
3. **Auto-detecting manual `gh issue edit` between sessions** — user invokes `recompute score #N`.
4. **Adopter-secret data** — issue body / labels only; no local paths · SHA fingerprints · PII.
5. **Numeric out of bounds** per `triage-scoring.md § Score formula`; unscored → `0`.

## Worked example

```
<!-- ginee:score v=1 -->
## Triage score: HM = 1.5

| Axis | Label | Numeric | Set by | Reasoning |
|---|---|---|---|---|
| value | `high` | 3 | @kostiantyn-matsebora (reporter) | — |
| complexity | `medium` | 2 | @solution-architect (auto-estimate) | 13 files · 3 roles · pattern reuse · no code → M |

- Formula: `value / complexity` (`value-over-complexity`)
- Last updated: 2026-05-25T18:20:04Z by ginee team-lead
- Recomputed live by `ginee-triage` from labels — see audit trail below.
```

## Self-lint — before posting / updating

1. Marker = literal `<!-- ginee:score v=1 -->` on line 1.
2. `<combo>` letters match label letters (`H` / `M` / `L` / `—`); `<number>` matches resolved formula.
3. Axes table — exactly 2 data rows (`value` · `complexity`) · 5 columns.
4. `Reasoning` populated per row-state policy; empty cells use `—`, not blank.
5. No adopter-secret data.

Last line: `<!-- self-lint: pass -->`.

<!-- self-lint: pass -->
