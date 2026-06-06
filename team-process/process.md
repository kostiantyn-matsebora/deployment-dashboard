# Orchestration Process

Extracted and generalized from a proven in-repo dispatch convention
(`engineering-process.md`, which noted it was "suitable for extraction to a shared
engineering-team framework"). Defines how one **orchestrator** routes a multi-layer
change across role-specialists. Project-agnostic. Pairs with [`roles/`](roles/).

## Routing (the seed convention)

The main loop **orchestrates**: it plans, sequences, and synthesizes specialist
returns. There is no separate team-lead agent — orchestration is a mode.

Route each change to the role that owns it:

| Change type | Role |
|---|---|
| Contract / API shape (endpoint, verb, payload, wire format) | [`contract`](roles/contract.md) |
| Server-side / backend code | [`backend`](roles/backend.md) |
| Frontend / SPA / UI | [`frontend`](roles/frontend.md) |
| CI/CD, containers, release lifecycle, infrastructure (IaC) | [`infrastructure`](roles/infrastructure.md) |
| Tests + verification | [`testing`](roles/testing.md) |
| Markdown docs / indexes / sources-of-truth | [`docs`](roles/docs.md) |
| Plan, dispatch, integrate, ship | [`orchestrator`](roles/orchestrator.md) |

## Rules (from the seed convention)

- **Surface before launch.** Present the dispatch plan (which roles + scope) before
  starting. For N parallel members, get explicit user confirmation first.
- **Parallelize only independent slices.** Serialize coupled or shared-file edits — or
  isolate them in separate git worktrees — to avoid index contention.
- **Inline execution is the exception.** Reserve main-loop execution for trivial edits,
  orchestration itself, and conversational turns. Substantive changes go to the owning role.

## Execution modes — same roles, two substrates

The roles and guardrails are identical regardless of *how* a role runs. Only the
substrate differs. **The default flow is unchanged; teams never replace it — they are
an escalation the user opts into explicitly.**

| Mode | How it starts | Substrate | When |
|---|---|---|---|
| **Subagents on demand** *(default)* | The orchestrator (main loop) dispatches the owning role as an in-session subagent that reports back. Triggered by normal asks — "pick up issue 86", freeform instructions. | `Agent`/Task subagents inside the lead's session. | Most work: one or a few surfaces, or any task one integrator + sequential/parallel subagents can handle. |
| **Agent team** *(opt-in)* | The orchestrator runs `/feature-team <issue>`: plan-and-confirm, then `TeamCreate` + spawn role members as separate sessions coordinating via `SendMessage` + a shared task list. | Separate Claude sessions, each spawned with the role's `subagent_type`. | Big issues — **≥3 layers with a shared contract** — where dedicated per-role context + peer contract-negotiation pay off. |

Both modes obey this process and the same [`roles/`](roles/). Trivial edits,
orchestration, and conversational turns stay inline regardless of mode.

## Orchestration model — single integrator

One orchestrator is the **sole integration and commit gate**. Members produce changes
in their lane; the orchestrator reviews, reconciles, commits, and ships. This is what
keeps a multi-agent change auditable.

- **Hub-and-spoke by default.** Members report to the orchestrator, which synthesizes
  and holds the plan + the merge.
- **Peer-to-peer only for contract negotiation.** The `contract` role may talk directly
  with consumers to settle an interface — but the result is an **artifact** (spec /
  schema), never left as chat.
- **Structured fan-out is deterministic.** Drive parallel phases from an explicit
  plan/script, not free-form chatter — so what ran is repeatable and visible.

## Phases

0. **Intake & docs-first.** Read the owning spec before any code; restate its acceptance
   criteria. The spec is the contract *and* the regression gate.
1. **Contract.** Cross-layer change → define/update the shared contract first; everyone
   codes against the agreed artifact.
2. **Plan & dispatch.** Map work to roles; declare each role's **ownership lane** (exact
   files); surface the plan; confirm before N parallel members.
3. **Implement.** Parallel **only on disjoint lanes**; coupled/shared work is serialized
   or **worktree-isolated**. Each member **self-verifies** (build + **unit tests for its
   own change** + lint) and reports actual pass/fail counts.
4. **Integrate & verify.** Orchestrator merges lanes; the `testing` role runs the wider
   net (API / integration / e2e + **regression**); failures route back through the
   orchestrator to the owning specialist (see *Verification & the fix loop*). Re-verify
   against the phase-0 spec.
5. **Ship.** Commit in logical groups, push to a branch, open/update the PR, watch CI
   green. Never push to the default branch directly.

## Verification & the fix loop

Testing is split by ownership; failures route back through the orchestrator.

- **Each implementer tests its own change.** Within its lane, a specialist writes and
  runs **unit tests** for the code it produced (where applicable) as part of self-verify,
  and reports actual pass/fail counts. No change is handed back unit-untested.
- **The `testing` role owns the wider net** — API, integration, e2e, and **regression**
  across the suite — run after implementers integrate. It **reports negative (failing)
  results to the orchestrator** rather than fixing production code itself (it may fix the
  *tests* per its own guardrail, never weaken them).
- **The orchestrator analyzes failures and assigns the fix.** On any red result it
  diagnoses the cause, routes each failure to the **owning specialist** to fix, then
  re-runs — looping until the full suite is green. The orchestrator never ships red.

## Standing guardrails — every role inherits these

1. **Docs-first.** Read the owning spec via the docs index before coding; it's the
   contract + acceptance gate. Update the spec first when behavior changes.
2. **Single integrator.** Members **never** commit, push, or open PRs — hand back; only
   the orchestrator integrates.
3. **Stay in your lane.** Touch only declared files. Need a change outside it? Report
   it — don't make it.
4. **Repo hygiene.** Match the project's line-ending + formatting convention; run the
   formatter; never introduce mixed EOL. OS-dependent formatters that differ from CI →
   the CI platform's result wins.
5. **Self-verify before returning.** Build + tests + lint green; report **actual** results
   (counts, failures, skips). No "should pass."
6. **Report, don't act, on scope changes.** A blocker, contradiction, or "impossible"
   finding is escalated as a decision — never silently re-scoped.
7. **Check provided theories first.** When the orchestrator/user hands a diagnosis,
   cheaply test *that* before independent investigation.

## Verify state after every wave

The orchestrator re-checks repo state between waves — a member may have done more than
asked (committed, pushed, touched out-of-lane files, introduced mixed EOL). Catch it
before it compounds.

## Anti-patterns (each cost a real failure)

- Implementation leads, spec treated as descriptive → lost behavior.
- Multiple writers on one worktree → clobbers, rogue commits, lost state.
- Returning unverified work ("builds locally") → red CI, wasted round-trips.
- Re-deriving a diagnosis the user already gave → burned effort.
- Silent truncation/re-scoping when blocked → the request quietly unmet.
