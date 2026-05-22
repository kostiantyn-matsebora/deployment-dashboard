# Iteration protocol — propose → review → implement

**Load-on-demand.** Fetched by orchestrator (or specialist) when dispatched work matches an activation cue:

- Phase 4 / 5 / 6 / 7 dispatch with estimated total scope > 15 min.
- Doc co-ownership pass between `ai-engineer` and `solution-architect`.
- User gives a timeframe (e.g., "spend 30 min on X", "do as much as you can in an hour") — see § Timeframe-bounded autonomous work.

Default short tasks ( ≤ 15 min, no timeframe ) do not load this file.

## Scope

- All team work in Phases 4–7 (Implementation, Testing, Bug fixing, SA review) with estimated total scope > 15 min.
- Doc co-ownership passes between `ai-engineer` and `solution-architect`.

**User intervention** bounded to:

- Kickoff approval.
- Final report.

## Estimation-first dispatch

- Before any code / tests / fixes / doc edits, each dispatched specialist MUST respond with:
  - Task decomposition.
  - Per-task time estimate.
  - No edits yet.
- Orchestrator:
  1. Synthesizes all specialist proposals.
  2. Surfaces total + per-task breakdown to the user when scope warrants.
  3. Waits for approval or redirect before any specialist enters implement.
- **Applies to** Phase 4, Phase 5, Phase 6, Phase 7, and `ai-engineer` ↔ SA doc co-ownership passes.

## Sizing

| Estimated total scope | Approach |
|---|---|
| ≤ 15 min | Single iteration: specialist proposes full pass; reviewer (orchestrator / SA / user as appropriate) reviews; specialist implements. |
| > 15 min | Multiple short iterations of 3–5 min each; each produces a visible partial result. Specialist scopes the next batch (3–7 sub-tasks) at the start of each iteration. |

## Each iteration

1. **Propose.**
   - Specialist submits structured proposal listing each sub-task: change / where / why / risk / time estimate.
   - For doc work, also include lossless evidence.
   - No edits yet.
2. **Review.**
   - Reviewer responds per item: accept / decline / accept-with-modification, each with one-line reasoning.
   - **Reviewer identity:**

     | Work class | Reviewer |
     |---|---|
     | Doc co-ownership semantics | `solution-architect` |
     | Phase 4–7 engineering | orchestrator (surfacing to user when scope warrants) |
3. **Implement.**
   - Specialist executes accepted items.
   - Applies reviewer's modifications.
   - Runs domain self-check: build / lint / harness / lossless check as applicable.
   - Updates cross-references in dependent files.
   - Ends in a stoppable intermediate state per § Stoppable intermediate states.

## Loop termination

Any one of:

- Specialist reports "no further productive proposals" in the next batch.
- Specialist or reviewer hits semantic territory only the user can decide.
- Pre-agreed budget exhausted.
- User stops at any iteration boundary.

## Conflict resolution

- **Doc semantics** → `solution-architect` wins.
- **Implementation craft within a specialist's domain** → domain-owning specialist wins (per `local/bindings.md` → "Project role boundaries").
- **Product intent** → user wins.
- **Re-proposal limit.** Specialist may re-propose with new evidence ONCE per item. Second decline is final.

## Orchestrator role

- Dispatches the three steps each iteration.
- Surfaces the estimation batch before implement.
- Surfaces intermediate results when:
  - User requests, OR
  - An iteration revealed something to redirect on.

## Stoppable intermediate states

Each iteration must leave the system in a valid, resumable state:

| Role | What "stoppable" means |
|---|---|
| Engineers | No half-written code that breaks build, type-check, or per-project unit tests. |
| QA | No partial test runs that pollute fixtures, leave seeded data behind, or leave local stack non-reproducible. |
| Bug fixes | No half-applied contract changes (e.g. service half landed, client half pending) — gate behind feature flag or stage behind no-op default. |
| Doc edits | No broken cross-references or orphaned sections. |

**User stops at any iteration boundary.** Orchestrator's stop report:

- **Done.** Sub-tasks completed, with files touched.
- **In-progress.** Sub-task interrupted, with partial state recorded + concrete resume instructions (same partial-result format as § Timeframe-bounded autonomous work).
- **Not-started.** Sub-tasks remaining in the approved batch, with original estimates intact.

Continuation from the recorded state must require zero rework.

### Scope-overrun trigger

When apparent scope exceeds the initial estimate by **> 2×** (specialist's own estimate, OR orchestrator's estimate on in-thread work that should have been dispatched per `core/roles/team-lead.md § Forbidden actions`):

- Specialist MUST stop at the next iteration boundary and report (done / in-progress / not-started per the stop-report format above) — never continue silently.
- Orchestrator MUST force the same stop-and-report when observing the trigger in a specialist's reports or its own in-thread work, and re-resolve scope with the user.

## Timeframe-bounded autonomous work

**Trigger.** User gives a timeframe (e.g., "spend 30 min on X", "do as much as you can in an hour"). Orchestrator treats it as a budget for autonomous work.

- **Autonomy.** Work autonomously for the full period:
  - Drive multi-specialist loops.
  - Run sequential dispatches.
  - Iterate.
- **Checkpoint.** Boundary is the checkpoint — report at the end, not before.
- **Result classes** — all three acceptable; honesty about which is required:

  | Class | Meaning |
  |---|---|
  | **Full** | Everything done within the budget. |
  | **Partial** | Ran out of budget mid-way. |
  | **Early** | Done sooner than expected. |

- **No per-iteration check-ins.** Valid mid-flight interrupts:
  - Scope creep.
  - Genuine ambiguity.
  - Semantic conflict the orchestrator can't resolve.
- **Partial results** — report must include:
  - **done / in-progress / not-started** breakdown.
  - Concrete resume instructions.
- **Iteration.** Runs through this protocol until the timeframe expires; each iteration ends in a stoppable intermediate state.
