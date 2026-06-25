# Fixtures

Pair-repo fixtures for exercising docs-keeper against realistic trees.

## `acme-stack/`

A fictional full-stack sample app — frontend + backend + infrastructure + testing +
documentation — used to test the engine and as a runnable example. Its `docs/` tree is a
**consistent baseline**: every `index.md` `children:` matches disk and the `CLAUDE.md`
"Sources of truth" registry matches the ROOT index, so the neutral drift gate reports clean.

What it exercises:

| Feature | Where |
|---|---|
| ROOT index + registry role-in-sync | `docs/index.md` ↔ `CLAUDE.md` § Sources of truth |
| Sub-index boundary (no descent) | `docs/api/index.md` |
| Nested descent into a no-index sub-dir | `docs/guides/*` (no `guides/index.md`) |
| Mixed file types | `.md`, `.yaml` (`docs/api/openapi.yaml`) |
| Content-bearing area READMEs (sweep-visible orphans) | `frontend/` · `backend/` · `infrastructure/` · `testing/` |

Try it:

```
# Clean baseline -> exit 0
python3 core/engine/cli.py --drift-only --repo-root fixtures/acme-stack

# Introduce drift, then re-run -> exit 2 (block)
rm fixtures/acme-stack/docs/getting-started.md
python3 core/engine/cli.py --drift-only --repo-root fixtures/acme-stack --enforce block
```

`integration_test.py` (next to this file) asserts the clean baseline and that drift is
detected after mutating a tmp copy — real filesystem, no mocks.
