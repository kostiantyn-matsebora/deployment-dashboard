# Phase Report — Schema (D29)

**Binding schema for every cardinal-dispatch return.** Same machinery as D22 / D26 doc-authoring protocol, scoped to the subagent-return surface. Self-lint at report-as-done; orchestrator surfaces violations as a one-line advisory and consumes anyway.

## Section cardinality

| Section | Cardinality | Default shape | Cap |
|---|---|---|---|
| `## Files touched` | **required** (else `(none)`) | Table — `path` · `Δ lines` · `purpose` | 1 row per file |
| `## Decisions made` | **required** (else `(none)`) | Bullets — `<short imperative> — cite` | ≤ 80 chars / bullet |
| `## Verification log` | **required** | Table — `command / check` · `outcome` | 1 row per check |
| `## Open issues` | **required** (else `(none)`) | Bullets — `<issue> — <owner / blocker>` | ≤ 80 chars / bullet |
| `## Next dispatch needed` | **required** (else `(none)`) | One-liner — `<role> · <surface> · <reason>` | 1 line |
| `## Hand-off` | required **if failed dispatch / cross-domain root cause outside domain** (per `core/cross-agent-handoff.md`) | Embed `core/templates/hand-off-note.md` shape | per template |
| `## Stop-state` | required **if `Status: In-progress`** (iteration-protocol stop boundary) | Three-bucket bullets — Done / In-progress / Not-started | per `core/protocols/iteration-protocol.md § Stoppable intermediate states` |
| `## Notes` | **optional** — narrative-rationale escape hatch only | Free-form prose | ≤ 200 words |

**Status header** (single line at top): `Status: Done | In-progress | Blocked | Hand-off`. For iteration-protocol intermediate returns: same schema, sections marked `(in-progress)` where partial, plus the required `## Stop-state`.

## Forbidden patterns (self-lint catches)

1. **Narrative preamble.** *"I started by reading X, then I edited Y…"* → `## Files touched` table directly.
2. **Restated dispatch context.** Repeating what the orchestrator already dispatched → cite the dispatch prompt; don't restate.
3. **Code snippets in the schema body.** Diff stats + path cite only. Carve-out: ≤ 5-line literal inside `## Notes` when the orchestrator needs verbatim text (e.g. a malformed config) — not the default path.
4. **Verbose rationale outside `## Notes`.** One-line decision + cite in `## Decisions made`; deeper rationale → `## Notes` (capped).
5. **Parenthetical comma-soup.** Same D22 / D26 rule — inventories belong in tables, not parentheses.

## Mandatory checks before report-as-done

Same 5 as `core/process.md § Documentation style § Mandatory checks` (D22 / D26) **plus**:

6. **No narrative preamble.** First non-Status line is a `##` section header — never a sentence describing what the subagent did.

Run all 6 against the drafted report **before** returning. Violations → restructure; if a violation genuinely can't be restructured, lift the offending content into `## Notes` (still capped at 200 words).

## Before-return checklist + mandatory marker (D33)

Run the 6 checks above against the drafted report. Append, as the **last line**, the literal attestation marker `<!-- D29 self-lint: pass -->`. Form is fixed; case-sensitive; placement after every section + `(none)` placeholder + `## Notes` if present. Write the marker **after** running the checks — never blindly. Honest-fail: un-restructurable content lifted to `## Notes` still writes the marker (the cap is the legal escape hatch). Marker is not a pass/fail gate (orchestrator consumes on absence) and not a re-dispatch trigger.

**Why a marker.** Pre-D33 the 6 checks were aspirational — agents skipped them, orchestrator had no structural detection. Marker absence is a single-line detectable signal; same mechanism as D22 / D26 attestation lines in `## Verification log`, scoped to the return envelope.

## Orchestrator behaviour on non-compliant returns

- Surface a one-line advisory before consuming (`"Return missed self-lint: <violation>; consuming anyway."`).
- **Never re-dispatch purely for format.** Absorb the verbose return once; carry the rule forward to the subagent's next dispatch.
- Never auto-rewrite the subagent's content (analogous to D14 reporter-content forbidden).
- **Skill-runner forbidden** from "cleaning up" non-compliant returns before passing to team-lead (D28 boundary holds — see `core/process.md § Skill-runner`).

### Worked advisory examples

| Detected violation | Advisory text (exact) |
|---|---|
| Missing marker | `"Return missed self-lint: marker absent; consuming anyway."` |
| Narrative preamble | `"Return missed self-lint: narrative preamble; consuming anyway."` |
| Inventory rendered as prose / comma-soup | `"Return missed self-lint: inventory not in table form; consuming anyway."` |
| Code snippet outside `## Notes` carve-out | `"Return missed self-lint: code outside Notes carve-out; consuming anyway."` |
| Bullet > 25 words without sub-bullets | `"Return missed self-lint: bullet over-length; consuming anyway."` |
| Multiple violations | Cite the first; one line; do not enumerate. |

### Carry-forward rephrasing for the next dispatch

Append a **single-line** reminder at the end of the next dispatch prompt to the same subagent — cite the *specific* violation; never reopen the prior return; never re-dispatch for format:

```
<original dispatch text>

Return format: schema-bound per core/templates/phase-report.md;
last cycle's return missed self-lint (<violation>) — apply the 6 checks + marker this cycle.
```

## Section templates

### Status

```
Status: Done
```

### `## Files touched`

| Path (absolute or repo-relative) | Δ lines (`+N / -M`) | Purpose |
|---|---|---|
| `<path>` | `+12 / -3` | `<one-line why>` |

Empty case: `(none)`.

### `## Decisions made`

- `<short imperative>` — `<cite: FR-NN-slug / NFR-NN-slug / ADR-NNNN-slug / mockup §X>`

Taxonomy IDs slug-glued per D34 — `ADR-0001-topology-derivation-five-pass`, not bare `ADR-0001`. Resolution lookup + lint rule: `core/protocols/doc-authoring-protocol.md § Taxonomy identifier pairing (D34)`.

Empty case: `(none)`.

### `## Verification log`

| Command / check | Outcome |
|---|---|
| `<command>` | `<exit code / pass-fail / count>` |

Doc-authoring attestation lines (D22 / D26 / D29) live here as table rows, not free-form bullets.

### `## Open issues`

- `<issue>` — `<owner / blocker / TODO surfaced>`

Empty case: `(none)`.

### `## Next dispatch needed`

- `<role> · <surface> · <one-line reason>`

Empty case: `(none)`.

### `## Hand-off` *(when applicable)*

Per `core/templates/hand-off-note.md`. Required when the dispatch hit a forced-handoff (root cause outside the subagent's domain per `core/cross-agent-handoff.md`).

### `## Stop-state` *(when `Status: In-progress`)*

- **Done.** `<sub-tasks completed · files touched>`
- **In-progress.** `<sub-task interrupted · partial state · concrete resume instructions>`
- **Not-started.** `<sub-tasks remaining in approved batch · original estimates intact>`

### `## Notes` *(optional, capped)*

Narrative rationale that genuinely won't fit on a `## Decisions made` bullet. ≤ 200 words. Code-snippet carve-out per forbidden-pattern #3.

## Worked size targets

| Dispatch class | Pre-D29 typical | Schema-bound target | Reduction |
|---|---:|---:|---:|
| Simple cardinal | 1,500–3,000 chars | 400–800 chars | ~70% |
| Complex Phase-4 | 5,000–15,000 chars | 1,500–3,000 chars | ~70% |
| Full Phase 1–8 cycle (5+ dispatches) | 30,000–80,000 chars | 8,000–20,000 chars | ~70% |

A return materially above these targets is a self-lint failure; restructure before reporting.

## Orchestrator behaviour on non-compliant returns

- Surface a one-line advisory before consuming (`"Return missed self-lint: <violation>; consuming anyway."`).
- **Never re-dispatch purely for format.** The orchestrator absorbs the verbose return once; the subagent's next dispatch carries the rule forward.
- Never auto-rewrite the subagent's content (analogous to D14 reporter-content forbidden).
