---
description: Run the ginee-pick-up skill procedure mechanically — fetch issue + sub-issues + comments, score, swap labels, hand off to team-lead.
argument-hint: #<N>
---

Pick up issue $ARGUMENTS per `core/skills/ginee-pick-up/SKILL.md § Procedure`. Run the steps mechanically; never improvise the flow.

Mandatory steps:

1. **Fetch issue body** — `gh issue view <N>`. Parse: title · labels · state. Validate `OPEN` + `ready-label`.
2. **Fetch comments** — `gh issue view <N> --comments`. Reporters pin scope clarifications here; read every comment before Phase 2.
3. **Fetch sub-issues** — `gh api repos/<owner>/<repo>/issues/<N>/sub_issues`. Sub-issues carry scope expansions; never skip.
4. **Scoring + sticky** — per `core/protocols/triage-scoring.md § Score comment + audit trail`. Missing `value:*` → ask user H/M/L + audit comment. Missing `complexity:*` → dispatch `solution-architect` for estimate + audit comment. Post/update sticky `<!-- ginee:score v=1 -->` (one per issue; never duplicate).
5. **Lite-mode detection** — per `core/process/dispatch.md § Per-task prefix grammar`. Resolution chain: prefix > `complexity:low` + single `ginee:role:*` label > config default.
6. **Sub-issue fast-path** — if dispatch decision lives in a sub-issue's labels + body per `core/protocols/github-integration.md § Sub-issue dispatch`, skill-runner dispatches the labelled cardinal directly; skip team-lead.
7. **Swap label** — `ready-label` → `in-progress-label`.
8. **Hand off** to team-lead with: full body · comments · sub-issues · scoring · lifecycle flag.

Forbidden actions per `core/protocols/github-integration.md § Forbidden actions`:

- Auto-set `value:*` (always ask user; never infer).
- Rewrite reporter content.
- Skip the comments + sub-issues read (both are mandatory).

End with the standard team-lead hand-off note per `core/templates/hand-off-note.md`.
