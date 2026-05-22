# Migration — D26: D22 scope extension to ginee-authored GitHub artefacts

**Target release:** next minor after 2026-05-22.
**Affected adopters:** every adopter project that uses `ginee-file-*` skills OR receives framework-authored issue / PR comments.

## What changed

D22 (doc-authoring protocol) previously scoped only adopter markdown. D26 extends scope to two ginee-authored surfaces:

| Surface | Authored by |
|---|---|
| GitHub issue bodies via `ginee-file-*` skills | `team-lead` (orchestrator drafts; user approves) |
| Framework-authored comments — Phase-transition · sticky `ginee:score`/`ginee:review-cycle` · audit comments · per-thread review-replies | `team-lead` + specialists per the comment-cadence procedures |

**Same machinery as D22** — same 5 mandatory checks (per `core/process.md § Documentation style § Mandatory checks before report-as-done`); same default-shape map. **Lint covers every section, including Summary.**

**Enforcement** — LLM self-review embedded in the skills + comment-cadence procedures. No external linter; no runtime dependencies. Violations surface as restructure suggestions in the user-approval prompt; user accepts / rejects per finding.

## Action required — none (adopter-side)

**Purely additive.** No `local/` schema change. No new commands. The next time you invoke a `ginee-file-*` skill OR receive a framework-authored comment, the self-lint runs automatically; you'll see any restructure suggestions in the approval prompt.

Reporter-authored content (your own issue bodies, your own comments) is **unchanged** — D14 forbidden ("Never edit an issue body authored by another reporter") is upheld. `ginee-pick-up` MAY surface a polite advisory on dense-prose reporter bodies but never auto-rewrites.

## Files changed (framework upstream)

| Path | Change |
|---|---|
| `core/doc-authoring-protocol.md` | Added `## Scope` section + new `## Enforcement for ginee-authored GitHub artefacts` |
| `core/process.md § Documentation style` | Artefacts list extended — issue bodies + framework-authored comments |
| `core/skills/ginee-file-{bug,feature,framework-bug,framework-feature}/SKILL.md` | Added self-lint step before user approval |
| `core/templates/issues/{bug-report,feature-request,framework-bug-report,framework-feature-request}.md` | D26 shape-rule banner at top |
| `core/github-integration.md` | Comment-cadence subsections (Inbound pickup · Review-comment ingestion) declare D26 binding |
| `core/triage-scoring.md` | Cross-reference D26 in `§ Score comment + audit trail` |
| `core/templates/pr-comment-cadence.md` | Cross-reference D26 |
| `core/doc-authoring-examples.md` | 3 new bad/good pairs (Issue Summary · Issue body section · Phase-transition comment) |
| `CLAUDE.md` · `PLAN.md` | D26 row added |

## Backward compatibility

- **Reporter-authored issue bodies + comments** — unchanged. D14 forbidden upheld.
- **Existing ginee-authored comments** on closed issues / merged PRs — NOT retroactively rewritten. Forward-only.
- **`local/*` files** — no schema change.
- **`ginee-file-*` skill activation phrasings** — unchanged.

## Rollback

Not recommended. The D22 protocol is the framework's structure-over-prose discipline; D26 is an additive scope extension with no behavior change for reporter content. If a project genuinely wants ginee-authored issue bodies + comments to revert to free-form prose:

1. Revert `core/doc-authoring-protocol.md § Scope` to the pre-D26 version.
2. Revert the 4 `ginee-file-*` skill self-lint steps.
3. Revert the 2 github-integration.md comment-cadence D26 declarations.

## Issue reference

Implemented per [issue #64](https://github.com/kostiantyn-matsebora/ginee/issues/64) — *"Apply doc-authoring protocol (D22) to GitHub issue bodies + framework-authored comments"*.

The issue itself proved the need — its first two drafts packed comma-separated inventories into the Summary's parenthetical clause; draft 3 (and the issue body now on file) restructured them as bulleted scope statements.
