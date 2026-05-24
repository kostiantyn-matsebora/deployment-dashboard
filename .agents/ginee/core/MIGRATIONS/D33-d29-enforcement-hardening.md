# Migration — D33: D29 phase-report schema enforcement hardening

**Target release:** next minor after 2026-05-23.
**Affected adopters:** every adopter on every adapter — opt-in; no breaking change.

## What changed

D29 bound every cardinal-dispatch return to a strict schema with 6 mandatory checks at report-as-done. Enforcement was **aspirational** — agents skipped the checks when the underlying substance felt useful; the orchestrator had no structural detection surface to surface the skip; the only signal was the human noticing the shape was off.

D33 hardens enforcement with a **single-line structural marker** as the agent's attestation that the 6 checks ran:

```
<!-- D29 self-lint: pass -->
```

| Property | Rule |
|---|---|
| Placement | Last line of every cardinal-dispatch return — after all sections, after `(none)` placeholders, after `## Notes` if present. |
| Form | Literal `<!-- D29 self-lint: pass -->`. No variants. Case-sensitive. |
| When to write | **After** running the 6 checks against the drafted report — never blindly. |
| Honest-fail | If a check failed and could not be restructured (lifted to `## Notes`), still write the marker — `## Notes` capture is the legal escape hatch. |
| What it is NOT | Not a pass/fail gate (orchestrator consumes on absence). Not a re-dispatch trigger. Not a substitute for running the 6 checks. |

**Orchestrator detection.** Marker absence = structural signal the 6-check pass was skipped. Orchestrator surfaces the one-line advisory at receive-time and carries the rule forward to the subagent's next dispatch.

## Why a marker (vs. invisible self-check)

Pre-D33 the 6 checks were on the honour system. Three observations from the field (issue #86):

1. **Agent skip pattern.** When the return's substance felt useful, agents skipped the 6-check pass and shipped a narrative-preamble return without restructure.
2. **Orchestrator skip pattern.** Even when violations were visible, the orchestrator consumed the return silently — the "surface a one-line advisory" rule in `core/templates/phase-report.md § Orchestrator behaviour on non-compliant returns` had no enforcement hook of its own.
3. **D28 boundary breach as workaround.** A non-compliant verbose return tempted the skill-runner to "clean up" the content into a tidy summary table before passing to team-lead — which crossed the D28 surface boundary. D29 non-compliance directly increased D28 boundary risk.

D33's marker addresses all three:

| Failure mode | D33 mechanism |
|---|---|
| Agent skips the 6 checks | Marker absence is the agent's explicit non-attestation; orchestrator detects + advisories. |
| Orchestrator skips the advisory | Marker absence is a single-line structural detection — no nuanced shape parsing needed. |
| Skill-runner cleans up the return | New `core/process.md § Skill-runner — surface boundary § D29 / D33 interaction` cross-reference makes cleanup explicitly forbidden as a workaround. |

Same enforcement pattern as D22 / D26 attestation lines in `## Verification log` rows, scoped to the return envelope instead of the doc surface.

## Files changed (framework upstream)

| Path | Change |
|---|---|
| `core/templates/phase-report.md` | New `## Before-return checklist + mandatory marker (D33)` section between `## Mandatory checks before report-as-done` and `## Orchestrator behaviour on non-compliant returns`; orchestrator-behaviour section extended with `### Worked advisory examples` table + `### Carry-forward rephrasing` block. |
| `core/roles/{team-lead,solution-architect,ai-engineer,backend-engineer,frontend-engineer,devops-engineer,qa-engineer}.md` | One-line addendum to each `## Reporting` section — `; end with <!-- D29 self-lint: pass --> marker (D33).` |
| `core/roles/team-lead.details.md § Common failure modes` | New D33 row — D29 skip + skill-runner cleanup compound failure. |
| `core/process.md § Skill-runner — surface boundary (D28)` | New D29 / D33 interaction bullet — skill-runner explicitly forbidden from cleaning up a non-compliant return. |
| `core/process.md § Reporting — schema-bound (D29)` | New mandatory-marker bullet · extended orchestrator-on-non-compliance bullet (forbids skill-runner cleanup). |
| `core/doc-authoring-examples.md § 12` (NEW) | Paired bad/good full-return example — narrative-preamble vs schema-compliant + marker. |
| `CLAUDE.md` · `PLAN.md` | D33 row in locked-decisions table. |
| `docs/CHANGELOG.md` | D33 entry under Unreleased. |
| `core/MIGRATIONS/D33-d29-enforcement-hardening.md` | This file (NEW). |

## Action required — none (adopter-side)

**Purely additive.** No `local/` schema change. No `framework.config.yaml` keys. No installer change. No new commands. Existing cardinal returns on closed dispatches not retroactively required to carry the marker — forward-only.

The next cardinal dispatch under any role kernel runs the 6 checks + writes the marker automatically once the kernel reload picks up the addendum.

## Backward compatibility

- Schema unchanged (D29 mandatory sections + forbidden patterns untouched).
- 6 mandatory checks unchanged.
- Orchestrator non-compliance behaviour unchanged in spirit (advisory + consume + no auto-rewrite); D33 adds the marker-absence advisory + the skill-runner cleanup ban.
- Existing returns on closed dispatches unaffected.
- No adapter re-install required — pointer kernels under `adapters/_shared/agents/` already cite the kernel via the shared pointer; the marker rule rides on the kernel reload.

## Rollback

Not recommended — D33 closes an enforcement gap that recurred across long sessions. To revert:

1. Remove `## Before-return checklist + mandatory marker (D33)` from `core/templates/phase-report.md`.
2. Remove the `; end with <!-- D29 self-lint: pass --> marker (D33).` clause from the 7 cardinal `## Reporting` sections.
3. Remove the D33 row from `core/roles/team-lead.details.md § Common failure modes`.
4. Remove the D29 / D33 interaction bullet from `core/process.md § Skill-runner — surface boundary`.
5. Remove the mandatory-marker bullet from `core/process.md § Reporting — schema-bound (D29)`.
6. Remove `§ 12` from `core/doc-authoring-examples.md`.

D29 returns to honour-system enforcement; the issue #86 failure modes resurface.

## Issue reference

Closes [#86](https://github.com/kostiantyn-matsebora/ginee/issues/86) — *"[Framework Bug] D29 phase-report schema not enforced — team-lead self-lint + orchestrator advisory both skippable in practice."*
