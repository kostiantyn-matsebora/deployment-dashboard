---
name: ginee-address-review
description: Address code-review remarks on an open PR. Ingests `pulls/{N}/comments` + `/reviews`, routes per role, surfaces a consolidated plan table for user approval (no exception), then reconciles fix-track patches into one cycle commit + posts per-thread replies + one sticky cycle summary. Idempotent. Use when user says 'address review on PR #N', 'respond to review on #N', 'handle review feedback on #N', or invokes `/ginee-address-review #N`.
---

# Address review — PR remarks

Thin wrapper. Loads `.agents/ginee/core/github-integration.md § Review-comment ingestion` for the shared 7-step procedure. The `@team-lead address-review #<PR>` command runs the identical procedure for adapters without AgentSkills.

## Activation

| Phrasing | |
|---|---|
| "Address review on PR #<N>" / "address review #<N>" | |
| "Respond to review comments on PR #<N>" | |
| "Handle review feedback on #<N>" | |
| `/ginee-address-review #<N>` | |

`<N>` = PR number in primary repo per `.agents/ginee/core/github-integration.md § Repo discovery`. **No `framework-` variant** — checked-out branch must be the PR's head ref.

## Procedure

1. Load `.agents/ginee/core/github-integration.md § Review-comment ingestion`.
2. Run its 7-step shared procedure verbatim. Key invariants:
   - Plan-table approval gate is **forced-interactive** — applies even in `auto:` mode per `.agents/ginee/core/automatic-mode.md § Forced-interactive triggers`.
   - Routing per `local/bindings.md § Source-of-truth ownership`; fallback to `team-lead`.
   - Lossless coverage — every plan-table thread ends cycle as `fix` OR `reply`.
   - Idempotency markers: `<!-- ginee:review-reply r=<thread-id> -->` per thread; `<!-- ginee:review-cycle n=<N> -->` sticky per cycle.
   - Sticky format per `.agents/ginee/core/templates/pr-comment-cadence.md`.
3. Re-invocation = same procedure. Skips already-marked threads unless a newer reviewer comment landed.

## Forbidden

- Never post a reply or push a fix before plan-table approval — no "trivial" exception.
- Never silently drop a thread — violates lossless coverage rule.
- Never auto-resolve review threads — reviewer / PR author resolves.
- Never post > 1 cycle-summary comment per cycle.
- Never auto-detect new review comments — invocation is explicit; D20 CI-watch unaffected.
- Never federate across repos — single-PR scope.
- Never run when checked-out branch ≠ PR head — fix would land on the wrong branch.
