# Communication protocol

Typed forms every cross-role message uses — inherited by every role; orchestrator drives the phases that exchange them in [`process.md`](process.md).

Six typed forms carry every cross-role message: REVIEW · RESULT · BRIEF · FINDING · FIX · ARTIFACT.

- **Every cross-role message MUST be one of these forms**, emitted as a **JSON object** — never free prose.
- **Binds the orchestrator too** — `BRIEF` to dispatch, `FIX` to route — not only members.
- **Each form is a JSON object** keyed by a `"type"` discriminator (one of the six, uppercase).
- **Multi-value fields are JSON arrays.** What reads as a bulleted list is encoded as an array.
- **Some fields nest** one level: `BRIEF.spec`, `REVIEW.remarks[]`, `FINDING.options[]`, `FIX.failure` — objects/arrays-of-objects, not flattened strings.

## Wire format

- **Schema is the contract.** Each form's machine-readable shape lives as a JSON Schema under
  [`schemas/`](schemas/) (`brief` · `result` · `review` · `finding` · `fix` · `artifact`).
  `additionalProperties:false` — extra or renamed fields are rejected.
- **Omit empty optional fields** — don't send `null` or `[]`; leave the key out.
- **The per-form tables below are the authoring source** (field · meaning · constraint · examples);
  the schema is the enforcement source. They are kept in lock-step.

**Emit + validate (one command).** `scripts/hooks/Format-ProtocolForm.ps1` validates against the schema, canonicalizes key order, drops empty optional fields, writes the box file, and prints the pointer — `SendMessage` rejects non-conforming messages; do the work up front:

1. **Write the rough form JSON to a temp file** (rough order/casing is fine — the normalizer fixes it).
2. **Hand back in one step** (member → orch):
   `pwsh -NoProfile -File scripts/hooks/Format-ProtocolForm.ps1 -InputFile <file> -OutboxDir <outbox>`
   It validates, writes `<role>.<TYPE>.json` to your `outbox`, and **prints the exact
   `{ type, ref }` pointer**. Non-zero exit + a stderr message means it's invalid — fix and retry.
3. **Send that stdout VERBATIM** as the `SendMessage` body. (Omit `-OutboxDir` to just normalize a form
   to stdout — e.g. when the orchestrator writes a dispatch `BRIEF`/`FIX` to a member `inbox`, or to
   inline a full form for back-compat.)

```jsonc
// rough input (unordered, lowercase type, empty optionals)   ->   normalized output sent verbatim
{ "gate":["build ok","264/264"], "type":"result",                 {
  "changed":["A.cs"], "role":"backend", "notes":[] }                "type": "RESULT",
                                                                    "role": "backend",
                                                                    "changed": ["A.cs"],
                                                                    "gate": ["build ok", "264/264"]
                                                                  }
```

`role` (in `RESULT`/`REVIEW`) is one of: `contract` · `backend` · `frontend` · `infrastructure` · `testing` · `docs`.

---

## Message delivery — file + pointer (both directions)

Every cross-role message is a **file in the session directory** (durable payload) — `SendMessage` carries only a **pointer** that wakes the peer. Two boxes, symmetric:

| Box | Direction | Forms | File |
|---|---|---|---|
| **inbox** | orch → member · dispatch | `BRIEF` · `FIX` | `.team-process/sessions/<id>/inbox/<role>.<TYPE>.json` |
| **outbox** | member → orch · hand-back | `RESULT` · `REVIEW` · `FINDING` · `ARTIFACT` | `.team-process/sessions/<id>/outbox/<role>.<TYPE>.json` |

`<id>` = the session id (sanitized `-SetMarker -Team` name); `<TYPE>` = the form (e.g. `backend.BRIEF.json`, `backend.RESULT.json`).

1. **Write the normalized form** to the box: hand-back → the member runs
   `Format-ProtocolForm.ps1 -InputFile <file> -OutboxDir <outbox>` (one command writes its `outbox`
   file *and* prints the pointer — see *Emit + validate* above); dispatch → the orchestrator writes the
   member's `inbox`.
2. **Deliver the pointer** — exactly `{ "type": "<FORM>", "ref": "<ABSOLUTE path to the file>" }`, no
   other keys (the hand-back command prints this for you):
   - **Hand-back + re-dispatch** (member already live) → the `{ type, ref }` pointer is the `SendMessage`
     body.
   - **First dispatch** (the spawning `BRIEF`) → the spawn prompt names the inbox `ref` path and tells
     the member to read it (`SendMessage` cannot carry the form before the member exists).
   The guard validates the *referenced file* against its schema; a missing / malformed file or a
   `type`↔file mismatch is **blocked**.
3. **Peer reads by `ref`** (cross-worktree read).
   - **Hand-back:** the orchestrator folds the form into the run ledger, then **deletes** the outbox file
     (consumed).
   - **Dispatch:** the member reads its `BRIEF`/`FIX` and **leaves the inbox file in place** — it is the
     durable, resume-recoverable record of the task (overwritten only by a re-dispatch).

- **Orchestrator injects `<id>` and both box paths.** Every dispatch names the literal `<id>` value and
  the absolute `inbox`/`outbox` directory paths — members MUST use them verbatim, never derive `<id>`
  from the team name themselves.
- **Never message as terminal/chat prose.** Write the typed form to the box file first, then deliver the
  `{ type, ref }` pointer. A plain-text message or chat-embedded JSON is not a valid message.

- **Why a file.** Durable · auditable · survives compaction/reboot; ledger is source of truth; dispatched tasks recover from inbox on resume.
- **Absolute `ref`.** Worktree-isolated members have a separate filesystem — absolute path lets the peer read the file; a relative `ref` resolves against repo root.
- **Lane exemption.** Neither box is part of a member's code lane; the lane guard allows writes under
  `**/.team-process/sessions/*/outbox/**` (the lead writes the inbox from the main worktree, outside any
  lane file).
- **Back-compat.** A full typed form sent inline (no `ref`) still validates and is accepted.
- **Write-time guard.** The box-write guard (`Invoke-ProtocolFormGuard.ps1`) rejects any non-JSON or
  non-typed-form Write to an inbox/outbox at write time — not only when the pointer fires. Writing prose,
  markdown, or `.txt` to a box is blocked immediately.

---

## BRIEF — orch → role · dispatch

Written to the member's `inbox` and delivered by reference — see *Message delivery* above.

| Field | What belongs | Constraint | Examples |
|---|---|---|---|
| type | form discriminator | `"BRIEF"` | `"BRIEF"` |
| spec | owning spec `{path, gate}` | required; `path` = spec`#section`, `gate` = the acceptance gate it sets | `{"path":"docs/api/openapi.yaml#deployments","gate":"tile shows next-status badge"}` · `{"path":"docs/frontend/swimlane.md#collapse","gate":"chevron toggles the row"}` |
| lane | glob(s) the role may touch | array, ≥1; nothing outside it | `["frontend/dashboard/src/app/swimlane/**"]` · `["backend/Dashboard.Api/**","backend/shared/**"]` |
| task | the change to make | one line, imperative | `"Add a collapse chevron per service row"` · `"Extract the HTTP adapter from BackfillRunner"` |
| gate | self-verify set | array, ≥1; build + unit + lint | `["build","unit","lint"]` · `["build ok","ng test 18/18"]` |
| seed | diagnosis/theory to test first | optional; omit if none | `"check ToJsonPointer for DRY"` · `"suspect ETag tie-break ordering"` |

```json
{
  "type": "BRIEF",
  "spec": { "path": "docs/frontend/swimlane.md#collapse", "gate": "chevron toggles the row" },
  "lane": ["frontend/dashboard/src/app/swimlane/**"],
  "task": "Add a collapse chevron per service row",
  "gate": ["build", "unit", "lint"],
  "seed": "reuse the rate-limit popover pattern"
}
```

---

## RESULT — role → orch · hand-back

| Field | What belongs | Constraint | Examples |
|---|---|---|---|
| type | form discriminator | `"RESULT"` | `"RESULT"` |
| role | the reporting role | one of the role names | `"backend"` · `"frontend"` |
| changed | files touched | array, ≥1; in-lane only | `["GithubActionsAdapter.cs","BackfillRunner.cs"]` · `["swimlane.component.ts"]` |
| gate | actual gate outcomes | array, ≥1; real counts, never "should pass" | `["build ok","unit 12/12"]` · `["build ok","ng test 18/18","lint clean"]` |
| notes | key design decisions | optional array, ≤3 | `["extracted HTTP adapter"]` · `["coalesced failures into one incident"]` |
| follow | out-of-lane needs / deferred | optional array; omit if none | `["needs openapi delta for status-vector"]` · `["E2E deferred to #306"]` |
| block | blocker pointer | optional; `"none"` or `"see FINDING"` | `"none"` · `"see FINDING"` |

```json
{
  "type": "RESULT",
  "role": "backend",
  "changed": ["GithubActionsAdapter.cs", "BackfillRunner.cs"],
  "gate": ["build ok", "264/264 tests"],
  "notes": ["extracted HTTP adapter"],
  "block": "none"
}
```

---

## REVIEW — reviewer → orch · role-bar walk

Pre-implementation scoping *or* pre-testing peer review — same form.

| Field | What belongs | Constraint | Examples |
|---|---|---|---|
| type | form discriminator | `"REVIEW"` | `"REVIEW"` |
| role | the reviewing competency | a role name; reviewer ≠ that lane's implementer | `"backend"` · `"frontend"` |
| scope | lanes/files reviewed | array, ≥1; the change set in this competency | `["backend/fetcher/**"]` · `["BackfillRunner.cs","DeploymentMapper.cs"]` |
| checked | touched symbols × dimensions walked | array, ≥1; the full bar per symbol, not a skim | `["Run() 136 lines × SRP","Map() × DRY"]` · `["PollLoop × SOLID/smells"]` |
| verdict | the outcome | `"pass"` or `"changes-requested"` | `"pass"` · `"changes-requested"` |
| remarks | each issue `{smell, location, change}` | array of objects; **required when `changes-requested`, forbidden when `pass`**; cite the role's non-negotiables. When scoping = the refactor backlog | `[{"smell":"S1541 complexity","location":"BackfillRunner.cs:42","change":"extract cursor-advance"}]` |
| block | blocker pointer | optional; `"none"` or `"see FINDING"` | `"none"` · `"see FINDING"` |

```json
{
  "type": "REVIEW",
  "role": "backend",
  "scope": ["backend/fetcher/**"],
  "checked": ["BackfillRunner.Run() 136 lines × SRP", "DeploymentMapper.Map() × DRY"],
  "verdict": "changes-requested",
  "remarks": [
    { "smell": "S1541 cyclomatic complexity", "location": "BackfillRunner.cs:42", "change": "extract cursor-advance into a method" }
  ],
  "block": "none"
}
```

---

## FINDING — role → orch · blocker / contradiction / impossible

| Field | What belongs | Constraint | Examples |
|---|---|---|---|
| type | form discriminator | `"FINDING"` | `"FINDING"` |
| where | file or spec at fault | path or spec ref | `"docs/api/openapi.yaml#errors"` · `"BackfillRunner.cs:88"` |
| issue | the problem | one of: `"contradiction"` · `"impossible"` · `"missing input"` | `"contradiction"` · `"missing input"` |
| options | viable paths, each `{id, path}` | array of objects, ≥2 | `[{"id":"a","path":"return 409 on conflict"},{"id":"b","path":"return 422 with error body"}]` |
| need | the decision required | one line | `"Which status for a write conflict?"` · `"Confirm the retention window"` |

```json
{
  "type": "FINDING",
  "where": "docs/api/openapi.yaml#errors",
  "issue": "contradiction",
  "options": [
    { "id": "a", "path": "return 409 on conflict" },
    { "id": "b", "path": "return 422 with an error body" }
  ],
  "need": "Which status for a write conflict?"
}
```

---

## FIX — orch → role · fix-loop assignment

Written to the member's `inbox` and delivered by `{ type, ref }` pointer — see *Message delivery* above.

| Field | What belongs | Constraint | Examples |
|---|---|---|---|
| type | form discriminator | `"FIX"` | `"FIX"` |
| failure | the defect `{test, expect, actual}` | required object; `test` = exact failing id, `expect`/`actual` = behaviors | `{"test":"swimlane.spec.ts > collapses on click","expect":"chevron rotates 90°","actual":"no rotation"}` |
| suspect | likely layer / file | required; a route hint, not a fix | `"swimlane.component.ts toggle handler"` · `"PgListenBroadcaster base"` |

```json
{
  "type": "FIX",
  "failure": {
    "test": "swimlane.spec.ts > collapses on click",
    "expect": "chevron rotates 90°",
    "actual": "no rotation"
  },
  "suspect": "swimlane.component.ts toggle handler"
}
```

---

## ARTIFACT — contract → orch → consumers · settled interface

| Field | What belongs | Constraint | Examples |
|---|---|---|---|
| type | form discriminator | `"ARTIFACT"` | `"ARTIFACT"` |
| spec | committed contract path | committed, not chat | `"docs/api/openapi.yaml"` · `"frontend/extension/manifest.json"` |
| delta | resources / operations changed | array, ≥1 | `["+ GET /services/{id}/status-vector"]` · `["~ DeploymentEvent.effectiveStatus enum"]` |
| open | questions needing a decision | optional array; omit if none | `["pagination for status-vector?"]` |

```json
{
  "type": "ARTIFACT",
  "spec": "docs/api/openapi.yaml",
  "delta": ["+ GET /services/{id}/status-vector", "~ DeploymentEvent.effectiveStatus enum"],
  "open": ["pagination for status-vector?"]
}
```

---

## Rules

- `RESULT.gate` carries **actual** counts — a narrative claim is never accepted as a gate result.
- A design decision in `RESULT.notes` is **folded by the lead into `decisions[]`** (durable, surfaced on resume, published to the issue) — see [`process.md`](process.md) → *Decision record*; member reports, lead curates.
- A `BRIEF` **references** the role's typed form here (`RESULT`/`REVIEW`/…); it MUST NOT restate or
  invent a hand-back shape — restating competes with the protocol, itself a breach.
- A hand-back that is not valid typed-form JSON (not JSON, unknown `type`, extra/renamed fields,
  missing required fields, wrong value types) is returned **UNREAD** — the orchestrator **MUST** reply
  *re-emit as `RESULT`/`REVIEW`* and **MUST NOT** parse it.
- `REVIEW.verdict` is `"pass"` **only** with zero remarks; `"changes-requested"` requires ≥1 remark.
- `changes-requested` `REVIEW` → orchestrator routes each remark to the owning implementer; loop until every competency passes (→ [`process.md`](process.md) *Review loop*).
- Peer review precedes `testing`.
- A red gate surfaced by `testing` → orchestrator issues a `FIX` to the owning role; loop
  until green (see [`process.md`](process.md) *Fix loop*).
- Members **MUST NOT** commit/push/PR — hand back via `RESULT`; only the orchestrator integrates.
- Every cross-role message is a **file + pointer** (see *Message delivery* above) — dispatch via the
  `inbox`, hand-back via the `outbox`:
  - The typed form is written to the session box (orchestrator writes the `inbox`; member writes the `outbox`).
  - The pointer is `{ type, ref }` — delivered as the `SendMessage` body, or (for the spawning `BRIEF`) named in the spawn prompt.
  - A pointer whose referenced file is missing/malformed, or whose `type` disagrees with the file, is returned UNREAD.
