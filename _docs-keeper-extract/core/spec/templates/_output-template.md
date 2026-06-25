# Documentation Report (template)

Fill-in report used by all docs-keeper commands. Emit every applicable slot; omit empty
slots — do not invent. `/docs-registry-sync` uses its own one-line synthesis (Mode D).

## Documentation Report

### Mode
A (index build) | B (authoring/revision) | C (consistency sweep) | D (registry sync)

### Command(s) invoked
- `/docs-<name>` <args>  ➜  <one-line outcome>

### Host rules loaded from
- <path>  ➜  quoted heading: "<verbatim heading>"

### Host registry (if Mode D ran)
- <path>  ➜  section heading: "<verbatim heading>" — <N entries before, M entries after>

### Descent summary (if Mode A ran)
- Target ➜ `<dir>/index.md`
- Deepest path reached ➜ `<sub>/<sub>/<file>`
- Files surfaced ➜ <count> (markdown <m>, non-markdown <n>)
- Boundaries encountered ➜ <count> (`<sub-a>`, `<sub-b>`, …)

### Walk-up trace (if Mode A ran)
- <target>      ➜  Write / Edit / propose-only — <one-line summary>
- <ancestor-1>  ➜  Edit (additive: +`/<child>` / collapse: many → `/<sub>`) / idempotent-no-op / propose-only
- <indexed-tree root reached at `<dir>`>

### Files touched
- <path>  ➜  Edit / Write / proposed-only — <one-line summary>

### Non-overwrite gate
- <path>  ➜  did-not-exist / edited-surgically / proposed-rewrite-awaiting-confirmation / blanket-permission-granted

### README classification (if any README encountered)
- <path>  ➜  content-bearing / legacy-navigation — <one-line rationale>

### Coverage map (if Mode D or C ran)
- ROOT indexes: <list>
- `<index>` `children:` resolves to: <paths>
- Ambiguous resolutions: <list, or "none">
- Duplicate coverage: <list, or "none">
- Uncovered authoritative files: <list>
- Un-listed content-bearing README.md: <list, or "none">
- Legacy navigation README.md: <list, or "none">

### Registry diff (if Mode D ran)
- ADD     `<path>` ➜  `<new bullet text>`
- UPDATE  `<path>` ➜  before: `<old>` / after: `<new>` / changed: <field>
- REMOVE  `<path>` ➜  reason: <index-deleted / no-longer-root / covered-by-index:<x> / file-deleted / legacy-readme>
- KEEP    `<path>` ➜  exact match

### Rule compliance
- [x] <rule 1 quoted from host>
- [x] <rule 2 quoted from host>
- [x] Extract over compact (or: N/A — file < 200 lines)

### Open questions
- Slug rendering pipeline (GFM/kramdown vs other) for `<dir>`?
- `<file>` references `<other>` which no longer exists — rename or remove?
- Hand-authored block "<heading>" in `<index>` — preserve verbatim, or owner approves replacement?
- Legacy navigation `README.md` at `<path>` — owner removes?
- Registry ordering for new entry `<path>` — append, or slot after `<sibling>`?

### Next steps (for owners)
- <craft>: confirm whether `<topic>` belongs here or moves to `<other>`.
- <craft>: anchor `<example>` in the contract.
