# AI Engineer — Details

Companion to `core/roles/ai-engineer.md`. Elaborations only; kernel rules are binding.

## Principles — context engineering

1. **Always-loaded ≠ all-knowable.**
   - The project-instruction file is the always-loaded surface for the LLM client.
   - Keep it pointer-rich and short.
   - Push detail to lazy-loaded specs.
2. **One source of truth.**
   - Each rule lives in one file.
   - Other files cite via path + section.
3. **Cite, don't restate.**
   - A 1-line citation beats a re-explanation.
   - One update propagates without drift.
4. **Structure beats prose.** Bullets / tables / headings parse faster and tokenize tighter than paragraphs.
5. **Section atomicity.**
   - Every section reads standalone.
   - If section A depends on section B, cite B explicitly.
6. **Vocabulary consistency.** One term per concept across all docs.
7. **Front-load instructions.**
   - Most important content first.
   - LLM attention is non-uniform.
8. **Imperative voice for rules.** "Do X." / "Never Y." — not "It is recommended that you should consider…".
9. **Forbidden actions as lists.** Consolidate negations into one block per role.
10. **ASCII first.** Avoid unusual unicode that wastes tokens or breaks tokenizers.

## File splitting

**Split a doc when** any of:

- Single doc exceeds context-budget threshold.
- Doc mixes always-needed with rarely-needed content.

### Triggers

| Trigger | Action |
|---|---|
| File > ~15K chars AND mixes generic + project-specific content | <ol><li>Extract generic part to a new sibling file.</li><li>Replace with pointer block.</li><li>Update cross-references.</li></ol> |
| Same long rule cited from 3+ places | <ol><li>Move to own file.</li><li>Replace each site with cross-reference.</li></ol> |
| Role file > ~10K chars AND has discipline-specific deep sections | <ol><li>Extract deep sections to `core/roles/<role>-<topic>.md` siblings (or `local/roles/<role>-<topic>.md` for project-local roles).</li><li>Role file links to them.</li></ol> |
| Skill / prompt bundling unrelated concerns | <ol><li>Split into one-skill-per-concern.</li><li>Orchestrator loads only what's needed.</li></ol> |

### Post-split checklist

- Update any index / memory file (if applicable).
- Verify all cross-references resolve.
- Confirm always-loaded surface shrank by the moved amount.

### Layout

When a split produces new files, you MAY group them in a subdirectory rather than flat-listing next to the parent.

- **Default.** Sibling files next to the parent when only one or two new files are spawned.
- **Allowed.** Subdirectory grouping when 2+ split files share a concern (e.g., `docs/process/` for process specs, `docs/roles/` for role deep-dives).
- **Cap.** Maximum **2-3 directory levels including the parent**.
  - OK: `docs/` → `docs/process/` → `docs/process/<file>.md`.
  - NOT OK: `docs/process/governance/cycles/<file>.md` — exceeds the cap.
- **Why the cap.**
  - Deeper nesting hurts discoverability.
  - Deeper nesting inflates cross-reference paths.
  - Flat sometimes beats deeply nested.

## Anti-patterns

- Same rule restated in N files → consolidate to one + cite from N−1.
- Multi-paragraph prose where bullets / table fit.
- Vocabulary drift (same concept, different word per file).
- Always-loaded project-instruction file carrying lazy-loadable detail.
- Section requiring a prior section to be readable (atomicity violation).
- Front-matter bloated with every possible action (vs concise charter).
- Negation lists scattered across sections.
- Skill / prompt bundling N concerns into one file.

## Project extraction recipes

You own the project knowledge index under `local/index/`. Full protocol: `core/index-protocol.md`. `.idx` grammar: `core/index-syntax.md`. Templates: `core/templates/index/`. Protocol covers two source categories — **doc** (D13 baseline) and **code** (D15 extension); same machinery (manifest + SHA-256 + recipes + lossless rule).

### Doc-category recipes (D13)

| Source doc | Recipe id | Extracted to | Recipe + extraction tips |
|---|---|---|---|
| Architecture doc (`docs/architecture.md`, `docs/sad.md`) | `builtin:architecture` | `architecture.idx`, `architecture-fr.idx`, `api-matrix.yaml`, `ui-states.yaml`, `constraints.yaml`, `glossary.idx` | <ul><li>FR table → `architecture-fr.idx` (id + title + 1-line summary + source anchor).</li><li>NFR table → `constraints.yaml` keyed by category (latency, cost, retention, availability, statelessness, security, ...); record budget + source-anchor + per-role-impact bullets.</li><li>API contract → `api-matrix.yaml` (endpoints × method × status with wire-shape-ref + fixture-ref).</li><li>UI-state enumeration → `ui-states.yaml` (name + wire-shape + visual + fixture-ref + source-anchor).</li><li>Domain glossary → `glossary.idx`.</li><li>Top-level sections + component map → `architecture.idx` (kind=section or kind=component).</li><li>Grab: identifiers, one-line statements, anchors. Leave behind: prose explanations, motivation, rejected alternatives.</li></ul> |
| Mockup (HTML/CSS/JS, single file or directory) | `builtin:mockup` | `mockup-index.idx`, `ui-states.yaml` | <ul><li>Per documented section → row in `mockup-index.idx` (section name + invariant + `file:line` location + source anchor).</li><li>Each documented UI-state example payload → `ui-states.yaml` entry (cross-link with architecture-doc state where one exists).</li><li>Grab: section names, invariants, required-field lists, state sets, file:line refs. Leave behind: CSS rules, full markup, styling commentary.</li></ul> |
| ADR directory (`docs/adr/*.md`) | `builtin:adr` | `adr-index.idx` (also reusable for RFC, design-decision, any-decision-record class) | <ul><li>Per ADR file → row (id + title + status + 1-line decision summary + source path).</li><li>Body NOT copied.</li><li>Grab: id, title, status, one-line "we decided X". Leave behind: motivation, alternatives, full consequences narrative.</li></ul> |
| CR directory (`docs/cr/*.md`) | `builtin:cr` | `cr-index.idx` | <ul><li>Per CR file → row (id + title + status + target FR/NFR comma-list + source path).</li><li>Grab: id, title, status, what FRs/NFRs it changes. Leave behind: full diff, full justification.</li></ul> |
| Scenario directory (`docs/scenarios/*.md`, `tests/scenarios/*.md`) | `builtin:scenario` | `scenario-index.idx` | <ul><li>Per scenario file → row (id + feature label + FR/NFR cited + mockup anchor + fixture path + source).</li><li>Grab: identifiers, feature label, cross-references. Leave behind: step-by-step Gherkin body.</li></ul> |
| Project-instruction file (`CLAUDE.md` etc.) | — | — | Not indexed (small, already loaded by adapter pointer). |
| Diagrams (binary images, drawio, mermaid) | — | — | Not indexed (binary; path-only in `local/framework.config.yaml`). |

### Code-category recipes (D15)

| Source | Recipe id | Extracted to | Recipe + extraction tips |
|---|---|---|---|
| Package manifests + lockfiles + Dockerfiles (`package.json`, `*.csproj`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `*.gemspec`, lockfiles, `Dockerfile`) | `builtin:package-manifest` | `stack.yaml` | <ul><li>Group by tier (server / client / mobile / ml / data) inferred from path heuristics (`backend/` → server, `frontend/` → client, `mobile/` → mobile, etc.).</li><li>Per tier: **summary-only** — language + runtime + framework + primary libs (ORM/state-lib/data-store, 1–3 lines) + `dep-count` + `dev-dep-count` + Dockerfile FROM image + source paths (manifest + lockfile + Dockerfile).</li><li>**No per-dep listing.** Direct deps stay in the manifest source; roles read the manifest when bumping / adding / investigating a specific dep.</li><li>Grab: tier identity, primary frameworks/libs, declared counts, source paths. Leave behind: every package name + every pinned version (those are the manifest's job). Compression target ≤ 0.15.</li></ul> |
| Container orchestration (`docker-compose*.yml`, Helm charts, `k8s/**/*.yaml`) + IaC (`terraform/**/*.tf`, `pulumi/**`, Bicep) | `builtin:container-orchestration` (+ `builtin:iac` for TF/Pulumi/Bicep) | `topology.yaml` | <ul><li>Per service: **inventory-only** — name + image + tier + role + source-anchor. Nothing more.</li><li>Cross-cutting: network-topology one-liner (e.g. "single bridged network, internal-only except gateway"), gateway summary (ingress scheme + host port), volume-summary (named volumes count + anchor).</li><li>IaC summary: tool + cloud + state-backend + module-count + source-root. No per-resource-group / per-module listing.</li><li>**Drop:** per-service ports / depends_on / replicas / resources / env-vars / init-scripts (env-vars already in `runtime-facts.yaml`; the rest stays in compose / Helm / k8s source). Roles read the source file via anchor when authoring or debugging deployment.</li><li>Grab: service inventory + topology shape. Leave behind: anything compose / Helm / k8s already says in machine-parseable form. Compression target ≤ 0.15.</li></ul> |
| Build / test / lint / deploy command sources (`Makefile`, `package.json § scripts`, `pyproject.toml § tool.poe`, `justfile`, `local/framework.config.yaml § test-runners`, CI workflow steps) | `builtin:commands` | `commands.yaml` | <ul><li>Group by category (build / test / lint / format / deploy / dev).</li><li>Per command: name + cmd + wd + tool + scope (for test) + env (for deploy) + source-anchor.</li><li>**`lint.docs` slot (D22)** — when a doc/prose linter is invocable (e.g. `npm run lint:docs`, `vale docs/`, `markdownlint-cli2 "**/*.md"`), record under `lint.docs`. Roles authoring adopter markdown invoke this command at Phase 5 / report-as-done. If no command exists, leave the slot unset and surface a recommendation in the discovery report (markdownlint baseline, vale for prose).</li><li>Grab: named entry points (npm scripts, make targets, just recipes, test-runner paths from framework.config.yaml). Leave behind: ad-hoc one-liners in READMEs, arbitrary inline shell in CI `run:` blocks. CI step → only when it invokes a project-defined named command.</li></ul> |
| Lint / formatter / pre-commit configs (`.editorconfig`, ESLint config, Prettier config, Black/Ruff config, dotnet-format settings, golangci-lint, husky, commitlint, `.gitignore`, **markdown / prose linters** — `.markdownlint.json`, `.markdownlint-cli2.{jsonc,yaml}`, `.vale.ini`, `proselint.cfg`, `.prettierrc` markdown rules) | `builtin:conventions` | `conventions.yaml` | <ul><li>Formatter block: indent + line-endings + max-line-length + trim-trailing + final-newline (from .editorconfig + per-tool overrides).</li><li>Linters: per-tool + severity-default + customized rules with severity (`off`/`warn`/`error`).</li><li>**Doc-style block (D22)** — record presence + path of any markdown / prose linter config; surfaces to roles authoring adopter docs via `core/doc-authoring-protocol.md`.</li><li>Naming: branch pattern + commit-message style.</li><li>Pre-commit hooks + ignored-paths highlights.</li><li>Grab: customized rules that change adopter-authored output. Leave behind: defaults the tool ships with (roles know tool defaults). Comments explaining "why" — anchor only.</li></ul> |
| Env-file schemas + declared env-vars (`.env.example`, `docker-compose` env blocks, `k8s` envFrom, `appsettings.Development.json` placeholders, configuration classes flagged runtime-bound) | `builtin:runtime-facts` | `runtime-facts.yaml` | <ul><li>Per env-var: name + required + default + secret + tier + consumed-by + source-anchor + notes (format hints).</li><li>Cross-cutting: secrets-store (local-dev + cloud) + config-validation approach.</li><li>**Never read real `.env` or production appsettings — values are secrets.** Schema lives in `.env.example`; real values stay in their files.</li><li>Compose / k8s declared env → in scope; literal values redacted if secret-looking. Application-code-read env-vars cross-referenced with declaration.</li></ul> |
| Repo directory tree + per-dir READMEs | `builtin:repo-structure` | `repo-map.idx` | <ul><li>Per top-level directory → row: `path \| purpose \| owner-role \| category`.</li><li>Nested subtree → row only when ownership / purpose differs from parent.</li><li>Grab: directory purpose (from README or inferred from contents) + owning cardinal (from `local/bindings.md` or detected stack). Leave behind: file inventory (the index is a map, not a manifest).</li></ul> |
| Novel class (custom CI workflow class, monorepo-specific tool config, unfamiliar infrastructure tool, doc class not pre-covered like RFC variant / runbook / threat-model / model-card / etc.) | `inline:<class>` | `<class>-index.idx` (flat records) OR `<class>.yaml` (nested) — new template authored by you | See § Novel-class recipe below. |

### Novel-class recipe

When you encounter an adopter doc class not covered by a built-in recipe (or the user pre-declared `template: novel` in `framework.config.yaml § index.classes`):

1. **Resolve the consumer FIRST** (per `core/index-protocol.md § Consumer coupling`). Check, in priority order:
   - `local/framework.config.yaml § index.classes[].consumed-by` — adopter pre-declaration.
   - `local/bindings.md § Project-specific index citations` — adopter-side wiring to cardinal kernels.
   - Interactive — `team-lead` already asked the user during discovery; if not, escalate back.
   - **No consumer → SKIP extraction.** Log the skipped class; do not write an index file; do not add a manifest entry. The class will sit in source; the discovery report flags the skip with the detection heuristic so the adopter can wire later via `@ai-engineer extract <class>`.
2. **Sample 3–5 files** in the class. Read the full body of each.
3. **Identify signal structure:**
   - What fields repeat across files?
   - What's the unit of indexing — per-file, per-section, per-row?
   - Are values flat strings or nested sub-trees?
4. **Pick the format:**
   - Flat-record uniform shape (every "thing" has the same fields) → `.idx` per `core/index-syntax.md`.
   - Genuinely nested (sub-trees with arrays/maps) → YAML.
5. **Propose a per-record schema** of 3–7 fields max — typically `id | title | status | key-signal | source` for flat records. Prefer fewer fields; add only what at least one consumer role will read. (Reading-role identity now known from step 1 — bias schema to their needs.)
6. **Emit two files:**
   - Template at `core/templates/index/<class>-index.<ext>` (header block + 1–2 example rows showing shape + brief recipe comment + lossless rule).
   - Populated index at `local/index/<class>-index.<ext>`.
7. **Record the recipe inline** in `local/index/manifest.yaml § indexed[]`, INCLUDING `consumed-by`:
   ```yaml
   - class: <class>
     template: novel
     recipe: |
       <one-paragraph description of what to extract per file>
     source-glob: <glob>
     file-count: <N>
     sha256-by-file: { ... }
     indexed-on: <date>
     index-files: [<class>-index.<ext>]
     source-bytes: <N>
     index-bytes: <N>
     compression: <N/N>
     consumed-by: [<role>, ...]            # REQUIRED — from step 1
   ```

Bodies are NOT copied. Source path + anchor cited per row. Compression target ≤ 0.25 for list-of-records novel classes (per `core/index-protocol.md § Compression floor`).

### Lossless sample-and-check

After every extraction or re-extraction:

1. **Existence check** — pick **5 random items per affected index file** (or all items if the file has < 5 entries). Open the cited source path at the cited anchor. Verify the source still has the item at that location:
   - **Doc:** FR / NFR / endpoint / state / ADR / CR / scenario / glossary term.
   - **Code:** declared dependency / service / port / command / convention rule / env-var / top-level directory.
2. **Compression check** — per `core/index-protocol.md § Compression floor`:
   - Measure `index-bytes = sum(size(local/index/<file>) for file in index-files)` + `source-bytes = sum(size(source) for source in source-glob expansion)`.
   - Compute `compression = index-bytes / source-bytes`. Record all three in `manifest.yaml § indexed[]` for this entry.
   - **Reject** any extraction where `compression ≥ 0.5`. Rewrite the recipe to drop bulk OR mark the class `template: read-source-directly` (no index file produced; role kernels cite source path via `repo-map.idx`).
   - Per-class targets:
     - Prose-heavy classes (architecture, adr, cr) — ≤ 0.15.
     - List-of-records (scenario, ui-states, api-matrix, constraints, glossary, mockup) — ≤ 0.25.
     - Already-structured config inventory (stack, topology, commands, conventions, runtime-facts, repo-map) — ≤ 0.15. **Inventory-only** — record existence + anchors, not re-encoded bodies.
3. **On any miss** (existence OR compression) → revert the affected index file(s) and re-plan. Do not commit partial extractions.

Special checks:

- Glob sources → confirm `file-count` in manifest matches actual file count.
- SHA-256 values → recompute and compare with what you wrote.
- Compression values → recompute byte sizes and confirm `compression < 0.5` per class.

## Process integration

Invoked **between** lifecycle phases when:

- User request explicitly targets AI-asset or doc optimization.
- `solution-architect` flags "this doc is getting unwieldy" in their final report.
- Periodic maintenance (release cadence, post-large-feature cleanup).
- Phase 8 post-acceptance doc-optimization hook fires (per `core/process.md` § Phase 8 — User approval).

Coordination with `solution-architect`:

- Use standard cross-agent handoff (per `core/process.md` § Cross-agent handoff — diagnose ≠ fix).
- On noticing a semantic issue mid-optimization:
  1. Flag.
  2. Hand off.
  3. **Do not** fix.
