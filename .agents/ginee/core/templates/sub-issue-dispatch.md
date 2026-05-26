# Sub-issue dispatch — template + lints

Authored by `team-lead` per `core/protocols/github-integration.md § Sub-issue dispatch`. One sub-issue per cardinal dispatch under the parent task issue (issue-sourced only). Three surfaces: dispatch contract body (frozen at create) · progress comments (during execution) · closing comment (phase-report return).

## Title

```
[<phase>:<cardinal>] <task-one-liner>
```

Examples — `[4:backend-engineer] Implement /v1/items pagination per ADR-0014-cursor-pagination` · `[5:qa-engineer] Author scenario suite for FR-12-bulk-import` · `[7:solution-architect] Governance review of PR #142`.

## Labels (set at create)

`ginee:role:<cardinal>` (1 of 7) · `ginee:phase:<N>` (updated on transition) · `value:<H|M|L>` + `complexity:<H|M|L>` (inherited from parent).

## Body

```markdown
<!-- ginee:sub-issue-dispatch v=1 parent=#<parent-number> -->

## Dispatch contract

**Cardinal:** `<role>` (alias: `<alias-if-any>`)
**Phase:** <N> — <phase-name>
**Parent:** #<parent-number>
**Estimate:** <H>h <M>m (per iteration-protocol; updates as sub-tasks land)
**Delivery mode:** Mode <1|2|3> per `core/protocols/delivery-modes.md`

## Scope

<one paragraph OR bulleted scope — what's in, what's out>

## Acceptance

- [ ] <criterion 1 — testable / observable>
- [ ] <criterion 2>

## Spec links

| Spec | Surface |
|---|---|
| `<path>` | `<§ section>` |

## Initial state

| Track | Status |
|---|---|
| time | `time: 0m` · `cumulative: 0m` |
| sub-tasks | (none started — cardinal owns decomposition per `core/protocols/iteration-protocol.md`) |
| blockers | (none) |
```

## Comment cadence — cardinal-authored on the sub-issue

| Trigger | Shape |
|---|---|
| Sub-task start | `Started: <sub-task>. time: 0m. cumulative: <N>m.` |
| Sub-task complete | `Done: <sub-task>. <commit-sha-link-if-any>. time: <N>m. cumulative: <N>m.` |
| Blocker | `Blocked: <reason>. Needs: <unblock action>. time: <N>m. cumulative: <N>m.` + add `ginee:blocked` label |
| Hand-off request | `Hand-off: <reason> → @<role>.` + embed `core/templates/hand-off-note.md`; team-lead opens new sub-issue for recipient |
| Phase change within dispatch (rare) | `Phase <N> → <N+1>: <reason>.` + swap label `ginee:phase:<N>` → `ginee:phase:<N+1>` |

## Closing comment

Phase-report return per `core/templates/phase-report.md` doubles as closing comment. `## Time spent` mandatory — one-liner: `<H>h <M>m perceived effort; <N> progress comments on sub-issue #<M>.` Marker `<!-- self-lint: pass -->` last line. team-lead posts return then `gh issue close <M> --reason completed`. Stop-state (`Status: In-progress`) → progress comment only; sub-issue stays open.

## Required elements per surface

| Element | Required on | Notes |
|---|---|---|
| Title `[<phase>:<cardinal>] <task-one-liner>` | body | Per § Title. |
| Header marker `<!-- ginee:sub-issue-dispatch v=1 parent=#<parent> -->` | body — first line | Fixed; case-sensitive. |
| Labels | sub-issue at create | Exactly one `ginee:role:*` + one `ginee:phase:*` + inherited scoring labels. |
| Body sections | dispatch contract body | Dispatch contract · Scope · Acceptance · Spec links · Initial state (per § Body). |
| `time: <N>m` + `cumulative: <N>m` | every progress comment | Per § Comment cadence. |
| `## Time spent` | closing comment | Per `core/templates/phase-report.md § Time spent`. |
| `<!-- self-lint: pass -->` | every surface (body · progress · closing) | Last line per `core/protocols/doc-authoring-protocol.md § Enforcement for ginee-authored GitHub artefacts`. |

## Self-lint — every surface, before posting

1. Title matches `[<phase>:<cardinal>] <task-one-liner>` (body only).
2. Header marker on body — first line.
3. Labels: exactly one `ginee:role:*` · one `ginee:phase:*` · inherited scoring labels.
4. Every progress comment carries both `time: <N>m` AND `cumulative: <N>m`.
5. Closing includes `## Time spent` per `phase-report.md`.
6. Doc-authoring 6 mandatory checks per `core/process.md § Documentation style`.

Last line of every posted surface: `<!-- self-lint: pass -->`.

## Forbidden

1. **Editing the dispatch contract body after create** — scope change = close + open new sub-issue.
2. **Closing with `--reason not_planned` on completed work** — reserved for cancelled / superseded.
3. **Reusing a sub-issue across dispatches** — 1 dispatch = 1 sub-issue.
4. **Federating sub-issues across repos** — one repo per `github.repo`.
5. **Inline code > 5 lines** in body / comments — Notes carve-out per `phase-report.md`.
6. **Carrying tracking-mode posture in skill-runner hand-off briefs** per `core/process/dispatch.md § Skill-runner — surface boundary`.
7. **Cardinal's full reasoning prose in closing** — `## Notes` 200-word cap applies.

## Worked example

| Surface | Content |
|---|---|
| Title | `[4:backend-engineer] Implement /v1/items pagination per ADR-0014-cursor-pagination` |
| Labels | `ginee:role:backend-engineer` · `ginee:phase:4` · `value:high` · `complexity:medium` |
| Body header | `<!-- ginee:sub-issue-dispatch v=1 parent=#142 -->` (body per § Body) |
| Progress 1 | `Started: cursor encode/decode. time: 0m. cumulative: 0m.` |
| Progress 2 | `Done: cursor encode/decode. abc1234. time: 22m. cumulative: 22m.` |
| Closing | phase-report `## Time spent`: `1h 04m perceived effort; 2 progress comments on sub-issue #198.` |
| Close op | `gh issue close 198 --reason completed` |

<!-- self-lint: pass -->
