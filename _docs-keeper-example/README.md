# docs-keeper-example

**Example host repo / pair-repo for [docs-keeper](https://github.com/kostiantyn-matsebora/docs-keeper).**
It is NOT a real product — it exists to exercise docs-keeper against a realistic multi-layer
project and to serve as a runnable example of an index-first documented repo.

The sample app inside is **Acme Stack** — a fictional parcel-tracking dashboard spread across
**frontend + backend + infrastructure + testing + documentation**.

## What docs-keeper sees here

This repo is a **clean docs baseline**: every `index.md` `children:` matches disk and the
`CLAUDE.md` "Sources of truth" registry matches the ROOT index, so docs-keeper's drift gate
reports green. Tests mutate a copy to prove drift is detected.

| docs-keeper feature | Exercised by |
|---|---|
| ROOT index + registry role-in-sync | `docs/index.md` ↔ `CLAUDE.md` § Sources of truth |
| Sub-index boundary (no descent) | `docs/api/index.md` |
| Nested descent into a no-index sub-dir | `docs/guides/*` (no `guides/index.md`) |
| Mixed file types | `.md`, `.yaml` (`docs/api/openapi.yaml`) |
| Content-bearing area READMEs (sweep-visible) | `frontend/` · `backend/` · `infrastructure/` · `testing/` |

## Try it (with docs-keeper checked out alongside)

```
# clean baseline -> exit 0
python3 ../docs-keeper/core/engine/cli.py --drift-only --repo-root .

# introduce drift, re-run -> exit 2 (block)
rm docs/getting-started.md
python3 ../docs-keeper/core/engine/cli.py --drift-only --repo-root . --enforce block
```

## Pairing test

`pairing_test.py` locates a docs-keeper checkout (`DOCS_KEEPER_DIR` env, or a sibling
`../docs-keeper`), imports its core engine, and asserts this repo is a clean baseline and
that drift is detected on a mutated copy. It **skips** with a clear message when docs-keeper
is not available alongside — no hard dependency.

```
python3 -m pytest            # runs the pairing test (skips if docs-keeper not found)
DOCS_KEEPER_DIR=/path/to/docs-keeper python3 -m pytest
```

The repo root prompt that docs-keeper reads is [`CLAUDE.md`](CLAUDE.md).
