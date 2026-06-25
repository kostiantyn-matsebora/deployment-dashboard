# docs-capture — procedure

Record documentation-worthy content from the current session into a persistent capture
file, surfaced + applied in a later session.

> Platform-neutral procedure. The Claude Code adapter exposes it as `/docs-keeper:docs-capture`
> and wires the capture write to the bundled capture hook (`hooks/cc_capture.py --add-capture`).

## When to invoke

When the session produced any of:
- An architectural or design decision.
- A pattern, convention, or constraint adopted by the project.
- A non-obvious behaviour, workaround, or known limitation.
- A clarification of intent behind existing docs.

## Steps

1. **Identify capture candidates.** Scan the conversation for the categories above. Skip
   implementation details already visible in code; target the *why* and *what* that
   belongs in docs.
2. **For each candidate, write one capture entry** via the platform's capture hook with a
   JSON payload `{"content": "<one sentence>", "suggestedDoc": "<relative-path-or-empty>"}`:
   - `content` — one sentence, active voice, no filler. Max 80 chars.
   - `suggestedDoc` — nearest relevant doc path (e.g. `docs/SAD.md`), or `""` when unclear.
3. **Confirm to the user.** List what was captured:
   ```
   Captured N item(s):
     1. [manual] <content> → <suggestedDoc>
     2. [manual] <content>
   ```

## Report format rules (binding)

- One line per item. No prose paragraphs.
- `→ <doc>` only when `suggestedDoc` is non-empty.
- If nothing is worth capturing: `Nothing doc-worthy found in this session.`
