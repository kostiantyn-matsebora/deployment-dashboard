# Project knowledge index protocol

**Load-on-demand.** Fetched when:

- `project-manager` enumerates index classes during initial discovery or `rediscover`.
- `project-manager` detects SHA-256 drift pre-dispatch and needs to route to `ai-engineer` for re-extraction.
- `ai-engineer` is dispatched to extract or re-extract index entries.
- A role's "Source of truth" lookup pointed to `local/index/<file>` and the role needs the index-protocol contract (rare — most reads are direct).

Default short tasks do not load this file.

`.idx` grammar spec: `core/index-syntax.md` (load-on-demand on first `.idx` read or write).

## Why

Adopter projects accumulate substantial knowledge across two source categories — **documentation** (architecture doc 30–50K, mockup 30–100K, ADRs / CRs / scenarios often 100K+ corpora) and **code / config** (`package.json`, `Dockerfile`, `docker-compose.yml`, `terraform/`, `.editorconfig`, lockfiles). Pulling raw sources into LLM context on every dispatch burns tokens before any work has started. The index replaces full-source reads with lightweight per-class summaries; roles read originals only when the index points to a fragment they need verbatim.

`local/index/*` is the **only default read surface** for source-of-truth artefacts. `core/templates/bindings.md § Source-of-truth ownership` records who edits each raw source + where its verbatim text lives — it is a governance map, not a per-dispatch read list. Any framework surface that names raw `docs/**` or code/config paths as "read before any work" silently competes with this protocol and re-introduces the cost it exists to eliminate.

### Where compression pays off — and where it doesn't

The index is a **summarization tier**, not a re-encoding tier. The win depends on source shape:

| Source shape | Realistic compression | Strategy |
|---|---|---|
| Prose-heavy (architecture rationale, ADR body, scenario Given/When/Then) | 5–15% of source | Aggressive — extract identifiers + anchors; drop motivation, alternatives, narrative |
| List-of-records with metadata (FRs, NFRs, endpoints, UI states, glossary terms) | 15–25% of source | Per-record row with title + key-signal + anchor; full body stays in source |
| Already-structured config (compose, IaC, package manifests, lint configs) | 5–15% of source — **inventory only** | Record existence (name + tier + anchor); roles read source for per-record detail |

**Compression floor: ≥ 50% of source bytes = recipe failed.** Either rewrite the recipe to drop bulk OR mark the class as `read-source-directly` (skip extraction; role kernels cite the source path via `repo-map.idx`). See `§ Lossless rule for index § Compression floor` for the self-check.

## Source types

The protocol covers two source categories — same machinery (manifest + SHA-256 + recipes + lossless rule) for both:

| Category | Source examples | Example index files |
|---|---|---|
| **Documentation** (D13 baseline) | architecture doc, mockup, ADR/CR directories, scenarios, glossary | `architecture.idx`, `api-matrix.yaml`, `ui-states.yaml`, `adr-index.idx`, `cr-index.idx`, `scenario-index.idx`, `glossary.idx`, `constraints.yaml`, `mockup-index.idx` |
| **Code / config** (D15 extension) | package manifests, lockfiles, container orchestration, IaC, lint / formatter configs, env schemas, build scripts, repo directory tree | `stack.yaml`, `topology.yaml`, `commands.yaml`, `conventions.yaml`, `runtime-facts.yaml`, `repo-map.idx` |

D13 framed the protocol around documentation; D15 broadened it to "extracted" so any structured fact source can be indexed under one tier with one manifest.

## Layout

```
local/index/
├── manifest.yaml            ← detected classes (doc + code) + SHA-256 + source paths + derived index files
├── <flat-record indexes>.idx       ← compact DSL per core/index-syntax.md
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

`local/index/manifest.yaml` records every detected class — doc, code, built-in, or novel — with sources, SHA-256, derived index files, and extraction recipe id.

```yaml
indexed:
  # Doc class (D13)
  - class: architecture
    category: doc
    template: multi                       # multi-file output — see index-files
    recipe: builtin:architecture
    source: docs/architecture.md
    sha256: a3f5b8...c4d1
    indexed-on: 2026-05-17
    index-files: [architecture.idx, architecture-fr.idx, api-matrix.yaml, ui-states.yaml, constraints.yaml, glossary.idx]
    source-bytes: 48230
    index-bytes: 6420                    # sum across index-files
    compression: 0.13                     # index-bytes / source-bytes; ≥ 0.5 = failed (see § Compression floor)
    consumed-by: [solution-architect, backend-engineer, frontend-engineer, qa-engineer, devops-engineer]
                                          # roles whose kernel baselines cite at least one of index-files

  - class: scenario
    category: doc
    template: scenario-index.idx
    recipe: builtin:scenario
    source-glob: docs/scenarios/*.md
    file-count: 47
    sha256-by-file:
      docs/scenarios/login-happy.md: b7...
      docs/scenarios/login-fail.md: c9...
    indexed-on: 2026-05-17
    index-files: [scenario-index.idx]
    source-bytes: 142800
    index-bytes: 8200
    compression: 0.06

  # Code class (D15)
  - class: stack
    category: code
    template: stack.yaml
    recipe: builtin:package-manifest
    source-glob: "package.json,**/package.json,**/*.csproj,pyproject.toml,Cargo.toml,go.mod,Dockerfile,**/Dockerfile"
    file-count: 12
    sha256-by-file: { ... }
    indexed-on: 2026-05-17
    index-files: [stack.yaml]

  - class: topology
    category: code
    template: topology.yaml
    recipe: builtin:container-orchestration
    source-glob: "docker-compose*.yml,k8s/**/*.yaml,helm/**/*.yaml,terraform/**/*.tf"
    file-count: 8
    sha256-by-file: { ... }
    indexed-on: 2026-05-17
    index-files: [topology.yaml]

  # Adopter-declared, reuses doc template
  - class: rfc
    category: doc
    template: adr-index.idx
    recipe: builtin:adr
    source-glob: docs/rfcs/*.md
    file-count: 12
    sha256-by-file: { ... }
    indexed-on: 2026-05-17
    index-files: [rfc-index.idx]

  # Novel class — ai-engineer authored
  - class: runbook
    category: doc
    template: novel
    recipe: |
      Per file: extract title, alert id, severity, first-action step,
      escalation contact. Body NOT copied.
    source-glob: ops/runbooks/*.md
    file-count: 8
    sha256-by-file: { ... }
    indexed-on: 2026-05-17
    index-files: [runbook-index.idx]
    consumed-by: [sre, devops-engineer]   # REQUIRED for novel classes; see § Consumer coupling
```

- **Single-file sources** record one `sha256`.
- **Glob sources** record `sha256-by-file` so a single new/changed file flags only that subset.
- **`category`** — `doc` (D13) or `code` (D15). Drives heuristic-detection mapping during discovery.
- **`recipe`** — either a built-in id (`builtin:<recipe>`) or an inline recipe block (for novel classes).
- **`source-bytes`** + **`index-bytes`** + **`compression`** — byte-size accounting; surfaces compression ratio so adopters and `ai-engineer` see when a recipe is over-extracting (`compression` ≥ 0.5 → failed; see `§ Compression floor`). `index-bytes` = sum across all `index-files` entries.
- **`consumed-by`** — list of roles whose baseline reads at least one of the entry's `index-files`. **Required for novel classes** (else extraction is skipped per `§ Consumer coupling`). Auto-populated for built-in classes by scanning cardinal role kernels' `Source of truth` tables + `local/bindings.md § Project-specific index citations`.

## Consumer coupling

Every extracted class MUST have at least one consumer role. Extracting an index file no role reads is pure waste — disk + staleness-check + extraction-time cost for no observable benefit.

**Built-in classes.** Cardinal role kernels (`core/roles/*.md § Source of truth`) cite specific built-in index files. `ai-engineer` auto-populates each manifest entry's `consumed-by` by scanning kernel citations + `local/bindings.md § Project-specific index citations` (adopter overrides). A built-in class with zero matches across both sources is a framework bug — surface it; do not extract.

**Novel classes.** Adopter must declare the consumer **before** extraction. Three declaration paths:

1. **`local/framework.config.yaml § index.classes[].consumed-by: [<role>...]`** — pre-declared in config; preferred for adopter-known classes (e.g. `runbook → [sre, devops-engineer]`).
2. **`local/bindings.md § Project-specific index citations`** — adopter-side citation table that wires a novel class to a cardinal role's baseline without editing upstream kernels. `project-manager` reads this at dispatch time and extends the role's baseline accordingly.
3. **Interactive during discovery** — `project-manager` detects a novel class without declared consumer; surfaces to the user: *"Detected novel class `<X>` (~`<N>` source files). Which role consumes it?  [role-options] / [skip extraction]."* User answer recorded in `local/framework.config.yaml § index.classes` for future runs.

**Skip-extraction default.** A novel class with NO consumer declared after all three paths exhaust → `ai-engineer` skips extraction; manifest does NOT gain an entry; discovery report logs the skipped class with the heuristic that detected it. Cost: zero. Adopter can wire later via path 1 or 2 + invoke `@ai-engineer extract <class>`.

## Dormant-index audit

`ai-engineer` runs after every extraction or re-extraction:

1. For each `manifest.yaml § indexed[]` entry, verify `consumed-by` is non-empty.
2. Cross-check that every role listed in `consumed-by` actually cites at least one of `index-files` in its kernel (or `local/bindings.md § Project-specific index citations` for adopter-side wiring).
3. Any class with empty `consumed-by` OR with citations that don't resolve → dormant. Emit in the discovery report:

   ```
   Dormant index files (extracted but unread):
     - <class>: <index-files> (<size KB>) — no consumer cites these. Remedies:
       (a) Wire in local/bindings.md § Project-specific index citations
       (b) Skip extraction: remove from local/framework.config.yaml § index.classes
       (c) Reframe as a built-in class via PR to engineering-team upstream
   ```

Adopter decides per class. No silent removal — dormancy is a signal, not an auto-pruner.

## Lifecycle

### Initial extraction (discovery)

`project-manager` extends Step 8 of the discovery flow:

1. **Enumerate classes** to index in this priority order:
   1. Adopter-declared classes from `local/framework.config.yaml § index.classes`.
   2. Built-in classes matched by glob heuristics:
      - **Doc:** architecture / adr / cr / scenario / mockup / constraints / glossary.
      - **Code:** stack / topology / commands / conventions / runtime-facts / repo-map.
   3. Novel classes — any unmatched doc directory or code/config source the framework doesn't pre-recognize.
2. **For each novel class, resolve consumer** per `§ Consumer coupling`. No consumer → skip the class.
3. **Dispatch `ai-engineer`** with the enumerated + consumer-resolved class list.
4. `ai-engineer`:
   - For built-in classes → applies the built-in recipe; auto-populates `consumed-by` from kernel scan.
   - For novel classes → authors a new template at `core/templates/index/<class>-index.<ext>` (or directly populates `local/index/<class>-index.<ext>` without a sibling template if it's a one-off) AND records the inline recipe + `consumed-by` in `manifest.yaml`.
   - Computes SHA-256 per source.
   - Writes `local/index/manifest.yaml`.
5. `ai-engineer` runs the **lossless self-check** (existence + compression — see § Lossless rule).
6. `ai-engineer` runs the **dormant-index audit** (see § Dormant-index audit) and reports findings.

### Pre-dispatch staleness check

`project-manager` extends `§ Auto-flag staleness`:

1. Identify which sources the dispatched task may consume (based on role + task context):
   - Doc sources for design / governance / scenario authoring.
   - Code sources for build / test / deploy / lint work and stack-version-sensitive changes.
2. For each, compute current SHA-256:
   - Bash: `sha256sum <file>` or `find <glob> -type f -exec sha256sum {} +`
   - PowerShell: `Get-FileHash -Algorithm SHA256 <file>`
3. Compare with `manifest.yaml` entry.
4. On any mismatch:
   - Flag staleness in PM's first response.
   - Offer:
     - **`@ai-engineer reindex <source>`** — targeted re-extraction for the changed source.
     - **`@project-manager rediscover`** — full re-discovery + re-extraction.
   - **Never auto-reindex.** User decides.

### Re-extraction

`ai-engineer` dispatched (by PM or explicit user invocation):

1. Read the changed source(s).
2. Re-extract per the recorded recipe (built-in id or inline novel recipe) → overwrite affected `local/index/*` files.
3. Update `manifest.yaml`:
   - New SHA-256.
   - New `indexed-on` date.
   - Same `index-files` (or add new ones if extraction surfaced a new index file).
4. Run lossless self-check on the affected entries.

## Lossless rule for index

### Coverage rule

- Every named record in the source MUST have an **existence-entry** in the index (name + source-anchor). Per category:
  - **Doc:** every FR / NFR / endpoint / state / ADR / CR / scenario / glossary term.
  - **Code:** every declared dependency / service / port / command / convention rule / env-var / top-level directory.
- Index entries MAY summarize but MUST cite source path + section anchor (or `file:line` ref for non-section sources).
- Coverage is about *existence*, not *fidelity*. Index records the signals the role needs for routing (existence, name, tier, owner, anchor). Full metadata (per-service env-vars, per-dep version pins, per-port mappings, per-record motivation) stays in source — the index entry's anchor is the contract that the source still holds it.

### Compression floor

- **`compression` (`index-bytes / source-bytes`) ≥ 0.5 = recipe failed.** A summary tier that produces ≥ half the source bytes is re-encoding, not summarizing.
- Remedies, in order of preference:
  1. **Rewrite the recipe** to drop bulk — extract existence + anchors only; relegate per-record metadata back to source. Re-extract; verify the ratio falls below 0.5 (target: ≤ 0.15 for prose-heavy, ≤ 0.25 for list-of-records, ≤ 0.15 for already-structured config inventory).
  2. **Mark the class `read-source-directly`** in `manifest.yaml § indexed[].template`. Skip extraction entirely. Role kernels needing the class cite the source path via `repo-map.idx`. Appropriate when the source is already structured (YAML / JSON / TOML) and compression below 0.5 isn't achievable without losing required existence-entries.
- Per-class targets recorded in `manifest.yaml § indexed[].compression`. Discovery report flags any entry above target so the adopter sees the bloat up front.

### Sample-and-check

After extraction or re-extraction, `ai-engineer` runs:

1. **Existence check** — pick 5 random items per affected index file. Verify the source still has them at the cited anchor.
2. **Compression check** — measure `index-bytes / source-bytes`. If ≥ 0.5, the extraction is rejected; rewrite the recipe per § Compression floor.
3. **On any miss** → revert and re-plan. Do not commit partial extractions.

## Role consumption pattern

Every role's "Source of truth" table declares **per-file load triggers** — not a flat "Read first" list. A trivial dispatch shouldn't load the full role baseline; a deep-work dispatch should pick up exactly the indexes its task touches.

### Two-tier load model

Each row in a role's `## Source of truth` table carries a `Load when` column:

| Tier | `Load when` value | When to use |
|---|---|---|
| **always** | `always` | Foundational index — loaded on every dispatch to this role. Reserved for small, high-signal files (FR table, NFR list, top-level architecture map). Target: single-digit-KB combined. |
| **scope** | Trigger phrase (e.g. `wire/endpoint/serializer touch`, `Phase 5/6 testing`, `deploy/infra work`, `dep bump`, `env-var work`) | Conditional — loaded only when the task description matches the trigger. The dispatched specialist evaluates triggers on its first reasoning step. |

### Trigger evaluation

When dispatched:

1. Read the kernel's `## Source of truth § always` rows. Load all listed index files unconditionally.
2. Read the `## Source of truth § scope` rows. For each, evaluate whether the task description matches the trigger phrase. Load matching files; skip the rest.
3. Source-doc full reads remain on-demand per the existing rule — "ONLY when the index entry points at the source and the role needs verbatim text" OR "the role is authoring new content."

### Reporting

The dispatched specialist reports its load decision in the first response (Phase 4/5/6/7 estimation-first dispatch, or directly in trivial dispatches):

```
Loaded baselines (this dispatch):
  always:    architecture-fr.idx, constraints.yaml
  scope:     api-matrix.yaml (wire-touch trigger matched)
  skipped:   scenario-index.idx (no test-authoring trigger), stack.yaml (no dep bump)
```

Gives the adopter visibility into the per-dispatch baseline cost.

### Adopter overrides

The role kernel's `Load when` values are **defaults**. Per-project overrides land in `local/bindings.md § Per-role load-trigger overrides` (when present) — adopter raises or lowers a file's tier based on project specifics (e.g. a project where `topology.yaml` is hit by every backend dispatch, not just devops).

## Extension — adopter-declared classes

Adopters may pre-declare classes in `local/framework.config.yaml`:

```yaml
index:
  dir: local/index
  classes:
    - name: rfc
      category: doc
      source-glob: docs/rfcs/*.md
      template: adr-index.idx             # reuse ADR template shape
    - name: runbook
      category: doc
      source-glob: ops/runbooks/*.md
      template: novel                     # ai-engineer authors a new template
    - name: build-tools
      category: code
      source-glob: tools/build/*.json
      template: novel
```

`project-manager` reads this block first during class enumeration. Takes precedence over auto-detection heuristics.

## Out of scope

- Automated checksum tooling beyond `sha256sum` / `Get-FileHash` invocations.
- True vector-store RAG (markdown-only baseline per D1 / D4).
- Cross-project index sharing.
- Auto-promotion of novel classes to built-in templates. May happen in future framework releases based on observed adopter patterns.
- Index pre-cooking on framework install. Adopters run `@project-manager rediscover` to build their first index.
- Runtime-discovered facts requiring live execution (e.g. actual DB schema via introspection, runtime memory profile). Static-extraction only.
- Auto-generated API docs from code (OpenAPI/spec generation). Separate concern; the index *consumes* an existing OpenAPI spec if one's present, but doesn't generate one.
- Per-role facts files (Approach C of issue #1). Layered on top of the canonical index if a future need arises; not in D15 scope.
