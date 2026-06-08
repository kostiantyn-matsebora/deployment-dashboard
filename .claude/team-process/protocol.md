# Communication protocol

The typed forms every cross-role message uses. Inherited by every role — members emit/read them; the
orchestrator emits `BRIEF`/`FIX` and reads the rest. Part of the team-process kit core; the
orchestrator drives the phases that exchange these in [`process.md`](process.md).

Six typed forms carry every cross-role message: REVIEW · RESULT · BRIEF · FINDING · FIX · ARTIFACT.

- **Every cross-role message MUST be one of these forms**, emitted verbatim — never free prose.
- **Binds the orchestrator too** — `BRIEF` to dispatch, `FIX` to route — not only members.
- **Each form is a table:** **field name** · **what belongs** (the info) · **constraint** (the governing rule).
- **Fixed row order; omit empty rows.**

**Emitted rendering.** Render every form with `scripts/hooks/Format-ProtocolForm.ps1` — it owns the
layout rules (one `•` item per row; field name on its first row only, blank on continuation rows;
columns auto-aligned; a full-width `-----` rule after each field block; never `<br>`). **Never
hand-align the table** — the `SendMessage` guard rejects misaligned output. Invoke without shell
quoting pain:

1. **Write the simple form to a temp file** — first line the tag, then one `field: value` line per
   field; for a multi-value field write `field:` alone and put each value on its own indented line below.
2. **Render:** `pwsh -NoProfile -File scripts/hooks/Format-ProtocolForm.ps1 -InputFile <file>`
   (or pipe the form text in via stdin).
3. **Send the stdout verbatim** as the `SendMessage` body.

Simple-form input (left) → rendered output (right); the script renders all six the same way:

```
RESULT                          RESULT
role: backend                   | role    | • backend                                     |
changed:                        -----------------------------------------------------------
  GithubActionsAdapter.cs       | changed | • GithubActionsAdapter.cs                     |
  BackfillRunner.cs             |         | • BackfillRunner.cs                           |
gate:                           -----------------------------------------------------------
  build ok                      | gate    | • build ok                                    |
  264/264 tests                 |         | • 264/264 tests                               |
notes: extracted HTTP adapter   -----------------------------------------------------------
block: none                     | notes   | • extracted HTTP adapter                      |
                                -----------------------------------------------------------
                                | block   | • none                                        |
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
- A `BRIEF` **references** the role's typed form here (`RESULT`/`REVIEW`/…); it MUST NOT restate or
  invent a hand-back shape — restating competes with the protocol, itself a breach.
- A hand-back not in its typed form (extra/renamed fields, prose values, notes over the limit) is
  returned **UNREAD** — the orchestrator **MUST** reply *re-emit as `RESULT`/`REVIEW`* and **MUST NOT** parse the prose.
- A `changes-requested` `REVIEW` → orchestrator routes each remark to the owning implementer;
  loop until every competency `pass`es (see [`process.md`](process.md) *Review loop*). Peer review precedes `testing`.
- A red gate surfaced by `testing` → orchestrator issues a `FIX` to the owning role; loop
  until green (see [`process.md`](process.md) *Fix loop*).
- Members **MUST NOT** commit/push/PR — hand back via `RESULT`; only the orchestrator integrates.
