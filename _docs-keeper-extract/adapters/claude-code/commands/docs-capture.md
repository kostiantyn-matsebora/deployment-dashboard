---
description: Record documentation-worthy content from the current session into a persistent capture file, surfaced and applied in a later session.
---

# /docs-keeper:docs-capture

Record doc-worthy content (decisions, conventions, constraints, intent) from this session.

Read and follow the bundled procedure **in full**:
[`spec/commands/docs-capture.md`](${CLAUDE_PLUGIN_ROOT}/spec/commands/docs-capture.md).
Write each entry via the bundled capture hook:

```
echo '{"content":"<one sentence>","suggestedDoc":"<relative-path-or-empty>"}' | \
  python3 "${CLAUDE_PLUGIN_ROOT}/hooks/cc_capture.py" --add-capture
```
