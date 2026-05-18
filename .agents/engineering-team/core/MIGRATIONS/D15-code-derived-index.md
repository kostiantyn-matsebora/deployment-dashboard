# Migration — D15: Code-derived knowledge index

**Target release:** next minor after 2026-05-17.
**Affected adopters:** every adopter project.

## What changed

The index protocol (D13) broadens from "documentation-derived" to "extracted." Same `local/index/manifest.yaml`, same SHA-256 staleness, same recipe pattern, same lossless rule — now also covers code/config sources. Six new code-category index files join the existing doc-category ones under one canonical `local/index/` tier.

New artefacts:

- `core/templates/index/stack.yaml` (tech-stack inventory by tier).
- `core/templates/index/topology.yaml` (services × ports × depends_on × replicas + IaC summary).
- `core/templates/index/commands.yaml` (build / test / lint / format / deploy / dev catalog).
- `core/templates/index/conventions.yaml` (formatter + linter rules + naming + pre-commit).
- `core/templates/index/runtime-facts.yaml` (declared env-vars + secrets-store + config-validation).
- `core/templates/index/repo-map.idx` (directory map with path → owner-role).

New built-in recipes (`core/roles/ai-engineer.details.md § Project extraction recipes § Code-category recipes`):

- `builtin:package-manifest` → `stack.yaml`.
- `builtin:container-orchestration` (+ `builtin:iac`) → `topology.yaml`.
- `builtin:commands` → `commands.yaml`.
- `builtin:conventions` → `conventions.yaml`.
- `builtin:runtime-facts` → `runtime-facts.yaml`.
- `builtin:repo-structure` → `repo-map.idx`.

Modified:

- `core/index-protocol.md` — title broadens; new `§ Source types` section; common-files table covers both categories; manifest shape adds `category: doc | code` per entry; lifecycle + lossless rule + adopter-declared example extended.
- `core/roles/ai-engineer.md` — In-scope-edits row renamed (Project knowledge index) + recipe list extended.
- `core/roles/ai-engineer.details.md` — `§ Project-doc extraction recipes` → `§ Project extraction recipes`; new doc/code sub-tables; sample-and-check verify-step is category-aware.
- `core/roles/project-manager.details.md` — Discovery Step 8b heuristics split into doc + code sub-groups; pre-dispatch staleness check covers both categories.
- Role kernels (`backend-engineer`, `frontend-engineer`, `devops-engineer`, `qa-engineer`, `solution-architect`, `security-engineer`, `sre`, `ml-engineer`, `mobile-engineer`, `data-engineer`) — Source-of-truth tables gain relevant code-category pointers.
- `CLAUDE.md` / `PLAN.md` — D15 row added.

## Action required

After re-fetching framework files on upgrade:

1. **Run `@project-manager rediscover`** (or natural-language equivalent that activates `ginee-rediscover` per D16). This re-enumerates classes — discovers the new code-category sources and populates the new index files.

   Or, for targeted extraction without full rediscover:

   ```
   @ai-engineer extract code-derived sources
   ```

   `ai-engineer` reads `core/index-protocol.md § Source types § Code` + the new recipe sub-table, runs each `builtin:<code-recipe>` against the project's matching sources, writes 6 new index files (skipping any source category the project doesn't have), and appends entries to `manifest.yaml` with `category: code`.

2. **Existing doc-category entries are untouched.** No re-extraction of architecture / adr / cr / etc. required.

3. **(Optional)** Pre-declare code-category novel classes in `local/framework.config.yaml § index.classes` if the project has a custom tooling source the built-in recipes don't recognize:

   ```yaml
   index:
     classes:
       - name: build-tools
         category: code
         source-glob: tools/build/*.json
         template: novel
   ```

## Behavioural change to expect

- Discovery now produces ~6 additional index files (per detected code source). Adopter projects without a particular source category (e.g. no Terraform → no IaC entries in `topology.yaml`) simply omit that subset.
- Pre-dispatch staleness check now includes code-source hashes. `package.json` / `Dockerfile` / `docker-compose.yml` etc. changes trigger drift alerts.
- Role specialists' "Source of truth" reads now include the relevant code-category index file first (e.g. `devops-engineer` reads `topology.yaml` before opening IaC source).

## Safeguards

- **`builtin:runtime-facts` never reads real secrets.** Schema lives in `.env.example`. Real `.env` files / production `appsettings.Production.json` are not opened. Compose/k8s env-blocks redact literal values that look secret.
- **Body-not-copied** rule preserved: `topology.yaml` references IaC anchors but does not copy resource bodies; `stack.yaml` records direct deps but not transitive lockfile entries; `repo-map.idx` enumerates directories but not files.

## Backward compatibility

- No `local/` files break — adopters with D13 index get *additional* files; existing files untouched.
- Adopters who skip the rediscover step still have working D13 doc-index behaviour; they just don't get the new code-category coverage until extraction runs.
- `category` field on manifest entries is additive — older `ai-engineer` versions that don't know about it will treat unknown classes as doc-category by default (graceful degradation).
- `@<role>` notation, dispatch flows, lifecycle gates unchanged.

## Rollback

- Delete the new code-category index files from `local/index/`.
- Remove their entries from `manifest.yaml`.
- Pin framework to pre-D15 release in `core/VERSION` (or re-fetch the older `core/`).

D13 doc-category index remains intact through any rollback.

## Issue reference

Implemented per [issue #1](https://github.com/kostiantyn-matsebora/engineering-team/issues/1) — "Code-derived knowledge index alongside doc-derived (D13 follow-on)."
