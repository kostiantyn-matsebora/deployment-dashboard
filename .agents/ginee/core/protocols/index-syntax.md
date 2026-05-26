---
audience: ai-engineer
load: on-demand
triggers: [idx, index-syntax, flat-record]
cap-bytes: 4096
reads-before-applying: [core/protocols/index-protocol.md]
---

# `.idx` syntax — compact DSL for flat-record indexes

**Load-on-demand.** Fetched when a role or `ai-engineer` first reads or writes any `local/index/*.idx` file in a session. Not needed for YAML index files (`api-matrix.yaml`, `ui-states.yaml`, `constraints.yaml`, `manifest.yaml`).

## Purpose

Highest-density readable format for flat-record collections (ADR rows, CR rows, scenario rows, glossary terms, mockup sections). Single shared spec replaces per-file ad-hoc markdown tables. Framework-internal — adopters never hand-author `.idx` files; `ai-engineer` writes them per recipes.

## When to use `.idx` vs YAML

| Data shape | Format |
|---|---|
| Flat records, every row same schema (ADR, CR, scenario, glossary, mockup section) | `.idx` |
| Nested trees (endpoint with method + statuses + wire-shape sub-tree; UI state with payload + visual + fixture) | `.yaml` |
| Single nested config (manifest, constraints by category) | `.yaml` |

If you would need a multi-line value or sub-list, switch to YAML.

## Grammar

```
# class: <class-name>
# schema: <field1> | <field2> | <field3> | <field-N>
# source: <path-or-glob>
# recipe: <recipe-id-or-'novel'>

<value1> | <value2> | <value3> | <value-N>
<value1> | <value2> | <value3> | <value-N>
...
```

- **Header** = exactly 4 lines, each starting with `# `, in the order shown.
- **Blank line** separates header from data.
- **Data rows** = one record per line.
- **Field separator** = ` | ` (space-pipe-space).
- **Field count** per data row MUST equal schema field count.
- **No multi-line values.** If a field needs a newline, switch to YAML.

## Cell conventions

| Symbol | Meaning | Example |
|---|---|---|
| `-` | Empty cell (no value) | `... \| - \| ...` |
| `a,b,c` | Multi-value (comma-separated, no spaces) | `200,401,403` |
| `\|` | Escaped literal pipe in content (rare) | `if A \\| B` |
| `@<path>` | Source file reference | `@docs/adr/0001.md` |
| `#<anchor>` | Section anchor within current source | `#login-flow` |
| `@<path>#<anchor>` | Combined path + anchor | `@docs/architecture.md#api-deployments` |

## Header fields

| Header line | Required | Meaning |
|---|---|---|
| `# class:` | yes | Class name (matches `manifest.yaml § indexed[].class`) |
| `# schema:` | yes | Pipe-separated field names in row order |
| `# source:` | yes | Single source path OR `source-glob: <glob>` for directory sources |
| `# recipe:` | yes | Built-in recipe id (`builtin:adr`) or `novel` |

Use `# source-glob:` instead of `# source:` when the source is a directory of files.

## Example — `adr-index.idx`

```
# class: adr
# schema: id | title | status | summary | source
# source-glob: docs/adr/*.md
# recipe: builtin:adr

ADR-0001 | Use PostgreSQL | accepted | Single primary, read replicas for analytics | @docs/adr/0001.md
ADR-0002 | Bearer JWT auth | accepted | Stateless sessions; 1h expiry | @docs/adr/0002.md
ADR-0003 | gRPC for service mesh | rejected | Stuck with REST; perf gap not material | @docs/adr/0003.md
```

## Parsing rules for consumers

- Trim leading/trailing whitespace per cell after splitting on ` | `.
- Treat any data line starting with `#` as a comment and skip (rare; reserve for future use).
- Empty data lines: skip.
- Validation: field count mismatch → flag the row as malformed (do not infer).
