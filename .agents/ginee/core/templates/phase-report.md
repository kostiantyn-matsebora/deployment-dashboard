# Phase Report Template

<!--
  Scope:
  - Structured final report for any phase.
  Flow:
  - Specialists → report up to team-lead.
  - team-lead → consolidates to user.
  Usage:
  - Replace bracketed placeholders.
  - Drop any section with no content.
-->

---

## Phase: `<lifecycle phase | iteration-N | hand-off>`

**Role:** `<role name>` (`<alias>`)
**Task:** `<one-line task description>`
**Source:** `<TODO line | direct instruction | hand-off from <role>>`
**Status:** `Done | In-progress | Blocked | Hand-off`

## Files touched

| Path (absolute) | Delta (lines / chars) | Note |
|---|---|---|
| `<path>` | `+N / -M` | `<one-line why>` |

## Decisions made

| Decision | Rationale | Cites |
|---|---|---|
| `<short imperative>` | `<one sentence>` | `<FR-NN / NFR-NN / ADR-NNNN / mockup section>` |

## Verification log

| Command / check | Outcome | Note |
|---|---|---|
| `<command>` | `<exit code / pass-fail / count>` | `<one line if non-obvious>` |

- **Manual smoke** *(when user-facing surface touched)* — `<one line per new flow>`
- **Lossless self-check** *(for `ai-engineer` doc work)* — `<sample of rules / invariants spot-checked + result>`

## Open issues

- `<issue>` — `<who/what is blocked / what's ambiguous>`
- `<follow-up surfaced but not addressed>` — `<TODO? CR? ADR?>`

## Iteration breakdown (when run under the Iteration protocol)

| Sub-task | Estimate | Actual | Result |
|---|---|---|---|
| `<sub-task>` | `<min>` | `<min>` | `Done | In-progress | Not-started` |

## Next dispatch needed

- **Role:** `<role>` — **Reason:** `<one-line>` — **Scope:** `<one-line>`
- **Cross-domain hand-off** — attach a `core/templates/hand-off-note.md` instance.

## Stop-state (when interrupted)

- **Done.** `<sub-tasks completed, files touched>`
- **In-progress.** `<sub-task interrupted, partial state, concrete resume instructions>`
- **Not-started.** `<sub-tasks remaining in approved batch, original estimates intact>`
