---
description: Revise an existing doc or author a new one against host authoring rules. Extract over compact for files >200 lines. Mode B of docs-keeper. Without a path, targets all uncommitted doc files.
argument-hint: [doc-path] [-- brief]
---

# /docs-keeper:docs-revise

Revise or author the resolved target doc(s) (`$ARGUMENTS`; empty → all uncommitted `*.md`).

Read and follow the bundled procedure **in full**:
[`spec/commands/docs-revise.md`](${CLAUDE_PLUGIN_ROOT}/spec/commands/docs-revise.md).
Honor the pre-flight gates in [`spec/role.md`](${CLAUDE_PLUGIN_ROOT}/spec/role.md).
