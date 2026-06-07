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

All cross-role messages use these 6 typed forms. Each form is a table: **field name** ·
**what belongs** (the pieces of info) · **constraint** (the rule governing it). **Fixed row
order; omit empty rows.** Every cross-role message **MUST** be one of these forms, emitted
verbatim — **never** free prose. This binds the **orchestrator** too (`BRIEF` to dispatch,
`FIX` to route), not only members.

**Emitted rendering (all six forms).** *Every* typed form — REVIEW · RESULT · BRIEF ·
FINDING · FIX · ARTIFACT — is sent as an aligned 2-column table: **one `•` item per row**,
the field name on its **first row only** (blank field cell on continuation rows), columns
auto-padded so every `|` lines up, and a **full-width `-----` rule after each field block**.
Never use `<br>`; never join two items on one line. Render with the helper
`scripts/hooks/Format-ProtocolForm.ps1` rather than hand-aligning. Worked examples — every form rendered:

```
REVIEW
| role    | • backend                                                 |
-----------------------------------------------------------------------
| scope   | • backend/fetcher-github/**                               |
-----------------------------------------------------------------------
| checked | • GithubActionsAdapter × SRP / smells                     |
|         | • BackfillRunner × SOLID / DI                             |
-----------------------------------------------------------------------
| verdict | • changes-requested                                       |
-----------------------------------------------------------------------
| remarks | • SRP · GithubActionsAdapter.cs:42 · extract HTTP adapter |
-----------------------------------------------------------------------
| block   | • see FINDING                                             |
-----------------------------------------------------------------------

RESULT
| role    | • backend                                     |
-----------------------------------------------------------
| changed | • GithubActionsAdapter.cs                     |
|         | • BackfillRunner.cs                           |
-----------------------------------------------------------
| gate    | • build ok                                    |
|         | • 264/264 tests                               |
-----------------------------------------------------------
| notes   | • extracted HTTP adapter into dedicated class |
-----------------------------------------------------------
| block   | • none                                        |
-----------------------------------------------------------

BRIEF
| spec | • docs/fetcher/fetcher.md#polling                      |
-----------------------------------------------------------------
| lane | • backend/fetcher-github/**                            |
-----------------------------------------------------------------
| task | • decompose long methods in GithubActionsAdapter       |
-----------------------------------------------------------------
| gate | • build ok                                             |
|      | • unit tests green                                     |
-----------------------------------------------------------------
| seed | • methods over 40 lines flagged by structural analyzer |
-----------------------------------------------------------------

FINDING
| where   | • backend/fetcher-github/GithubActionsAdapter.cs |
--------------------------------------------------------------
| issue   | • contradiction                                  |
--------------------------------------------------------------
| options | • a - extract method; keep class boundary        |
|         | • b - split into two focused classes             |
--------------------------------------------------------------
| need    | • decide ownership boundary before refactor      |
--------------------------------------------------------------

FIX
| test    | • BackfillRunnerTests.RunAsync_StopsOnCancellation          |
-------------------------------------------------------------------------
| expect  | • test completes within 5 s                                 |
-------------------------------------------------------------------------
| actual  | • hangs indefinitely                                        |
-------------------------------------------------------------------------
| suspect | • BackfillRunner.cs - missing CancellationToken propagation |
-------------------------------------------------------------------------

ARTIFACT
| spec  | • docs/api/openapi.yaml                         |
-----------------------------------------------------------
| delta | • GET /deployments — added status filter param  |
|       | • POST /deployments — added correlationId field |
-----------------------------------------------------------
| open  | • pagination strategy not yet decided           |
-----------------------------------------------------------
```

**BRIEF** — orch → role · dispatch

| Field | What belongs | Constraint |
|---|---|---|
| spec | • owning spec path#section<br>• acceptance gate it sets | docs-first target; required |
| lane | • glob(s) the role may touch | nothing outside it |
| task | • the change to make | one line, imperative |
| gate | • self-verify set | build + unit + lint |
| seed | • diagnosis/theory to test first | optional; omit if none |

**RESULT** — role → orch · hand-back

| Field | What belongs | Constraint |
|---|---|---|
| role | • the reporting role | one of the role names |
| changed | • files touched | in-lane only |
| gate | • actual gate outcomes | real counts (`build ok`, `unit 12/12`); never "should pass" |
| notes | • key design decisions | ≤3 |
| follow | • out-of-lane needs / deferred | omit if none |
| block | • blocker pointer | `none` or `see FINDING` |

**REVIEW** — reviewer → orch · peer compliance check (pre-testing)

| Field | What belongs | Constraint |
|---|---|---|
| role | • the reviewing competency | a role name; reviewer ≠ that lane's implementer |
| scope | • lanes/files reviewed | the change set in this competency |
| checked | • touched symbols × dimensions walked | required; the full bar per symbol, not a skim |
| verdict | • `pass` / `changes-requested` | `pass` only with zero remarks; invalid without `checked` |
| remarks | • each: principle/smell · location `file:line` · required change | omit if `pass`; cite the role's non-negotiables |
| block | • blocker pointer | `none` or `see FINDING` |

**FINDING** — role → orch · blocker / contradiction / impossible

| Field | What belongs | Constraint |
|---|---|---|
| where | • file or spec at fault | path or spec ref |
| issue | • the problem | one of: contradiction / impossible / missing input |
| options | • viable paths | ≥2 (a / b) |
| need | • the decision required | one line |

**FIX** — orch → role · fix-loop assignment

| Field | What belongs | Constraint |
|---|---|---|
| test | • failing test id | exact id |
| expect | • expected behavior | — |
| actual | • observed behavior | — |
| suspect | • likely layer / file | a route hint, not a fix |

**ARTIFACT** — contract → orch → consumers · settled interface

| Field | What belongs | Constraint |
|---|---|---|
| spec | • committed contract path | committed, not chat |
| delta | • resources / operations changed | — |
| open | • questions needing a decision | omit if none |

- `RESULT.gate` carries **actual** counts — a narrative claim is never accepted as a gate result.
- A `BRIEF` **references** the role's typed form in *Communication protocol* (`RESULT`/`REVIEW`/…);
  it MUST NOT restate or invent a hand-back shape — restating competes with the protocol, itself a breach.
- A hand-back not in its typed form (extra/renamed fields, prose values, notes over the limit) is
  returned **UNREAD** — the orchestrator **MUST** reply *re-emit as `RESULT`/`REVIEW`* and **MUST NOT** parse the prose.
- A `changes-requested` `REVIEW` → orchestrator routes each remark to the owning implementer;
  loop until every competency `pass`es (see *Review loop*). Peer review precedes `testing`.
- A red gate surfaced by `testing` → orchestrator issues a `FIX` to the owning role; loop
  until green (see *Fix loop*).
- Members **MUST NOT** commit/push/PR — hand back via `RESULT`; only the orchestrator integrates.

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
9. **Typed forms verbatim.** Every hand-back **MUST** match a *Communication protocol* table
   exactly — fixed row order, no extra fields, within limits. Non-conforming hand-backs **MUST**
   be returned unread for re-emit; the orchestrator **MUST NOT** act on prose.
10. **Walk the full bar before hand-back.** Self-check EVERY touched symbol against this role's
    non-negotiables + SOLID/DI; attest it in `RESULT.gate` / `REVIEW.checked`. Opportunistic
    "what jumps out" is not enough.
11. **No-harm refactor.** Remedying one smell must not introduce or retain another — re-check the
    whole changed unit against the full bar (smell table + SOLID/DI), not just the target.

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
- Tests-green mistaken for principle-compliance → smells ship unreviewed (run the *Review loop*).
- Self-review by the implementer → blind spots; the reviewer must be a different instance.
