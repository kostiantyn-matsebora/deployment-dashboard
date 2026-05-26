---
audience: all-cardinals
load: on-demand
triggers: [index, project-index, manifest, drift, staleness]
cap-bytes: 32000
reads-before-applying: []
---

# Project knowledge index protocol

**Load-on-demand.** Fetched when:

- `team-lead` enumerates index classes during initial discovery or `rediscover`.
- `team-lead` detects SHA-256 drift pre-dispatch and needs to route to `ai-engineer` for reconciliation.
- `ai-engineer` is dispatched to extract or re-extract index entries.
- A role's "Source of truth" lookup pointed to `local/index/<file>` and the role needs the index-protocol contract (rare — most reads are direct).

Default short tasks do not load this file.

`.idx` grammar spec: `core/protocols/index-syntax.md` (load-on-demand on first `.idx` read or write).

## Read order

- **Index-first bedrock.** Cardinals consult `local/index/` summaries + role-kernel `Source of truth § always` rows before any source read; raw source reads are fallback when the index entry's anchor points at a fragment needed verbatim OR the role authors new content in that source.
- **Trigger conditions for raw source reads.** Index entry insufficient for verbatim citation · role authoring new content in source · novel-class file with no index entry yet (recipe-extracted on first encounter).
- **Justification-required reporting.** Every raw source read records a one-line justification in the cardinal return per `core/templates/phase-report.md § Source reads (this dispatch)`. Missing-justification carve-out per the same file's `§ Format-only re-dispatch — single carve-out`.

## Default read surface

`local/index/*` is the only default read surface for source-of-truth artefacts. `core/templates/bindings.md § Source-of-truth ownership` is a governance map (who edits what), NOT a per-dispatch read list — any framework surface that names raw `docs/**` or code/config paths as "read before any work" silently competes with this protocol.

### Compression targets

| Source shape | Target | Strategy |
|---|---|---|
| Prose-heavy (architecture rationale · ADR body · Gherkin) | 5–15% | Extract identifiers + anchors; drop motivation, alternatives, narrative |
| List-of-records (FRs · NFRs · endpoints · UI states · glossary) | 15–25% | Per-record row — title + key-signal + anchor; body stays in source |
| Already-structured config (compose · IaC · manifests · lint configs) | 5–15% | Inventory-only: name + tier + anchor; roles read source for per-record detail |

**Floor:** `compression ≥ 0.5` = recipe failed. Rewrite OR mark `read-source-directly`. Self-check: § Compression floor.

## Source types

The protocol covers two source categories — same machinery (manifest + SHA-256 + recipes + lossless rule) for both:

| Category | Source examples | Example index files |
|---|---|---|
| **Documentation** | architecture doc, mockup, ADR/CR directories, scenarios, glossary | `architecture.idx`, `api-matrix.yaml`, `ui-states.yaml`, `adr-index.idx`, `cr-index.idx`, `scenario-index.idx`, `glossary.idx`, `constraints.yaml`, `mockup-index.idx` |
| **Code / config** | package manifests, lockfiles, container orchestration, IaC, lint / formatter configs, env schemas, build scripts, repo directory tree | `stack.yaml`, `topology.yaml`, `commands.yaml`, `conventions.yaml`, `runtime-facts.yaml`, `repo-map.idx` |

The protocol was originally framed around documentation, then broadened to "extracted" so any structured fact source can be indexed under one tier with one manifest.

## Layout

```
local/index/
├── manifest.yaml            ← detected classes (doc + code) + SHA-256 + source paths + derived index files
├── <flat-record indexes>.idx       ← compact DSL per core/protocols/index-syntax.md
└── <nested indexes>.yaml           ← YAML for nested data
```

Format split — pick by data shape, not by category:

- **`.idx`** for flat record collections where every row shares the same schema (ADR rows, CR rows, scenario rows, glossary terms, mockup sections, repo-dir entries).
- **`.yaml`** for genuinely nested data (API endpoint with method/statuses/wire-shape sub-tree; UI state with example payload + visual + fixture sub-tree; manifest; constraints by category; stack by tier; topology by service).

Framework-internal only — no adopter hand-authors index files; `ai-engineer` writes them per recipes.

Common index files (from built-in recipes):

| Class | Category | Index file(s) | Source typical |
|---|---|---|---|
| architecture | doc | `architecture.idx` + `architecture-fr.idx` + `api-matrix.yaml` + `ui-states.yaml` + `constraints.yaml` + `glossary.idx` | `docs/architecture.md`, `docs/sad.md` |
| api-matrix | doc | `api-matrix.yaml` | architecture-doc §API or OpenAPI |
| ui-states | doc | `ui-states.yaml` | architecture + mockup |
| adr | doc | `adr-index.idx` (reusable for RFC, design-decision, any-decision-record class) | `docs/adr/`, `docs/rfcs/` |
| cr | doc | `cr-index.idx` | `docs/cr/` |
| scenario | doc | `scenario-index.idx` | `docs/scenarios/`, `tests/scenarios/` |
| mockup | doc | `mockup-index.idx` | `docs/mockup.html`, mockup directory |
| constraints | doc | `constraints.yaml` | architecture-doc §NFR + project-instruction file |
| glossary | doc | `glossary.idx` | architecture-doc + READMEs |
| stack | code | `stack.yaml` | `package.json`, `*.csproj`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Dockerfile`, lockfiles |
| topology | code | `topology.yaml` | `docker-compose*.yml`, Helm charts, `k8s/`, `terraform/`, `pulumi/` |
| commands | code | `commands.yaml` | `Makefile`, `package.json § scripts`, `justfile`, `framework.config.yaml § test-runners` |
| conventions | code | `conventions.yaml` | `.editorconfig`, ESLint / Prettier / Black / Ruff configs, husky, commitlint |
| runtime-facts | code | `runtime-facts.yaml` | `.env.example`, env-file schemas, declared env vars |
| repo-map | code | `repo-map.idx` | repo walk + per-directory READMEs |

**Adopter-specific classes** (not pre-covered) — e.g. RFC, design-spec, runbook, threat-model, data-dictionary, feature-spec, model-card, eval-report, incident-report, playbook, compliance-doc, prompt-library, skill-catalog, release-note (doc category); custom CI workflows, monorepo-specific tool configs, infrastructure tools the framework doesn't pre-recognize (code category). For these, `ai-engineer` follows the **novel-class recipe** (see `core/roles/ai-engineer.details.md § Project-doc extraction recipes`) and authors a new index file + records the inline recipe in `manifest.yaml`.

## Manifest shape

`local/index/manifest.yaml` records every detected class. Schematic example:

```yaml
indexed:
  - class: architecture           # built-in doc, multi-file output
    category: doc
    template: multi
    recipe: builtin:architecture
    source: docs/architecture.md
    sha256: a3f5b8...c4d1
    indexed-on: 2026-05-17
    index-files: [architecture.idx, architecture-fr.idx, api-matrix.yaml, ui-states.yaml, constraints.yaml, glossary.idx]
    source-bytes: 48230
    index-bytes: 6420            # sum across index-files
    compression: 0.13            # index-bytes / source-bytes
    consumed-by: [solution-architect, backend-engineer, frontend-engineer, qa-engineer, devops-engineer]

  - class: scenario               # built-in doc, globbed
    category: doc
    template: scenario-index.idx
    recipe: builtin:scenario
    source-glob: docs/scenarios/*.md
    file-count: 47
    sha256-by-file: { ... }       # per-file SHA so a single change flags only that subset
    index-files: [scenario-index.idx]
    # source-bytes / index-bytes / compression / indexed-on / consumed-by as above

  - class: stack                  # built-in code
    category: code
    template: stack.yaml
    recipe: builtin:package-manifest
    source-glob: "package.json,**/package.json,**/*.csproj,pyproject.toml,Cargo.toml,go.mod,Dockerfile,**/Dockerfile"
    file-count: 12
    sha256-by-file: { ... }
    index-files: [stack.yaml]

  - class: runbook                # novel — ai-engineer authored
    category: doc
    template: novel
    recipe: |
      Per file: extract title, alert id, severity, first-action step, escalation contact. Body NOT copied.
    source-glob: ops/runbooks/*.md
    file-count: 8
    sha256-by-file: { ... }
    index-files: [runbook-index.idx]
    consumed-by: [sre, devops-engineer]   # REQUIRED for novel classes; see § Consumer coupling
```

| Field | Notes |
|---|---|
| Single-file source | One `sha256`. |
| Glob source | `sha256-by-file` — change flags only the subset. |
| `category` | `doc` or `code`. Drives heuristic detection during discovery. |
| `recipe` | Built-in id (`builtin:<recipe>`) OR inline block (novel). |
| `source-bytes` / `index-bytes` / `compression` | Byte-size accounting; `compression ≥ 0.5` → recipe failed (see `§ Compression floor`). |
| `consumed-by` | Roles whose baseline cites at least one `index-files` entry. **Required for novel classes** (else extraction is skipped). Auto-populated for built-in by scanning cardinal `Source of truth` tables + `local/bindings.md § Project-specific index citations`. |

## Consumer coupling

Every extracted class MUST have at least one consumer role — extracting an index no role reads is pure waste.

**Built-in classes** — cardinal role kernels (`core/roles/*.md § Source of truth`) cite specific built-in index files. `ai-engineer` auto-populates each manifest's `consumed-by` by scanning kernel citations + `local/bindings.md § Project-specific index citations`. Built-in class with zero matches → framework bug; surface, do not extract.

**Novel classes** — adopter declares consumer BEFORE extraction. Declaration paths (priority):

1. `local/framework.config.yaml § index.classes[].consumed-by: [<role>...]` (preferred for adopter-known classes).
2. `local/bindings.md § Project-specific index citations` — wires novel class to a kernel without editing upstream.
3. Interactive — `team-lead` surfaces: *"Detected novel class `<X>` (~`<N>` files). Which role consumes it? [role-options] / [skip extraction]."* User answer → recorded in `local/framework.config.yaml § index.classes`.

**Skip-extraction default.** No consumer after all 3 paths → `ai-engineer` skips extraction; no manifest entry; discovery report logs the skip + heuristic. Adopter wires later via path 1 / 2 + invokes `@ai-engineer extract <class>`.

## Dormant-index audit

`ai-engineer` after every extraction:

1. Each `manifest.yaml § indexed[]` entry has non-empty `consumed-by`.
2. Every role in `consumed-by` cites at least one `index-files` entry in its kernel OR `local/bindings.md § Project-specific index citations`.
3. Empty `consumed-by` OR unresolved citations → dormant. Discovery report:

   ```
   Dormant index files (extracted but unread):
     - <class>: <index-files> (<size KB>) — no consumer cites these. Remedies:
       (a) Wire in local/bindings.md § Project-specific index citations
       (b) Skip extraction: remove from local/framework.config.yaml § index.classes
       (c) Reframe as built-in via PR to ginee upstream
   ```

Adopter decides per class. **No silent removal** — dormancy is a signal, not auto-pruner.

## Lifecycle

### Initial extraction (discovery)

Extends Step 8 of `team-lead.details.md § Discovery flow`:

1. Enumerate classes (priority: adopter-declared > built-in heuristics > novel).
2. Resolve consumer per `§ Consumer coupling`; novel without consumer → skip.
3. Dispatch `ai-engineer` with enumerated + consumer-resolved list.
4. `ai-engineer` — built-in: apply recipe + auto-populate `consumed-by` from kernel scan. Novel: author template at `core/templates/index/<class>-index.<ext>` (or skip template for one-off) + record inline recipe + `consumed-by` in `manifest.yaml`. Compute SHA-256 per source; write manifest.
5. Run lossless self-check (existence + compression).
6. Run dormant-index audit; report findings.

### Pre-dispatch staleness check

Extends `team-lead.md § Auto-flag staleness`:

1. Identify candidate sources by role × task context (doc → design / governance / scenarios; code → build / test / deploy / lint / stack-version-sensitive).
2. SHA-256: bash `sha256sum <file>` or `find <glob> -type f -exec sha256sum {} +` · PowerShell `Get-FileHash -Algorithm SHA256 <file>`.
3. Compare with `manifest.yaml`.
4. Mismatch → flag + offer:

   | Option | Effect |
   |---|---|
   | `@ai-engineer reindex <source>` | Scoped — affected source only. |
   | `@ai-engineer reindex` | Whole-repo — picks up net-new files within existing class globs. |
   | `@team-lead rediscover` | Full re-discovery — class membership changed (new doc dir · new tooling type). |

   **Never auto-reindex.** User decides.

### Reconciliation

`@ai-engineer reindex [scope]` (and `ginee-reindex` skill) — three sweeps:

| Sweep | Action |
|---|---|
| 1. SHA drift | Each manifest entry in scope: recompute SHA-256 (`source` for single-file · per-file `sha256-by-file:` for globbed). Change → re-extract per recipe + update `local/index/*` + entry. |
| 2. New files | List files per class `source-glob`. Not in manifest → add entry + extract. |
| 3. Stale entries | `source` no longer exists → `remove?` prompt to user. **Never auto-delete.** |

| Scope | Effect |
|---|---|
| `reindex` (no arg) | All classes, whole repo. |
| `reindex <file>` | File's matching class — Sweep 1 if entry exists, Sweep 2 if not. Multi-class match → ask. |
| `reindex <class>` | Class's `source-glob` — full three-sweep within class. |

After each Sweep-1 / Sweep-2 hit, `ai-engineer` updates manifest (new SHA-256 · `indexed-on` · refreshed `index-files`) + runs sample-and-check + dormant-index audit.

**Within existing classes only.** Novel-class detection (sources matching no manifest class glob — e.g. new `docs/runbooks/`) is `rediscover` responsibility (touches `project-profile.md` + `bindings.md` + may need consumer-coupling input).

## Lossless rule for index

**Coverage.** Every named record in source has an **existence-entry** in the index (name + source-anchor):

- **Doc:** every FR · NFR · endpoint · state · ADR · CR · scenario · glossary term.
- **Code:** every declared dep · service · port · command · convention rule · env-var · top-level directory.

Index entries MAY summarize but MUST cite source path + section anchor (or `file:line` for non-section sources). Coverage is about **existence**, not fidelity — record signals the role needs for routing (existence · name · tier · owner · anchor). Full metadata (per-service env-vars · per-dep version pins · per-port mappings · per-record motivation) stays in source; the anchor is the contract.

**Compression floor.** `compression = index-bytes / source-bytes` ≥ 0.5 = recipe failed (re-encoding, not summarizing). Remedies (priority):

1. **Rewrite recipe** to drop bulk — existence + anchors only; per-record metadata stays in source. Targets: ≤ 0.15 prose-heavy · ≤ 0.25 list-of-records · ≤ 0.15 structured-config inventory.
2. **Mark `template: read-source-directly`** in manifest — skip extraction; kernels cite source via `repo-map.idx`. Appropriate when source is already structured (YAML / JSON / TOML) and < 0.5 unreachable without losing existence-entries.

Per-class targets in `manifest.yaml § indexed[].compression`. Discovery report flags entries above target.

**Sample-and-check** after every extraction:

1. **Existence** — 5 random items per affected index file; source still has them at cited anchor.
2. **Compression** — `index-bytes / source-bytes`; ≥ 0.5 → reject + rewrite recipe.
3. **Any miss** → revert + re-plan; never commit partial extractions.

## Role consumption pattern

Every role's `## Source of truth` table declares per-file load triggers — not a flat "Read first" list. Trivial dispatch loads less; deep-work loads exactly what its task touches.

| Tier | `Load when` value | Use for |
|---|---|---|
| **always** | `always` | Foundational index — every dispatch. Reserved for small, high-signal files (FR table · NFR list · top-level architecture map). Target: single-digit-KB combined. |
| **scope** | Trigger phrase (`wire/endpoint/serializer touch` · `Phase 5/6 testing` · `deploy/infra work` · `dep bump` · `env-var work`) | Conditional — load only when task matches trigger. Dispatched specialist evaluates on first reasoning step. |

**Trigger evaluation when dispatched.** Load all `always` rows unconditionally. Evaluate each `scope` row's trigger against task; load matching, skip rest. Source-doc full reads remain on-demand per existing rule.

**Reporting** in first response:

```
Loaded baselines (this dispatch):
  always:    architecture-fr.idx, constraints.yaml
  scope:     api-matrix.yaml (wire-touch trigger matched)
  skipped:   scenario-index.idx (no test-authoring trigger), stack.yaml (no dep bump)
```

**Adopter overrides** in `local/bindings.md § Per-role load-trigger overrides` — promote scope→always for a role on this project OR demote always→scope by trigger phrase.

## Extension — adopter-declared classes

Pre-declare in `local/framework.config.yaml`:

```yaml
index:
  dir: local/index
  classes:
    - { name: rfc,         category: doc,  source-glob: docs/rfcs/*.md,     template: adr-index.idx }   # reuse template shape
    - { name: runbook,     category: doc,  source-glob: ops/runbooks/*.md,  template: novel }           # ai-engineer authors
    - { name: build-tools, category: code, source-glob: tools/build/*.json, template: novel }
```

`team-lead` reads first during class enumeration; precedence over auto-detection heuristics.

