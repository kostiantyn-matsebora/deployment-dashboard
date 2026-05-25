# PR comment cadence — cycle summary template

Sticky comment posted by `team-lead` after every `ginee-address-review` cycle. One per cycle (hard cap). Idempotent via `<!-- ginee:review-cycle n=<N> -->` marker — find via marker; post if absent; do NOT edit prior cycles (immutable cycle log).

Full ingestion spec: `core/github-integration.md § Review-comment ingestion`. Template below is already structured (table for thread rows · one-line headline); team-lead self-lints any per-cycle wording before posting per `core/process.md § Mandatory checks before report-as-done`.

## Format

```
<!-- ginee:review-cycle n=<N> -->
**Review cycle <N>:** <M> remarks addressed (<K> code, <M-K> reply). HEAD: <sha>.

| Thread | File:line | Role | Action |
|---|---|---|---|
| T#abc | backend/api/X.cs:42 | backend-engineer | fix → abc1234 |
| T#def | docs/architecture.md:88 | solution-architect | reply (decline — cites ADR-0006) |
| T#ghi | frontend/src/login.tsx:17 | frontend-engineer | fix → abc1234 |
```

## Fields

| Field | Source |
|---|---|
| `<N>` | Cycle ordinal — count of prior `ginee:review-cycle` markers on PR + 1 |
| `<M>` | Total addressed-this-cycle thread count |
| `<K>` | Subset with `action-type = fix` |
| `<M-K>` | Subset with `action-type = reply` |
| `<sha>` | HEAD commit on PR branch after cycle commit (`(no code changes)` if cycle was reply-only) |
| Table rows | Approved plan-table rows; `Action` collapses `proposed action` + landed-commit ref |

## Forbidden

- Never edit a prior cycle's sticky — cycles are immutable; new cycle = new sticky.
- Never post a mid-cycle progress comment — the cycle summary IS the progress signal.
- Never inline thread `body` text — link via thread-id only; readers click through.
- Never include PII (reviewer handles in body, raw comment text) — table cells are summary digests only.
