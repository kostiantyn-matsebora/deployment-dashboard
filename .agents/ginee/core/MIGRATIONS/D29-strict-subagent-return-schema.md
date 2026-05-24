# Migration — D29: strict subagent-return schema

**Target release:** next minor after 2026-05-23.
**Affected adopters:** every adopter on every adapter — opt-in; no breaking change.

## What changed

D29 binds every cardinal-dispatch return to a strict schema — same machinery as D22 / D26 doc-authoring protocol, applied to the subagent-return surface. Pre-D29 `core/templates/phase-report.md` existed but enforcement was light; cardinal returns padded with narrative preambles, restated dispatch context, verbose rationale, and embedded code dumps. Across recent cycles those returns were the **largest single contributor to orchestration-thread bloat** (1,500–15,000 chars per dispatch typical).

D29 cuts that by ~70%:

| Dispatch class | Pre-D29 typical | Schema-bound target | Reduction |
|---|---:|---:|---:|
| Simple cardinal | 1,500–3,000 chars | 400–800 chars | ~70% |
| Complex Phase-4 | 5,000–15,000 chars | 1,500–3,000 chars | ~70% |
| Full Phase 1–8 cycle (5+ dispatches) | 30,000–80,000 chars | 8,000–20,000 chars | ~70% |

Measured worked example (`core/doc-authoring-examples.md § 10`): bad return 3,603 chars → schema-bound 1,136 chars; **68.5% reduction** on a real Phase-4 return.

## The schema

| Section | Cardinality | Default shape | Cap |
|---|---|---|---|
| `## Files touched` | **required** (else `(none)`) | Table — `path` · `Δ lines` · `purpose` | 1 row per file |
| `## Decisions made` | **required** (else `(none)`) | Bullets — `<imperative> — cite` | ≤ 80 chars / bullet |
| `## Verification log` | **required** | Table — `command` · `outcome` | 1 row per check |
| `## Open issues` | **required** (else `(none)`) | Bullets — `<issue> — <owner>` | ≤ 80 chars / bullet |
| `## Next dispatch needed` | **required** (else `(none)`) | One-liner — `<role> · <surface> · <reason>` | 1 line |
| `## Hand-off` | conditional — forced handoff per `core/cross-agent-handoff.md` | Embed `core/templates/hand-off-note.md` shape | per template |
| `## Stop-state` | conditional — `Status: In-progress` (iteration-protocol stop boundary) | Three-bucket bullets — Done / In-progress / Not-started | per `core/protocols/iteration-protocol.md § Stoppable intermediate states` |
| `## Notes` | **optional** — narrative-rationale escape hatch | Free-form prose | ≤ 200 words; ≤ 5-line code-snippet carve-out |

**Status header** (single line at top): `Status: Done | In-progress | Blocked | Hand-off`.

## 6 mandatory checks before report-as-done

1. No paragraph contains > 2 rules (sentence terminators).
2. No table cell holds a multi-sentence sub-paragraph.
3. No bullet runs > 25 words *unless* it carries nested sub-bullets.
4. Inventories are tables, not prose.
5. Cross-references cite anchors; never restate content.
6. **No narrative preamble** — first non-Status line is a `##` section header.

Checks 1–5 are the same D22 / D26 mandatory checks; check 6 is D29-only.

## Forbidden patterns

- **Narrative preamble.** *"I started by reading X, then I edited Y…"* → `## Files touched` table directly.
- **Restated dispatch context.** Cite the dispatch prompt; don't restate.
- **Code snippets in the schema body.** Diff stats + path cite only. Carve-out: ≤ 5-line literal inside `## Notes`.
- **Verbose rationale outside `## Notes`.** One-line decision + cite in `## Decisions made`; deeper rationale → capped Notes.
- **Parenthetical comma-soup.** Same D22 / D26 rule.

## Open-question picks

| Question | Resolution |
|---|---|
| `## Notes` cap | ≤ 200 words (matches D22 / D26 caps). |
| Code snippets | Total ban outside Notes carve-out (≤ 5 lines, verbatim-only). |
| Iteration-protocol intermediate returns | Same schema with `(in-progress)` markers + required `## Stop-state`. |
| Failed dispatch returns | Same schema + required `## Hand-off` embedding `core/templates/hand-off-note.md`. |

## Enforcement

LLM self-review against the schema **before returning**. No external linter.

| Stage | Mechanism |
|---|---|
| Author | Dispatched cardinal drafts the return per `core/templates/phase-report.md`. |
| Self-lint | Role runs the 6 mandatory checks against the draft before returning. Violations → restructure; un-restructurable content → lift into capped `## Notes`. |
| Orchestrator on non-compliance | `team-lead` surfaces a one-line advisory (`"Return missed self-lint: <violation>; consuming anyway"`), consumes the return, never re-dispatches purely for format, never auto-rewrites (analogous to D14 reporter-content forbidden). |

## Action required — none (adopter-side)

**Purely additive.** No `local/` schema change. No new commands. No adapter re-install. Existing dispatches on closed tasks unaffected — forward-only. The next cardinal dispatch under any role kernel runs the self-lint automatically.

## Files changed (framework upstream)

| Path | Change |
|---|---|
| `core/templates/phase-report.md` | Rewritten as schema (cardinality table · default-shape map · caps · forbidden patterns · 6 checks · worked size targets) |
| `core/process.md` | New always-loaded `## Reporting — schema-bound (D29)` section above `## Coordination protocol` |
| `core/roles/team-lead.md` | Existing `## Reporting` block replaced with schema pointer |
| `core/roles/solution-architect.md` | Existing `## Reporting` block amended — schema pointer + Phase-1 design-mode bullets preserved as `## Decisions made` rows |
| `core/roles/ai-engineer.md` | New `## Reporting` section (1-line pointer + lossless-self-check row note) |
| `core/roles/frontend-engineer.md` | New `## Reporting` section (1-line pointer) |
| `core/roles/backend-engineer.md` | New `## Reporting` section (1-line pointer + D19 coverage attestation row note) |
| `core/roles/devops-engineer.md` | New `## Reporting` section (1-line pointer + D18 script-quality + health-check row notes) |
| `core/roles/qa-engineer.md` | New `## Reporting` section (1-line pointer + test-run + manual-smoke row notes) |
| `core/protocols/doc-authoring-protocol.md` | Title + `§ Scope` extended to subagent returns; new `§ Enforcement for subagent returns (D29)` |
| `core/doc-authoring-examples.md` | New § 10 — paired bad / good Phase-4 return with measured 68.5% reduction |
| `docs/CONCEPTS.md` · `docs/CHEATSHEET.md` · `docs/CHANGELOG.md` | D29 entries |
| `CLAUDE.md` · `PLAN.md` | D29 row |
| `core/MIGRATIONS/D29-strict-subagent-return-schema.md` | This file (NEW) |

## Backward compatibility

- **Adopter `local/*` files** — no schema change.
- **Existing closed-task returns** — NOT retroactively rewritten. Forward-only.
- **Cardinal role kernels** — every kernel now has a `## Reporting` section pointing at the schema; pre-D29 kernels with no Reporting section get a 1-line addition.
- **`framework.config.yaml`** — no new keys.
- **Adapter renderings** — none required; the schema lives in `core/`.

## Rollback

Not recommended. D29 is the discipline that closes the largest current orchestration-thread bloat source. To revert:

1. Revert `core/templates/phase-report.md` to the pre-D29 free-form template.
2. Remove `core/process.md § Reporting — schema-bound (D29)`.
3. Remove the `## Reporting` sections from the 5 cardinals that didn't have one.
4. Revert `core/roles/team-lead.md` + `core/roles/solution-architect.md § Reporting` to their pre-D29 prose.
5. Revert `core/protocols/doc-authoring-protocol.md § Scope` + remove `§ Enforcement for subagent returns`.
6. Remove `core/doc-authoring-examples.md § 10`.

The framework still functions but cardinal returns return to free-form prose; orchestration-thread bloat returns to pre-D29 levels.

## Issue reference

Closes [#69](https://github.com/kostiantyn-matsebora/ginee/issues/69) — *"[Framework Feature] Strict subagent-return schema — D22/D26 self-lint pattern applied to cardinal dispatch results."*

The issue body provisionally numbered this decision D27; D27 + D28 were taken (installer-fetch-on-update + skill-runner boundary) before #69 landed, so the final number is **D29**.
