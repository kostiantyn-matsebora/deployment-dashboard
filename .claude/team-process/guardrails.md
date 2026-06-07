# Standing guardrails & tool-output economy

Binding for **every role and mode** — inherited via the role anchor. Pairs with the typed
[communication protocol](protocol.md) and the orchestration playbook [`process.md`](process.md).

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
   See *Tool-output economy* below.
9. **Typed forms verbatim.** Every hand-back **MUST** match a [communication protocol](protocol.md)
   table exactly — fixed row order, no extra fields, within limits. Non-conforming hand-backs **MUST**
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
