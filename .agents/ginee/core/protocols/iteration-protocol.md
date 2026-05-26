---
audience: all-cardinals
load: on-demand
triggers: [iteration, propose-review-implement, 15-min]
cap-bytes: 8192
reads-before-applying: []
---

# Iteration protocol — propose → review → implement

**Load-on-demand.** Activation cues:

- Phase 4 / 5 / 6 / 7 dispatch with estimated total scope > 15 min.
- Doc-roles pass between `ai-engineer` and any authoring role per `core/protocols/doc-roles.md`.
- User-supplied timeframe ("spend 30 min on X", "do as much as you can in an hour") — see § Timeframe-bounded autonomous work.

Default short tasks (≤ 15 min, no timeframe) do not load.

## Scope

All team work in Phases 4–7 (Implementation · Testing · Bug fixing · SA review) with estimated total scope > 15 min, plus `ai-engineer` ↔ authoring-role doc-roles passes. User intervention bounded to kickoff approval + final report.

## Estimation-first dispatch

Before any code / tests / fixes / doc edits, each dispatched specialist returns task decomposition + per-task time estimate. Orchestrator: synthesizes proposals → surfaces total + per-task to user when scope warrants → waits for approval before any specialist enters implement.

## Sizing

| Estimated scope | Approach |
|---|---|
| ≤ 15 min | Single iteration: specialist proposes full pass · reviewer reviews · specialist implements. |
| > 15 min | Multiple 3–5 min iterations, each producing a visible partial result. Specialist scopes next batch (3–7 sub-tasks) at iteration start. |

## Each iteration

1. **Propose.** Specialist submits structured proposal listing each sub-task — change / where / why / risk / time estimate. Doc work includes lossless evidence. **Adopt-vs-build axis** — surface the option list per `core/protocols/options-protocol.md` (≥ 1 adopt candidate with citation OR `(none viable — <reason>)`); inapplicable sub-tasks cite `"axis n/a — <reason>"`. No edits yet.
2. **Review.** Reviewer responds per item: accept · decline · accept-with-modification — each with one-line reasoning.

   | Work class | Reviewer |
   |---|---|
   | Doc semantics (any authoring role) | Authoring role per `core/protocols/doc-roles.md § Authorship`; SA reviews for architectural coherence. |
   | Phase 4–7 engineering | Orchestrator (surface to user when scope warrants). |

3. **Implement.** Specialist executes accepted items · applies reviewer modifications · runs domain self-check (build / lint / harness / lossless) · updates cross-refs in dependent files · ends in a stoppable intermediate state.

## Loop termination

Any one: specialist reports "no further productive proposals" · semantic territory only the user can decide · budget exhausted · user stops at any iteration boundary.

## Conflict resolution

- Doc semantics → authoring role wins per `core/protocols/doc-roles.md § Authorship` (SA wins on architectural-coherence).
- Implementation craft within a domain → domain-owning specialist wins.
- Product intent → user wins.
- **Re-proposal limit** — specialist may re-propose with new evidence ONCE per item; second decline is final.

## Stoppable intermediate states

Each iteration must leave the system valid + resumable:

| Role | "Stoppable" means |
|---|---|
| Engineers | No half-written code that breaks build / type-check / per-project unit tests. |
| QA | No partial test runs polluting fixtures · leaving seeded data behind · non-reproducible local stack. |
| Bug fixes | No half-applied contract changes — gate behind feature flag or stage behind no-op default. |
| Doc edits | No broken cross-references or orphaned sections. |

**User stops at any iteration boundary.** Orchestrator's stop report — **Done** (sub-tasks completed · files touched) · **In-progress** (interrupted · partial state · concrete resume instructions) · **Not-started** (remaining in approved batch · original estimates intact). Continuation from recorded state must require zero rework.

### Scope-overrun trigger

Apparent scope exceeds initial estimate by **> 2×** → specialist MUST stop at the next iteration boundary and report (Done / In-progress / Not-started). Orchestrator MUST force the same stop-and-report when observing the trigger in specialist reports OR its own in-thread work. Re-resolve scope with the user.

## Timeframe-bounded autonomous work

**Trigger.** User-supplied timeframe ("spend 30 min on X", "do as much as you can in an hour").

- **Autonomy.** Drive multi-specialist loops · sequential dispatches · iterations for the full period.
- **Checkpoint.** Boundary IS the checkpoint — report at end, never before.
- **Result classes** (honesty required): **Full** (everything done) · **Partial** (ran out mid-way) · **Early** (done sooner).
- **No per-iteration check-ins.** Valid mid-flight interrupts: scope creep · genuine ambiguity · semantic conflict the orchestrator can't resolve.
- **Partial results** include done / in-progress / not-started + concrete resume instructions.
- **Iteration.** Runs through this protocol until timeframe expires; each iteration ends in a stoppable state.
