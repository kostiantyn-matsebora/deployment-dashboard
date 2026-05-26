---
audience: ai-engineer
load: on-demand
triggers: [ai-engineer-details, context-economy, file-splitting, anti-patterns, extraction-recipes]
cap-bytes: 18432
reads-before-applying: []
---

# AI Engineer — Details

Companion to `core/roles/ai-engineer.md`. Elaborations only; kernel rules are binding.

## Principles — context engineering

1. **Always-loaded ≠ all-knowable.** Keep the project-instruction file pointer-rich + short; push detail to lazy-loaded specs.
2. **One source of truth.** Each rule lives in one file; others cite by path + section.
3. **Cite, don't restate.** One update propagates without drift.
4. **Structure beats prose.** Bullets · tables · headings parse + tokenize tighter than paragraphs.
5. **Section atomicity.** Every section reads standalone; cite prerequisites explicitly.
6. **Vocabulary consistency.** One term per concept across all docs.
7. **Front-load instructions.** Most important content first; LLM attention is non-uniform.
8. **Imperative voice for rules.** "Do X." / "Never Y." — not "It is recommended that…".
9. **Forbidden actions as lists.** Consolidate negations into one block per role.
10. **ASCII first.** Avoid unusual unicode that wastes tokens or breaks tokenizers.

## File splitting

| Trigger | Action |
|---|---|
| File > ~15K chars AND mixes generic + project-specific | Extract generic part to sibling file · replace with pointer block · update cross-refs |
| Same long rule cited from 3+ places | Move to own file · replace each site with cross-reference |
| Role file > ~10K chars with discipline-specific deep sections | Extract to `core/roles/<role>-<topic>.md` sibling (or `local/roles/` for project-local) · link from kernel |
| Skill / prompt bundles unrelated concerns | Split one-skill-per-concern; orchestrator loads only what's needed |

**Post-split checklist:** update index / memory · all cross-refs resolve · always-loaded surface shrank by the moved amount.

**Layout cap.** Max 2–3 directory levels including parent. OK: `docs/process/<file>.md`. NOT OK: `docs/process/governance/cycles/<file>.md`. Default to sibling files; subdirectory grouping when 2+ split files share a concern.

## Anti-patterns

- Same rule restated in N files → consolidate; cite from N−1.
- Multi-paragraph prose where bullets / table fit.
- Vocabulary drift — same concept, different word per file.
- Always-loaded project-instruction file carrying lazy-loadable detail.
- Section requiring a prior section to be readable (atomicity violation).
- Front-matter bloated with every possible action.
- Negation lists scattered across sections.
- Skill / prompt bundling N concerns into one file.

## Project extraction recipes

You own the project knowledge index under `local/index/`. Full protocol: `core/protocols/index-protocol.md`. `.idx` grammar: `core/protocols/index-syntax.md`. Templates: `core/templates/index/`. Protocol covers two source categories — **doc** and **code**; same machinery (manifest + SHA-256 + recipes + lossless rule).

### Doc-category recipes

| Source | Recipe id | Extracted to | Grab / leave behind |
|---|---|---|---|
| Architecture doc (`docs/architecture.md` · `docs/sad.md`) | `builtin:architecture` | `architecture.idx` · `architecture-fr.idx` · `api-matrix.yaml` · `ui-states.yaml` · `constraints.yaml` · `glossary.idx` | FR table → `architecture-fr.idx` (id + title + 1-line summary + anchor). NFR table → `constraints.yaml` keyed by category (latency · cost · retention · availability · statelessness · security) with budget + per-role-impact. API contract → `api-matrix.yaml` (endpoint × method × status + wire-shape + fixture refs). UI-state enum → `ui-states.yaml`. Glossary → `glossary.idx`. Top-level sections + component map → `architecture.idx`. **Leave:** prose · motivation · rejected alternatives. |
| Mockup (HTML/CSS/JS, single file or dir) | `builtin:mockup` | `mockup-index.idx` · `ui-states.yaml` | Per section → row (name + invariant + `file:line` + anchor). Each UI-state payload → `ui-states.yaml` (cross-link architecture-doc states). **Leave:** CSS rules · full markup · styling commentary. |
| ADR directory (`docs/adr/*.md`) | `builtin:adr` | `adr-index.idx` (reusable for RFC / design-decision / any-decision-record) | Per file → row (id + title + status + 1-line "we decided X" + source path). Body NOT copied. **Leave:** motivation · alternatives · consequences narrative. |
| CR directory (`docs/cr/*.md`) | `builtin:cr` | `cr-index.idx` | Per file → row (id + title + status + target FR/NFR comma-list + source). **Leave:** full diff · justification. |
| Scenarios (`docs/scenarios/*.md` · `tests/scenarios/*.md`) | `builtin:scenario` | `scenario-index.idx` | Per file → row (id + feature label + FR/NFR cited + mockup anchor + fixture path + source). **Leave:** Gherkin body. |
| Project-instruction file · diagrams | — | — | Not indexed — pointer-loaded / binary; path-only in `framework.config.yaml`. |

### Code-category recipes

Compression target ≤ 0.15 for all code recipes (inventory-only).

| Source | Recipe id | Extracted to | Grab / leave behind |
|---|---|---|---|
| Manifests + lockfiles + Dockerfiles (`package.json` · `*.csproj` · `pyproject.toml` · `Cargo.toml` · `go.mod` · `pom.xml` · `*.gemspec` · lockfiles · `Dockerfile`) | `builtin:package-manifest` | `stack.yaml` | Group by tier (server / client / mobile / ml / data) via path heuristics. Per tier: summary-only — language · runtime · framework · primary libs (ORM / state-lib / data-store, 1–3 lines) · `dep-count` · `dev-dep-count` · Dockerfile FROM · source paths. **No per-dep listing.** Roles read the manifest when bumping a specific dep. |
| Orchestration (`docker-compose*.yml` · Helm · `k8s/**/*.yaml`) + IaC (`terraform/**/*.tf` · `pulumi/**` · Bicep) | `builtin:container-orchestration` (+ `builtin:iac`) | `topology.yaml` | Per service: inventory-only — name + image + tier + role + anchor. Cross-cutting: network-topology one-liner · gateway (ingress scheme + host port) · volume-summary (named-volumes count + anchor). IaC summary: tool · cloud · state-backend · module-count · source-root. **Drop:** per-service ports / depends_on / replicas / env-vars (already in `runtime-facts.yaml`). |
| Command sources (`Makefile` · `package.json § scripts` · `pyproject.toml § tool.poe` · `justfile` · `framework.config.yaml § test-runners` · CI workflow steps) | `builtin:commands` | `commands.yaml` | Group by category (build / test / lint / format / deploy / dev). Per command: name · cmd · wd · tool · scope (test) · env (deploy) · anchor. **`lint.docs` slot** — record any doc / prose linter command (markdownlint · vale · proselint); surfaced to authors at Phase 5 / report-as-done. Unset → discovery report recommends baseline. **Leave:** ad-hoc one-liners in READMEs · arbitrary CI `run:` shell. |
| Lint / formatter / pre-commit configs (`.editorconfig` · ESLint · Prettier · Black/Ruff · dotnet-format · golangci-lint · husky · commitlint · `.gitignore` · markdown/prose linters — `.markdownlint*` · `.vale.ini` · `proselint.cfg`) | `builtin:conventions` | `conventions.yaml` | Formatter block (indent · line-endings · max-line-length · trim-trailing · final-newline). Linters: per-tool + severity-default + customized rules with severity. **Doc-style block** — record markdown/prose linter config presence + path. Naming: branch pattern + commit-message style. Pre-commit hooks + ignored-paths. **Leave:** tool-default rules. |
| Env schemas (`.env.example` · compose env-blocks · k8s envFrom · `appsettings.Development.json` placeholders · runtime-bound config classes) | `builtin:runtime-facts` | `runtime-facts.yaml` | Per env-var: name · required · default · secret · tier · consumed-by · anchor · notes. Cross-cutting: secrets-store (local + cloud) + config-validation. **Never read real `.env` / production appsettings** — values are secrets. Schema-only; redact secret-looking values from compose/k8s declared env. |
| Repo tree + per-dir READMEs | `builtin:repo-structure` | `repo-map.idx` | Per top-level dir → row (`path \| purpose \| owner-role \| category`). Nested subtree → row only when ownership / purpose differs from parent. **Leave:** file inventory (index is a map, not a manifest). |
| Novel class | `inline:<class>` | `<class>-index.idx` OR `<class>.yaml` — new template you author | See § Novel-class recipe below. |

### Novel-class recipe

Adopter doc class not covered by built-in recipe (or user pre-declared `template: novel`):

1. **Resolve consumer FIRST** per `core/protocols/index-protocol.md § Consumer coupling` — priority: `local/framework.config.yaml § index.classes[].consumed-by` > `local/bindings.md § Project-specific index citations` > team-lead interactive during discovery. **No consumer → SKIP** (no index file · no manifest entry; discovery report logs skip + heuristic; adopter wires later via `@ai-engineer extract <class>`).
2. **Sample 3–5 files** end-to-end.
3. **Identify signal structure** — repeated fields · indexing unit (per-file / per-section / per-row) · flat vs nested values.
4. **Format** — flat-record uniform shape → `.idx` per `core/protocols/index-syntax.md`; nested sub-trees → YAML.
5. **Per-record schema** of 3–7 fields max (typical: `id | title | status | key-signal | source`). Bias to consumer's needs (known from step 1).
6. **Emit** template at `core/templates/index/<class>-index.<ext>` (header + 1–2 example rows + recipe comment + lossless rule) + populated index at `local/index/<class>-index.<ext>`.
7. **Record inline recipe** in `manifest.yaml § indexed[]` INCLUDING `consumed-by` (REQUIRED):

   ```yaml
   - class: <class>
     template: novel
     recipe: "<one-paragraph: what to extract per file>"
     source-glob: <glob>
     file-count: <N>
     sha256-by-file: { ... }
     indexed-on: <date>
     index-files: [<class>-index.<ext>]
     source-bytes: <N>
     index-bytes: <N>
     compression: <N/N>
     consumed-by: [<role>, ...]   # REQUIRED — from step 1
   ```

Bodies NOT copied; source path + anchor cited per row. Compression target ≤ 0.25 for list-of-records novel classes.

### Lossless sample-and-check

After every extraction:

1. **Existence check.** 5 random items per affected index file (or all if < 5). Open cited source + anchor; verify item present. Doc: FR / NFR / endpoint / state / ADR / CR / scenario / glossary term. Code: dep / service / port / command / convention rule / env-var / top-level dir.
2. **Compression check** per `core/protocols/index-protocol.md § Compression floor`. Record `source-bytes` + `index-bytes` + `compression` in `manifest.yaml § indexed[]`. Reject `compression ≥ 0.5`; rewrite recipe OR mark `template: read-source-directly`. Per-class targets: prose-heavy ≤ 0.15 · list-of-records ≤ 0.25 · structured-config ≤ 0.15 (inventory-only).
3. **On any miss** → revert affected index file(s) + re-plan. Never commit partial extractions.

Special checks: glob sources → confirm `file-count` matches actual · recompute SHA-256 + compression and compare with written values.

## Process integration

Invoked between lifecycle phases on triggers:

- User explicitly targets AI-asset / doc optimization.
- `solution-architect` flags "this doc is getting unwieldy" in their report.
- Periodic maintenance (release cadence · post-large-feature cleanup).
- Phase 8 post-acceptance doc-optimization hook (`core/process.md § Phase 8`).

Coordination: cross-agent handoff per `core/process.md`. On semantic issue mid-pass → flag · hand off · do NOT fix.
