---
description: Sync the host's "Sources of truth" registry to the current set of per-directory index.md indexes. Mode D of docs-keeper.
argument-hint: [--propose-only]
---

# /docs-keeper:docs-registry-sync

Sync the host's "Sources of truth" registry to the current `index.md` set.

Read and follow the bundled procedure **in full**:
[`spec/commands/docs-registry-sync.md`](${CLAUDE_PLUGIN_ROOT}/spec/commands/docs-registry-sync.md).
Surgical writes only (Edit preferred; byte-preserving Write fallback). Output is the
Mode-D synthesized line, NOT the Documentation Report template.
