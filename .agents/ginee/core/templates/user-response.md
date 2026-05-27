# User-response — Schema

Binding schema for every team-lead → user surface — Phase 8 interactive approval · automatic-mode delivery handoff · mid-task user-facing reports · forced-interactive escalation surfaces. Same machinery as `core/templates/phase-report.md` (cardinal → orchestrator) and `core/protocols/dispatch-prompt-schema.md` (orchestrator → cardinal); same self-lint marker · forbidden patterns · structural lint.

Skill-runner mechanical messages use a smaller 3-line shape per `core/process/dispatch.md § Skill-runner mechanical-message shape`; this schema is for orchestration outputs.

## Section cardinality

| Section | Cardinality | Default shape | Cap |
|---|---|---|---|
| `## Result` | MUST | One line — bottom line · what's done / blocked / awaiting | 1 line |
| `## What changed` | MUST (else `(none)`) | Table — file / area · delta | 1 row per surface |
| `## Verification` | MUST (else `(none)`) | Table — command / check · outcome | 1 row per check |
| `## Next` | MUST | One line — proposed user action OR `(awaiting your direction)` | 1 line |
| `## Notes` | MAY — narrative escape hatch | Free prose | ≤ 150 words |

**No `## Verification` carve-out for "I didn't test"** — state it: `Verification: manual smoke not run (headless); run X to confirm.` MUST NOT claim PASS without the run.

## Decision-led header

- First non-blank line under each section MUST name the decision asked of the user OR the result delivered.
- `## Result` MUST read as a sentence a human can act on cold (no prior-turn context required).
- Framework-internal mechanics MUST appear inside `## Notes` only — MUST NOT appear in `## Result`.

## Forbidden patterns

1. **Wall-of-prose summary** — paragraphs > 4 lines · parenthetical comma-soup · inline inventories. Restructure into the schema sections above.
2. **Internal-jargon header** — `Bug C confirmed via Stage 1 forensic`, `iteration 2-ter complete`, `D29 carry-forward fired`. Cite the user-visible outcome; mechanics belong in `## Notes`.
3. **File paths / module names in `## Result`** — `## What changed` carries paths · `## Result` carries the decision / state.
4. **Restated dispatch context** — cite the originating task in `## Notes`; MUST NOT re-narrate it in `## Result` / `## Next`.
5. **Hidden Accept / Feedback / Reject choice** under prose — auto-mode delivery handoff MUST surface the three options as a labelled list per `core/protocols/automatic-mode.md § Delivery handoff`.

## Mandatory checks before surfacing

Same 6 as `core/process.md § Documentation style § Mandatory checks` PLUS:

7. **No narrative preamble** — first non-blank line is the `## Result` header (or `Status:` header when re-using phase-report shape).
8. **Decision-led** — every section's first line names the result · the change · the next action — not the investigation framing.

Run all 8 against the draft before surfacing. Un-restructurable narrative lifts to `## Notes` (≤ 150 words). Sentence + section taxonomy is the spine; prose is the escape hatch.

## Marker

Append literal `<!-- self-lint: pass -->` as the LAST line (fixed form · case-sensitive). Same attestation as `core/templates/phase-report.md § Marker`. Without marker the 8 checks are aspirational.

## Synthesis from phase-report returns

Team-lead synthesizes one user-response from N cardinal phase-reports per turn; MUST NOT forward cardinal reports verbatim. Mapping:

| Phase-report field | User-response field |
|---|---|
| `## Files touched` | `## What changed` (consolidated across cardinals) |
| `## Decisions made` | `## Result` (top-line) + `## Notes` (deeper rationale, capped) |
| `## Verification log` | `## Verification` (consolidated) |
| `## Open issues` · `## Next dispatch needed` | `## Next` |
| `## Hand-off` · `## Stop-state` | `## Result` if user-blocking; otherwise `## Notes` |
| Self-lint violation counts across the batch | `## Notes` — single line `Schema-bound returns: <N>/<M> compliant.` per `core/templates/phase-report.md § Orchestrator behaviour on non-compliant returns` |

## Auto-mode delivery-handoff addendum

Auto-mode delivery handoff adds two sections (per `core/protocols/automatic-mode.md § Delivery handoff`):

- `## Delivery state` — table — mode (Mode 1/2/3) · current state (branch + commits / wt diff / commit list) · suggested next command. Replaces the freeform "delivery report".
- `## Accept / Feedback / Reject` — labelled three-line list with the concrete action each triggers. MUST NOT use prose; MUST NOT collapse into `## Next`.

`## Result` for delivery handoff reads as a single line — *"Delivered <N> changes against #<M>; awaiting Accept / Feedback / Reject."* Mechanics (forced-interactive count · budget burn · CI-watch status) move to `## Notes` ≤ 150 words.

## Worked size targets

| Surface | Unbounded typical | Schema-bound target | Reduction |
|---|---:|---:|---:|
| Phase-8 interactive response | 1,500–4,000 chars | 400–1,000 chars | ~70% |
| Auto-mode delivery handoff | 3,000–8,000 chars | 1,000–2,000 chars | ~70% |
| Mid-task user-facing report | 1,000–2,500 chars | 300–700 chars | ~70% |

Material excess = self-lint failure; restructure before surfacing.

## Section templates

### `## Result`

```
Result: <decision delivered | block surfaced | next-step request>.
```

### `## What changed`

| File / area | Delta |
|---|---|
| `<path or surface>` | `<one-line>` |

Empty case: `(none)`.

### `## Verification`

| Command / check | Outcome |
|---|---|
| `<command>` | `<exit code / pass-fail / count>` |

Empty case: `(none)`. Manual-smoke-not-run case: `Manual smoke: not run (headless / auto-mode); user runs <cmd> to confirm.`

### `## Next`

```
Next: <one-line user action OR (awaiting your direction)>.
```

### `## Notes` *(optional, capped)*

Narrative rationale that genuinely won't fit on a schema section. ≤ 150 words. Code-snippet carve-out per `core/templates/phase-report.md § Forbidden patterns` (3).

### Auto-mode addenda

```
## Delivery state

| Mode | State | Suggested next |
|---|---|---|
| <1 \| 2 \| 3> | <branch · commits · wt-diff state> | `<command>` |

## Accept / Feedback / Reject

- **Accept** — <concrete action: push + PR / commit per suggested / push current>.
- **Feedback** — <route + scope: loop to Phase <N> with <surface>>.
- **Reject** — <rollback action per mode>.
```

<!-- self-lint: pass -->
