# Orchestration Process

Generalized from a proven in-repo dispatch convention (`engineering-process.md`). One
**orchestrator** routes a multi-layer change across role-specialists. Project-agnostic.
Pairs with [`roles/`](roles/).

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

| Mode | Start | Substrate | When |
|---|---|---|---|
| **Subagents** *(default)* | Orchestrator dispatches the owning role as an in-session subagent. | `Agent`/Task subagents in the lead's session. | Most work: one/few surfaces, handled by one integrator + sequential/parallel subagents. |
| **Agent team** *(opt-in)* | `/feature-team <issue>`: plan-confirm → `TeamCreate` + spawn role members as separate sessions. | Separate Claude sessions, each `subagent_type` = role. | ≥3 layers sharing a contract, where per-role context + peer contract-negotiation pay off. |

## Single-integrator model

One orchestrator is the **sole integration/commit gate**. Members produce in-lane changes;
the orchestrator reviews, reconciles, commits, ships — this keeps the change auditable.

- **Hub-and-spoke default.** Members report to the orchestrator; it holds the plan + merge.
- **Peer-to-peer only for contract negotiation.** The `contract` role may settle an
  interface directly with consumers — the result is an `ARTIFACT`, never left as chat.
- **Fan-out is deterministic.** Drive parallel phases from an explicit plan, not chatter
  — repeatable + visible.
- **The orchestrator traffics in compressed messages, not raw artifacts.** It reads
  `RESULT`/`FINDING`/`ARTIFACT` — never test logs, full diffs, or source. A decision that
  needs an artifact read → delegate it and get back a compressed message.
- **Keep the lead's working set to `plan + current wave`.**
  - Maintain a durable **run ledger** (lane map + one line per wave: changed / decided / deferred) as the authoritative state.
  - Fold each `RESULT` into it and drop the verbatim message. In team mode the shared task list is the ledger.

## Communication protocol

All cross-role messages use these 5 typed forms. **Fixed field order; omit empty fields;
one fact per line.** The vocabulary is binding — roles emit/consume these, not free prose.

```
BRIEF              orch → role   · dispatch
spec:    <owning spec path#section — docs-first target + acceptance gate>
lane:    <glob(s) the role may touch; nothing else>
task:    <one line>
gate:    <self-verify set, e.g. build+unit+lint>
seed:    <optional diagnosis/theory to TEST FIRST before investigating>
```
```
RESULT             role → orch   · hand-back
role:    <role>
changed: <files>
gate:    <ACTUAL results, e.g. build ok | unit 12/12 | lint ok — never "should pass">
notes:   <≤3 design decisions>
follow:  <out-of-lane needs / deferred>
block:   <none | see FINDING>
```
```
FINDING            role → orch   · blocker / contradiction / impossible
where:   <file or spec>
issue:   <contradiction | impossible | missing input>
options: <a / b>
need:    <decision required>
```
```
FIX                orch → role   · fix-loop assignment
test:    <failing test id>
expect:  <…>   actual: <…>
suspect: <layer / file>
```
```
ARTIFACT           contract → orch → consumers   · settled interface
spec:    <committed path>
delta:   <resources / operations changed>
open:    <questions needing a decision>
```

- `RESULT.gate` carries **actual** counts — a narrative claim is never accepted as a gate result.
- A red gate surfaced by `testing` → orchestrator issues a `FIX` to the owning role; loop
  until green (see *Fix loop*).
- Members never commit/push/PR — hand back via `RESULT`; only the orchestrator integrates.

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
4. **Integrate & verify.** Orchestrator merges lanes; `testing` runs the wider net
   (API/integration/e2e + regression). Red → `FIX` to the owning role. Re-verify against
   the phase-0 spec.
5. **Ship.** Commit in logical groups, push to a branch, open/update the PR, watch CI green.
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

## Standing guardrails — every role inherits these

1. **Docs-first.** Read the owning spec (`BRIEF.spec`) before coding; it's contract +
   acceptance gate. Behavior change → update the spec first.
2. **Single integrator.** Members never commit/push/PR — hand back via `RESULT`.
3. **Stay in your lane.** Touch only `BRIEF.lane` files. Need more? `RESULT.follow` or a
   `FINDING` — don't make the change.
4. **Repo hygiene.**
   - Match the project's line-ending + format convention; run the formatter.
   - Never introduce mixed EOL.
   - OS-dependent formatter differs from CI → the CI platform's result wins.
5. **Self-verify before returning.** Build + tests + lint green; `RESULT.gate` carries
   actual counts/failures/skips. No "should pass."
6. **Report, don't act, on scope changes.** Blocker / contradiction / "impossible" → a
   `FINDING`, never a silent re-scope.
7. **Check provided theories first.** A `BRIEF.seed` diagnosis is tested cheaply before
   independent investigation.
8. **Tool-output economy.** Pull only the needed slice of a tool run into context — exit
   code + aggregate on success, exit code + failing slice on failure — never the full log.
   See *Tool-output economy*.

## Tool-output economy

Verbose tool runs (tests, builds, linters, installs, searches) burn context for an answer
that's usually one number. Pull only the **needed slice** into context — never the raw log.

- **Capture, then inspect.** Redirect the run to a file/variable; branch on the **exit code**;
  surface only the filtered slice.
- **Success → aggregate only.** Exit code + the summary line (e.g. `42/42 passed`, `build ok`).
  Discard per-item chatter.
- **Failure → exit code + failing slice.** Failing names + their assertion diff / error lines
  only — not the passing noise around them.
- **Prefer the tool's quiet mode** (minimal/error-only reporter, `--quiet`, `--no-progress`)
  over post-filtering when available.
- **Scope reads/searches too.** Globs + line ranges; symbol/section retrieval (Serena /
  markdown MCP), not whole-file or whole-repo dumps.

`RESULT.gate` is this aggregate, never a pasted raw log. Binding for every role and mode.

## Verify state after every wave

The orchestrator re-checks repo state between waves — a member may have done more than
asked (committed, pushed, out-of-lane edits, mixed EOL). Catch it before it compounds.

## Anti-patterns (each cost a real failure)

- Implementation leads, spec treated as descriptive → lost behavior.
- Multiple writers on one worktree → clobbers, rogue commits, lost state.
- Returning unverified work ("builds locally") → red CI, wasted round-trips.
- Re-deriving a diagnosis the user already gave → burned effort.
- Silent truncation/re-scoping when blocked → the request quietly unmet.
