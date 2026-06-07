# Orchestration Process

Generalized from a proven in-repo dispatch convention (`engineering-process.md`). One
**orchestrator** routes a multi-layer change across role-specialists. Project-agnostic.
Pairs with [`roles/`](roles/). Two companions are inherited by every role:
[`protocol.md`](protocol.md) (the typed communication forms) and
[`guardrails.md`](guardrails.md) (standing guardrails + tool-output economy).

## Routing

The main loop **orchestrates** — plans, sequences, synthesizes returns. No separate
team-lead agent; orchestration is a mode. Route each change to its owning role:

| Change | Role |
|---|---|
| Contract / API shape (endpoint, verb, payload, wire format) | [`contract`](roles/contract.md) |
| Server-side / backend code | [`backend`](roles/backend.md) |
| Frontend / SPA / UI | [`frontend`](roles/frontend.md) |
| CI/CD, containers, release, IaC | [`infrastructure`](roles/infrastructure.md) |
| Tests + verification | [`testing`](roles/testing.md) |
| Markdown docs / indexes / sources-of-truth | [`docs`](roles/docs.md) |
| Plan, dispatch, integrate, ship | [`orchestrator`](roles/orchestrator.md) |

## Rules

- **Surface before launch.** Present the dispatch plan (roles + scope) before starting;
  for N parallel members, get explicit confirmation.
- **Parallelize only disjoint lanes.** Serialize coupled/shared-file edits, or isolate
  them in separate worktrees — avoid index contention.
- **Inline is the exception.** Main-loop execution only for trivial edits, orchestration,
  and conversational turns. Substantive changes → the owning role.

## Execution modes

Roles + guardrails are identical across modes; only the substrate differs. **Default flow
is unchanged; teams never replace it — opt-in escalation only.**

| Mode | How it runs | When |
|---|---|---|
| **In-session subagents** *(default)* | The orchestrator dispatches the owning role as an in-session subagent that reports back. | Most work: one/few surfaces, handled by one integrator + sequential/parallel subagents. |
| **Spawned team** *(opt-in)* | Role members run as separate, coordinated sessions under a plan-confirm launch; the lead integrates. | ≥3 layers sharing a contract, where per-role context + peer contract-negotiation pay off. |

The modes are runtime-neutral; each runtime maps them to its own primitives. Two bindings ship:

**Claude Code:**

- In-session subagent = the `Agent`/Task tool.
- Spawned team = `/feature-team <issue>` → plan-confirm → `TeamCreate` + spawn members (`subagent_type` = role), coordinating via `SendMessage` + a shared task list.
- Project bindings: `CLAUDE.md` § *Project bindings*.

**GitHub Copilot:**

- Role member = a custom agent `.github/agents/<role>.agent.md` (body = the role anchor), invoked `@<role>`.
- In-session subagent = invoke `@<role>` directly.
- Spawned team = `/fleet` (Copilot CLI) — decomposes the objective into parallel tracks dispatched to the role agents; the lead integrates.
- Project bindings: `.github/copilot-instructions.md`.

## Single-integrator model

One orchestrator is the **sole integration/commit gate**. Members produce in-lane changes;
the orchestrator reviews, reconciles, commits, ships — this keeps the change auditable.

- **Hub-and-spoke default.** Members report to the orchestrator; it holds the plan + merge.
- **Peer-to-peer only for contract negotiation.** The `contract` role may settle an
  interface directly with consumers — the result is an `ARTIFACT`, never left as chat.
- **Fan-out is deterministic.** Drive parallel phases from an explicit plan, not chatter
  — repeatable + visible.
- **The orchestrator traffics in compressed messages, not raw artifacts.** It reads
  `RESULT`/`REVIEW`/`FINDING`/`ARTIFACT` — never test logs, full diffs, or source. A decision that
  needs an artifact read → delegate it and get back a compressed message.
- **Keep the lead's working set to `plan + current wave`.**
  - Maintain a durable **run ledger** (lane map + one line per wave: changed / decided / deferred) as the authoritative state.
  - Fold each `RESULT` into it and drop the verbatim message. In team mode the shared task list is the ledger.

## Communication protocol

The 6 typed forms (`BRIEF` · `RESULT` · `REVIEW` · `FINDING` · `FIX` · `ARTIFACT`) — fields,
rendering, and rules — live in [`protocol.md`](protocol.md). Every cross-role message MUST be one of
them, emitted verbatim; a non-conforming hand-back is returned **UNREAD** for re-emit. The
orchestrator emits `BRIEF`/`FIX` and reads the rest; it never parses prose hand-backs.

## Phases

0. **Intake & docs-first.** Read the owning spec before code; restate its acceptance
   criteria. Spec = contract *and* regression gate.
1. **Contract.** Cross-layer change → define/update the shared contract first (→ `ARTIFACT`);
   all code targets the agreed artifact.
2. **Plan & dispatch.** Map work to roles; declare each lane (exact files) in a `BRIEF`;
   surface the plan; confirm before N parallel members.
3. **Implement.** Parallel only on disjoint lanes; coupled/shared work serialized or
   worktree-isolated. Each member self-verifies (build + own-change unit tests + lint) and
   returns a `RESULT` with actual counts.
4. **Integrate.** Orchestrator merges lanes into the branch.
5. **Cross-review.** Before `testing`: dispatch one reviewer per touched competency (reviewer ≠
   that lane's implementer) to check the integrated change set against that role's
   **non-negotiable** definitions; each returns a `REVIEW`. All `pass` → proceed. Any
   `changes-requested` → route remarks to the owning implementer and loop (see *Review loop*).
6. **Verify.** `testing` runs the wider net (API/integration/e2e + regression). Red → `FIX` to
   the owning role. Re-verify against the phase-0 spec.
7. **Ship.** Commit in logical groups, push to a branch, open/update the PR, watch CI green.
   Never push to the default branch.

## Fix loop

Testing is split by ownership; failures route through the orchestrator.

- **Implementer tests its own change.** Each specialist writes + runs unit tests for its
  code (where applicable) and reports actual counts in `RESULT`. No change handed back
  unit-untested.
- **`testing` owns the wider net** — API/integration/e2e/regression, run after integration.
  - Reports red to the orchestrator (failing `RESULT` / `FINDING`).
  - Never fixes production code; may fix the *tests*, never weaken them.
- **Orchestrator diagnoses to *route*, not to fix.**
  - From the `FINDING` (`expect`/`actual`/`suspect`) it picks the owning specialist and issues a `FIX`; it does not open the code itself.
  - **Deep investigation is the owning agent's prerogative**, in that agent's own context.
  - Re-run after each fix; loop until green. Never ship red.

## Review loop

Peer review runs AFTER implementers hand back + lanes are integrated, and BEFORE `testing`.
Catches what a green build can't: principle / code-smell violations. Remarks route through the
orchestrator.

- **One reviewer per touched competency.** For each role whose lane the change set changed,
  dispatch a fresh instance of that role as reviewer (backend→`backend`, frontend→`frontend`,
  infra/devops→`infrastructure`, contract→`contract`, …). **Reviewer ≠ the implementer** of that
  lane (independent eyes).
- **Scope = that role's non-negotiables.** The reviewer reads only its competency's diff and
  checks it against its role's binding definitions (e.g. `backend`: engineering principles · the
  code-smell→remedy table · coding heuristics). Read-only — a reviewer never edits production code.
- **Returns a `REVIEW`** — `pass`, or `changes-requested` + remarks (principle/smell · location ·
  required change).
- **All competencies `pass` → proceed to *Verify*.** Any `changes-requested` → orchestrator routes
  each remark to the owning implementer; it fixes; re-review that competency. Loop until all `pass`.
- **Checklist-driven, per-symbol.** The reviewer enumerates each touched symbol and walks the FULL
  bar against it (every smell + SOLID/DI), recording coverage in `REVIEW.checked`. A skim is not a
  review; `verdict: pass` is invalid without `checked`.
- **Re-review is full, not delta.** After a fix, re-run the full checklist on the whole CHANGED UNIT
  — a fix that trades one smell for another (e.g. cutting params but keeping a concrete dependency)
  must be caught here, not just the original remark.
- **Reviewers report, never fix** — mirrors `testing`; preserves the single-integrator model.

## Standing guardrails & tool-output economy

The 11 standing guardrails (docs-first · single-integrator · stay-in-lane · repo hygiene ·
self-verify · report-don't-act · check-theories-first · tool-output economy · typed-forms-verbatim ·
walk-the-full-bar · no-harm refactor) and the tool-output-economy detail are inherited by every role
and mode — see [`guardrails.md`](guardrails.md).

## Verify state after every wave

The orchestrator re-checks repo state between waves — a member may have done more than
asked (committed, pushed, out-of-lane edits, mixed EOL). Catch it before it compounds.

## Anti-patterns (each cost a real failure)

- Implementation leads, spec treated as descriptive → lost behavior.
- Multiple writers on one worktree → clobbers, rogue commits, lost state.
- Returning unverified work ("builds locally") → red CI, wasted round-trips.
- Re-deriving a diagnosis the user already gave → burned effort.
- Silent truncation/re-scoping when blocked → the request quietly unmet.
- Tests-green mistaken for principle-compliance → smells ship unreviewed (run the *Review loop*).
- Self-review by the implementer → blind spots; the reviewer must be a different instance.
