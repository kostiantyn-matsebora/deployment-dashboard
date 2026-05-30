# /docs-capture

Record documentation-worthy content from the current session into a persistent capture file.

## When to invoke

Invoke when the session produced any of:
- An architectural or design decision
- A pattern, convention, or constraint adopted by the project
- A non-obvious behaviour, workaround, or known limitation
- A clarification of intent behind existing docs

## Steps

1. **Identify capture candidates.** Scan the current conversation for the categories above. Skip implementation details already visible in code; target the *why* and *what* that belongs in docs.

2. **For each candidate, write one capture entry.** Run:
   ```
   echo '{"content":"<one sentence>","suggestedDoc":"<relative-path-or-empty>"}' | pwsh -NoProfile -NonInteractive -File "${CLAUDE_PROJECT_DIR}/scripts/hooks/Invoke-DocsKeeperMaintenance.ps1" -AddCapture
   ```
   - `content` — one sentence, active voice, no filler. Max 80 chars.
   - `suggestedDoc` — nearest relevant doc path (e.g. `docs/SAD.md`), or `""` when unclear.

3. **Confirm to the user.** After all entries are written, list what was captured in this format:
   ```
   Captured N item(s):
     1. [manual] <content> → <suggestedDoc>
     2. [manual] <content>
   ```

## Report format rules (binding)

- One line per item. No prose paragraphs.
- `→ <doc>` only when `suggestedDoc` is non-empty.
- If nothing is worth capturing, say: `Nothing doc-worthy found in this session.`
