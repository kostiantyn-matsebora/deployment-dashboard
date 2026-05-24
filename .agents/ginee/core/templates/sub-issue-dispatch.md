# Sub-issue dispatch — body template (D39)

Authored by `team-lead` per `core/MIGRATIONS/D39-sub-issue-dispatch.md`. One sub-issue per cardinal dispatch under the parent task issue. D26 self-lint applies before posting.

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
**Delivery mode:** Mode <1|2|3> per `core/delivery-modes.md`

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
| Blocker | `Blocked: <reason>. Needs: <unblock action>. time: <N>m. cumulative: <N>m.` + add label `ginee:blocked` |
| Hand-off request | `Hand-off: <reason> → @<role>.` + embed `core/templates/hand-off-note.md`; team-lead opens the new sub-issue for the recipient role |
| Phase change within dispatch (rare) | `Phase <N> → <N+1>: <reason>.` + swap label `ginee:phase:<N>` → `ginee:phase:<N+1>` |

## Closing comment

D29 phase-report return per `core/templates/phase-report.md` doubles as the closing comment. **`## Time spent`** mandatory — one-liner: `<H>h <M>m perceived effort; <N> progress comments on sub-issue #<M>.` Marker `<!-- D29 self-lint: pass -->` last line (D33). team-lead posts the return then `gh issue close <M> --reason completed`.

Stop-state (`Status: In-progress`) → progress comment only; sub-issue stays open per `core/MIGRATIONS/D39-sub-issue-dispatch.md § Stop-state interaction`.

## Forbidden

- Never edit the dispatch contract body after create — scope change = close + open new sub-issue.
- Never close with `--reason not_planned` on completed work — only on cancelled / superseded dispatches.
- Never reuse a sub-issue across dispatches — 1 dispatch = 1 sub-issue.
- Never federate sub-issues across repos.
- Never inline code blocks > 5 lines (D29 carve-out — link the commit / paste path instead).
- Never include the cardinal's full reasoning prose — `## Notes` 200-word cap (D29) applies to closing comments too.
