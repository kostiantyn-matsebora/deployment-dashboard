---
description: Build or refresh a directory's index.md (github/docs-style recursive-descent children list with sub-index boundaries, hierarchical, minimum-footprint), then walk UP the tree. Mode A of docs-keeper.
argument-hint: <directory-path>
---

# /docs-keeper:docs-index

Build or refresh the `index.md` for `$ARGUMENTS`, then walk UP every ancestor index.

Read and follow the bundled procedure **in full**:
[`spec/commands/docs-index.md`](${CLAUDE_PLUGIN_ROOT}/spec/commands/docs-index.md).
Honor the pre-flight gates in [`spec/role.md`](${CLAUDE_PLUGIN_ROOT}/spec/role.md)
(Non-overwrite policy · Host authoring rules · YAML quoting · README classification).
Report via the bundled Documentation Report template, Mode A.
