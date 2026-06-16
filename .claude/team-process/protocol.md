# Communication protocol

The typed forms every cross-role message uses. Inherited by every role — members emit/read them; the
orchestrator emits `BRIEF`/`FIX` and reads the rest. Part of the team-process kit core; the
orchestrator drives the phases that exchange these in [`process.md`](process.md).

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

**Emit + validate.** Build the JSON, then validate/normalize it with
`scripts/hooks/Format-ProtocolForm.ps1` — it validates against the schema (plus the one cross-field
rule), canonicalizes key order, drops empty optional fields, and pretty-prints. The `SendMessage`
guard rejects any non-conforming message.

1. **Write the form JSON to a temp file** (rough order/casing is fine — the normalizer fixes it).
2. **Normalize:** `pwsh -NoProfile -File scripts/hooks/Format-ProtocolForm.ps1 -InputFile <file>`
   (or pipe the JSON in via stdin). Non-zero exit + a stderr message means it's invalid — fix and retry.
3. **Send the stdout verbatim** as the `SendMessage` body — *or*, for a member OUTPUT form, write it to
   the session outbox and send a pointer instead (see *Hand-back delivery* below).

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

## Hand-back delivery — file + pointer (member → orch)

A member's OUTPUT form (`RESULT` · `REVIEW` · `FINDING` · `ARTIFACT`) is delivered as a **file in the
session directory**, not inline in the message. The file is the durable payload; `SendMessage` carries
only a pointer that wakes the orchestrator. (`BRIEF`/`FIX` are orchestrator dispatch — unchanged.)

1. **Write the normalized form** to the outbox in the member's own worktree:
   `.team-process/sessions/<id>/outbox/<role>.<TYPE>.json` — `<id>` = the `team_name` sanitized,
   `<TYPE>` = the form (e.g. `backend.RESULT.json`).
2. **Send the pointer** as the `SendMessage` body — exactly `{ "type": "<FORM>", "ref": "<ABSOLUTE path
   to the file>" }`, no other keys. The guard validates the *referenced file* against its schema; a
   missing / malformed file or a `type`↔file mismatch is **blocked**.
3. **Orchestrator drains.** Reads the file by `ref` (cross-worktree read), folds it into the run ledger,
   then deletes the outbox file.
- **Orchestrator injects `<id>` and outbox path.** Every BRIEF includes the literal `<id>` value and the absolute path to the outbox directory — members MUST use them verbatim, never derive `<id>` from the team name themselves.
- **Never hand back as a terminal/chat message.** Write the typed form to the outbox file first, then send the `{ type, ref }` pointer. A plain-text message or chat-embedded JSON is not a valid hand-back.

- **Why a file.** Durable · auditable · survives a compacted or dropped session — the ledger, not the
  conversation, is the source of truth.
- **Absolute `ref`.** Worktree-isolated members have a separate filesystem; the absolute path lets the
  orchestrator read the file. A relative `ref` resolves against the repo root.
- **Lane exemption.** The outbox is not part of a member's code lane; the lane guard allows writes under
  `**/.team-process/sessions/*/outbox/**`.
- **Back-compat.** A full typed form sent inline (no `ref`) still validates and is accepted.
- **Write-time guard.** The outbox-write guard (`Invoke-ProtocolFormGuard.ps1`) rejects any non-JSON or non-typed-form Write to the outbox at write time — not only when the pointer SendMessage fires. Writing prose, markdown, or `.txt` to the outbox is blocked immediately.

---

## BRIEF — orch → role · dispatch

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
- A `BRIEF` **references** the role's typed form here (`RESULT`/`REVIEW`/…); it MUST NOT restate or
  invent a hand-back shape — restating competes with the protocol, itself a breach.
- A hand-back that is not valid typed-form JSON (not JSON, unknown `type`, extra/renamed fields,
  missing required fields, wrong value types) is returned **UNREAD** — the orchestrator **MUST** reply
  *re-emit as `RESULT`/`REVIEW`* and **MUST NOT** parse it.
- `REVIEW.verdict` is `"pass"` **only** with zero remarks; `"changes-requested"` requires ≥1 remark.
- A `changes-requested` `REVIEW` → orchestrator routes each remark to the owning implementer;
  loop until every competency `pass`es (see [`process.md`](process.md) *Review loop*). Peer review precedes `testing`.
- A red gate surfaced by `testing` → orchestrator issues a `FIX` to the owning role; loop
  until green (see [`process.md`](process.md) *Fix loop*).
- Members **MUST NOT** commit/push/PR — hand back via `RESULT`; only the orchestrator integrates.
- A member OUTPUT form is handed back as a **file + pointer** (see *Hand-back delivery*):
  - The typed form is written to the session outbox.
  - The `SendMessage` body is the `{ type, ref }` pointer.
  - A pointer whose referenced file is missing/malformed, or whose `type` disagrees with the file, is returned UNREAD.
