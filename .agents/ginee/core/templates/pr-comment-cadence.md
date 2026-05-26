# PR comment cadence — template + lints (review cycle)

Sticky cycle-summary posted by `team-lead` after every `ginee-address-review` cycle. One per cycle (hard cap). Idempotent via `<!-- ginee:review-cycle n=<N> -->` marker — find via marker; post if absent; **never edit prior cycles** (immutable cycle log).

Full ingestion procedure: `core/protocols/github-integration.md § Review-comment ingestion`. This file binds template + rules + self-lint across the two cycle surfaces (per-thread reply · sticky cycle summary).

## Two surfaces

| Surface | Authored by | Cardinality |
|---|---|---|
| **Per-thread reply** | dispatched specialist (reply-track) — text + marker; team-lead posts via API | 1 per addressed thread per cycle |
| **Sticky cycle summary** | team-lead at cycle end | 1 per cycle (immutable cycle log) |

## Required elements

| Element | Required on | Notes |
|---|---|---|
| `<!-- ginee:review-reply r=<thread-id> -->` | every per-thread reply | `thread-id` = last 6 chars of GitHub thread-id. |
| `<!-- ginee:review-cycle n=<N> -->` | every sticky | `<N>` = count of prior cycle markers + 1. |
| Cycle headline | sticky | `**Review cycle <N>:** <M> remarks addressed (<K> code, <M-K> reply). HEAD: <sha>.` |
| Thread table | sticky | 4 columns — Thread · File:line · Role · Action. |
| Reply body | per-thread | specialist-authored — rationale / decline-with-cite / deferred-to-#N. |
| `<!-- self-lint: pass -->` | every surface | Last line per `core/protocols/doc-authoring-protocol.md § Enforcement for ginee-authored GitHub artefacts`. |

## Sticky format

```
<!-- ginee:review-cycle n=<N> -->
**Review cycle <N>:** <M> remarks addressed (<K> code, <M-K> reply). HEAD: <sha>.

| Thread | File:line | Role | Action |
|---|---|---|---|
| T#abc | backend/api/X.cs:42 | backend-engineer | fix → abc1234 |
| T#def | docs/architecture.md:88 | solution-architect | reply (decline — cites ADR-0006) |
| T#ghi | frontend/src/login.tsx:17 | frontend-engineer | fix → abc1234 |
```

## Sticky fields

| Field | Source |
|---|---|
| `<N>` | Cycle ordinal — count of prior `ginee:review-cycle` markers on PR + 1 |
| `<M>` | Total addressed-this-cycle thread count |
| `<K>` | Subset with `action-type = fix` |
| `<M-K>` | Subset with `action-type = reply` |
| `<sha>` | HEAD commit on PR branch after cycle commit (`(no code changes)` if cycle was reply-only) |
| Table rows | Approved plan-table rows; `Action` collapses `proposed action` + landed-commit ref |

## Per-thread reply template

```
<specialist-authored reply — rationale OR decline-with-cite OR deferred-to-#N>

<!-- ginee:review-reply r=<thread-id> -->
<!-- self-lint: pass -->
```

## Self-lint — every surface, before posting

1. Per-thread reply ends with `ginee:review-reply r=<thread-id>`; `<thread-id>` matches plan-table `T#<short-id>`.
2. Sticky starts with `ginee:review-cycle n=<N>`; `<N>` = count of prior cycle markers + 1.
3. Cycle headline numerics add up — `<M> = <K> + <M-K>`; HEAD `<sha>` matches cycle commit (or `(no code changes)` on reply-only).
4. Thread table — exactly 4 columns; one row per addressed thread; `Action` collapses proposed-action + landed-commit ref.
5. Lossless coverage — count of plan-table threads = `ginee:review-reply` markers + fix-touched mappings. Gap → re-dispatch.
6. Doc-authoring 6 mandatory checks per `core/process.md § Documentation style`.

Last line of every posted surface: `<!-- self-lint: pass -->`.

## Forbidden

1. **Editing a prior cycle's sticky** — cycles immutable; new cycle = new sticky.
2. **Mid-cycle progress comments** — sticky IS the progress signal.
3. **Inlining thread `body` text** in sticky — link via thread-id only.
4. **Team-lead paraphrasing specialist reply** — specialist owns wording.
5. **Bypassing user-confirmation gate** for "trivial" remarks — forced-interactive even under `auto:`.
6. **Silent drops** — every plan-table thread ends as fix OR reply (lossless coverage).
7. **PII in sticky cells** — reviewer handles / raw text. Cells are summary digests only.

## Worked example

Per-thread reply (decline):

```
The async overload was considered in ADR-0006-sync-orm-boundary; the synchronous
boundary is intentional. Closing on existing decision.

<!-- ginee:review-reply r=def123 -->
<!-- self-lint: pass -->
```

Sticky cycle summary:

```
<!-- ginee:review-cycle n=1 -->
**Review cycle 1:** 3 remarks addressed (2 code, 1 reply). HEAD: abc1234.

| Thread | File:line | Role | Action |
|---|---|---|---|
| T#abc | backend/api/users.cs:42 | backend-engineer | fix → abc1234 |
| T#def | docs/architecture.md:88 | solution-architect | reply (decline — cites ADR-0006) |
| T#ghi | frontend/src/login.tsx:17 | frontend-engineer | fix → abc1234 |

<!-- self-lint: pass -->
```

<!-- self-lint: pass -->
