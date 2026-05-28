---
description: Revise an existing doc or author a new one against host authoring rules. Extract over compact for files >200 lines. Mode B of document-writer.
argument-hint: <doc-path> [-- brief]
model: sonnet
---

# /docs-revise

Revise or author `$ARGUMENTS`.

## Pre-flight (binding)

Inherited from `.claude/agents/document-writer.md`:

1. **Non-overwrite policy** § — every `Write` / `Edit` goes through the gate table.
2. **Hard rules — project authoring conventions** § — load host rules first; honor them over any default.

## Steps

1. **Read the brief + surrounding doc graph.** Identify owning craft and consumers. Escalate ambiguous contracts — do not invent.
2. **Audit against loaded host rules.** Tag every violation; fix structurally (table / numbered list / extracted sub-doc), not cosmetically.
3. **Extract over compact** for any doc > ~200 lines. Pull generic guidance to a referenced companion (e.g. `_glossary.md`, `_conventions.md`); leave the host doc to its specifics.
4. **Preserve every binding rule.** Compression drops style / filler / preamble only.
5. **Apply the non-overwrite policy.** `Edit` with the minimum diff for revisions; propose first for full rewrites.
6. **Refresh indexes.** After structural changes in a doc tree (added / removed / renamed / role-changed files), invoke `/docs-index <affected-directory>` — that command produces / refreshes the directory's `index.md` and chains onward to `/docs-registry-sync` as needed.

## Report

Use the **Documentation Report** template from `.claude/agents/_output-template.md`. Set Mode = B.
