---
description: Compose a ginee-compliant commit message with `Closes #N` inside the body and `Optimized-By: ai-engineer` trailer when threshold tripped.
argument-hint: <one-line summary>
---

Compose a git commit message for the current staged diff per ginee conventions. **Do not commit yet** — print the message; user reviews + confirms before `git commit`.

Summary: $ARGUMENTS

Rules:

1. **Subject line.** Conventional-commit prefix (`feat:` · `fix:` · `chore:` · `docs:` · `refactor:` · `test:`) + concise verb-first summary ≤ 72 chars.
2. **Body.** 1–3 paragraphs explaining *why*, not *what*. Cite the source — issue · TODO · CR · ADR · mockup section.
3. **`Closes #N` inside body** — never after the trailer block. Multiple closes: one per line, contiguous.
4. **`Optimized-By: ai-engineer` trailer** — required when commit touches `core/` · `adapters/` · `extras/` with > ~50 net-added lines per `core/process.md § Framework authoring`. Trailers must be on contiguous lines at the end; no blank line between them.
5. **`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`** as the final trailer.

Skeleton:

```
<type>: <subject ≤ 72 chars>

<body — why, not what. Cite the source.>

Closes #<N>

Optimized-By: ai-engineer          (when threshold tripped)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Verify trailer block parses — `git interpret-trailers --parse <message>` must list every trailer; a blank line between trailers breaks parsing.
