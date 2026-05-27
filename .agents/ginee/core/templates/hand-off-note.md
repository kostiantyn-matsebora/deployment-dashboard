# Hand-off Note Template

<!--
  Trigger:
  - Engineer discovers a root cause OUTSIDE their domain while working their own task
    (per core/protocols/cross-agent-handoff.md).
  Flow:
  - Discoverer → diagnoses fully.
  - Discoverer → does NOT fix.
  - Owning role → takes the hand-off.
  - Owning role → fixes.
  - Discoverer → reviews owner's fix.
  - Discoverer → removes any local workaround.
  Usage:
  - Replace bracketed placeholders.
  Audience:
  - Default audience is the owning role (LLM or human picking up the hand-off).
  - When the note is surfaced to a user decision-point (rare), wrap per
    core/templates/user-response.md — lead with the decision asked of the user.
-->

---

## Hand-off

**From:** `<discovering role>`
**To:** `<owning role>` (per `local/bindings.md` → "Project role boundaries")
**Date:** `<YYYY-MM-DD>`
**Originating task:** `<short description + TODO ref or dispatch context>`

## Symptom

<!-- Concrete and reproducible. -->

- Failing command / step: `<verbatim>`
- Expected: `<one line>`
- Actual: `<one line>`
- Reproduces on: `<commit SHA | branch | environment>`

## Root cause (verified)

<!--
  Scope:
  - The bug, in the owning role's domain.
  Cite:
  - File.
  - Line.
  - Chain of reasoning.
-->

```
<file:line> — <verbatim relevant excerpt or error>
```

- Why this is the cause: `<one or two sentences>`
- Why it's in the owning role's domain (not the discoverer's): `<one sentence — cite role boundary>`

## Evidence

| Step | Result |
|---|---|
| `<command / inspection>` | `<output / observation>` |

**Attach** logs / screenshots / diff snippets where load-bearing.

## What the discoverer tried and ruled out

| Hypothesis | Test | Result |
|---|---|---|
| `<hypothesis>` | `<what was checked>` | `Ruled out — <why>` |

<!-- Prevents the owner from re-running the same investigations. -->

## Workaround in place (if any)

- **Location:** `<file:line>`
- **What:** `<one line>`
- **Why:** `<one line — usually "unblock current task">`
- **Removal trigger:** `<who removes it + when — typically "discoverer, once owner's fix lands">`

**Labelling rules:**

- Code marker: `// WORKAROUND — see hand-off <date> to <owning role>`.
- Both roles acknowledge the workaround in their reports.

## Out-of-competence — discoverer will NOT fix

- **Hard stop.** Forbidden role-crossings table (`local/bindings.md` → "Project role boundaries").
- **Why.** Patching across domains causes silent contract drift.
- **Next.** Owning role takes it from here.

## Coordination

| Role | Action |
|---|---|
| Owner | Fixes; commit/PR references this hand-off note. |
| Discoverer | Reviews owner's fix; removes the workaround; removal commit references both. |
| Both | Stay engaged through resolution. |
