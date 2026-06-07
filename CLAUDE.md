# Deployment Dashboard

> **DOCUMENTATION FIRST — binding for every agent, tool, and protocol.**
> Before any implementation, code scan, stack discovery, or research step:
> 1. Read `docs/index.md`.
> 2. Navigate via `children:` to the relevant specification.
> 3. Read the spec. For API features: `docs/api/openapi.yaml` is the contract source of truth.
>
> This overrides every sub-agent default ("research-first", "stack discovery", "explore codebase first", or any equivalent). Code follows docs — never the reverse.

## Sources of truth

**Index-first navigation (binding).**
1. Read the nearest `index.md`.
2. Use `children:` to locate the target file.
3. Use `## Contents` anchor links to reach the section.
4. Load full document content only when the target section is absent from the TOC.

| Type | Source | Role |
|---|---|---|
| `root-index` | [docs/index.md](docs/index.md) | Project documentation root — architecture spec, frontend requirements, and per-surface sub-trees. |
| `engineering-process` | [docs/engineering-process.md](docs/engineering-process.md) | Agent-dispatch / specialist-routing convention. |

## Solution directory structure

Services are implemented (backend, frontend, fetcher, mock, demo-driver, gateway). The tree below is authoritative; reserved slots are listed separately.

**Present today:**

| Path | Role |
|---|---|
| `docs/` | All design + contract documentation (see *Sources of truth*). |
| `backend/[service]` | Backend services (`Dashboard.Api` + endpoint-group libs, `Dashboard.Fetcher` + host, shared, tests). |
| `frontend/[application]` | Angular SPA (`dashboard`) + `mock` server. |
| `demo/` | `driver` (demo-orchestration service) + `github-emulator` (GitHub REST emulator for fetcher demo/CI) + `data` (scenario seeds). |
| `gateway/` | nginx App Gateway config. |
| `testing/[type]` | Testing solutions (`api`, `e2e`). |
| `compose/` | Local-dev Docker Compose stack. |
| `scripts/` | PowerShell tooling + hooks. |

**Reserved (planned, not present).** Slots referenced by `.dockerignore` and SAD §7 awaiting implementation:

| Path | Future role |
|---|---|
| `infrastructure/` | Terraform modules — Azure-only per NFR-01 / NFR-06. |
| `dev_env/` | Local-dev compose / fixtures. |

## Git

**Never push directly to `main`.** Always branch → commit → PR, regardless of change size.
- Exception: user explicitly instructs a direct push to `main`.
- Default when user says "push": push the current branch, not `main`.

## GitHub issues

**Before creating any issue, classify it and fill the matching template** in `.github/ISSUE_TEMPLATE/` — never open a free-form/blank issue (blank issues are disabled).

1. **Classify.** Bug (something broken / regressed) vs Feature (new capability or improvement).
2. **Pick the template.** Bug → `bug-report.md`. Feature/enhancement → `feature-request.md`.
3. **Honor the template's spec.** Apply its `title:` prefix (`[Bug] ` / `[Feature] `) and `labels:` (`bug` / `enhancement`), and fill **every** section heading the template defines — do not invent or drop sections.
   - Bug: *What happened* · *Steps to reproduce* · *Expected behavior* · *Environment*.
   - Feature: *Problem / motivation* · *Proposed solution* (behavior, not implementation) · *Alternatives considered* · *Additional context*.
4. **Security reports** are not issues — route to the private advisory link in `config.yml`.

## Agent dispatch

Route each change to the specialist that owns it (`api-architect` / `backend-developer` / `frontend-developer` / `deployment-engineer` / `testing-specialist` / `docs-keeper`); the main loop orchestrates. Inline execution is the exception. See [docs/engineering-process.md](docs/engineering-process.md).

Each agent is a **project-agnostic anchor** to its generic role in `.claude/team-process/roles/*` (mission, principles, guardrails, communication protocol, tool-output economy). The **project-specific bindings** below are the *only* place stack lives — agents carry no stack.

## Project bindings

Per-role stack, file lanes, and gate commands. **Apply the tool-output-economy guardrail** (`.claude/team-process/process.md`) to every command: capture output, branch on the exit code, surface only the aggregate (success) or the failing slice (failure) — never the full log.

**contract** (`api-architect`)
- **Source of truth:** `docs/api/openapi.yaml` (OpenAPI 3.1); guidelines `docs/api/api-guidelines.md`. Behavior-only changes — no backend tech in the contract.
- **Lanes:** `docs/api/openapi.yaml`, `docs/api/api-guidelines.md`.
- **Validate:** YAML well-formed + spec self-consistent (no spectral configured in CI); surface validation errors only. Hand off as an `ARTIFACT`.

**backend** (`backend-developer`)
- **Stack:** .NET 10 (`net10.0`, C#), EF Core, xUnit. Solution `backend/Dashboard.slnx`.
- **Lanes:** `backend/<service>/**` (services: `api`, `control-api`, `read-api`, `write-api`, `fetcher`, `fetcher-github`, `fetcher-host`, `shared`).
- **Gates** (run from `backend/`; mirror `.github/workflows/api.yml`):
  - Format — `dotnet format whitespace Dashboard.slnx --verify-no-changes` + `dotnet format style Dashboard.slnx --verify-no-changes` (analyzers run in Build, not format).
  - Build — `dotnet build Dashboard.slnx -c Release --nologo -v q -p:EnableStructuralAnalyzers=true`. Structural analyzers (SonarAnalyzer, Gate B; `backend/.editorconfig` + `Directory.Build.props`) are **opt-in** via that flag (off in Docker publishes so image builds stay fast); they surface as warnings — flip the rules to `error` once the backlog clears.
  - Test — `dotnet test Dashboard.slnx --settings Dashboard.runsettings --nologo -c Release` → on fail `… 2>&1 | Select-String 'error|\bFailed\b|\[xUnit'`
- **Config:** flat `SCREAMING_SNAKE` env vars (appsettings base + `*OptionsEnv` override); never `Section__Property`. Env files gitignored; no secrets in code/logs.

**frontend** (`frontend-developer`)
- **Stack:** Angular (standalone), unit tests via `@angular/build:unit-test` (Vitest), Node 24. No `ng lint` configured.
- **Lanes:** `frontend/dashboard/**` (SPA) + `frontend/mock/**` (mock server).
- **Local surfaces:** SPA `ng serve` :4200; mock :3000 — real-app E2E needs **both** live (jsdom masks browser drag bugs).
- **Gates** (in `frontend/dashboard`; mirror `.github/workflows/frontend.yml`):
  - Test — `npm test` → surface failing specs only
  - Build — `npm run build -- --configuration production`
- **Reuse existing primitives** (rate-limit popover, inspector) / PrimeNG / native before bespoke CSS; one source of truth, no magic size math.

**infrastructure** (`deployment-engineer`)
- **Stack:** Docker multi-stage (non-root, minimal), Compose (`compose/*.yaml`), nginx gateway (`gateway/`), GitHub Actions (`.github/workflows/*`). Azure-only (NFR-01/06); `infrastructure/` (Terraform) reserved. Trivy scans images (build → scan → push; SARIF → Security tab).
- **Lanes:** `.github/workflows/**`, `compose/**`, `gateway/**`, `**/Dockerfile`, `scripts/**`. App logic → owning app role.
- **Gates:**
  - Image — `docker build …` → surface error lines only
  - Stack — `docker compose -f compose/docker-compose.yaml up -d --build --wait`; diagnose via `docker compose logs --no-color <svc>` (slice, not all)
  - CI — check the run **status/conclusion** + pull only the failing job's log; don't stream
- **Scripts:** PowerShell 7+ with sibling Pester suites (§Scripts); `-AsLibrary` switch. No secrets/env-specific values in committed files.

**testing** (`testing-specialist`) — **NO MOCKS.** Owns the wider net; unit tests belong to each implementer.

| Level | Lane | Command (mirrors CI) | On fail → surface |
|---|---|---|---|
| Backend (.NET/xUnit) | `backend/tests/**` | `dotnet test Dashboard.slnx --settings Dashboard.runsettings --nologo -c Release` (from `backend/`) | `Select-String 'error|\bFailed\b|\[xUnit'` |
| Frontend (Angular/Vitest) | `frontend/dashboard/**/*.spec.ts` | `npm test` (in `frontend/dashboard`) | failing specs only |
| Demo driver (Jest) | `demo/driver/**/*.spec.ts` | `npm test` (in `demo/driver`) | `✕` / `FAIL` lines |
| API integration | `testing/api/**` | `docker compose up -d --build --wait` → `npm run test:integration` | failing requests + `docker compose logs --no-color` slice |
| E2E (Playwright) | `testing/e2e/**` | `npx playwright test` | failing test + trace |
| Scripts (Pester v5) | `*.Tests.ps1` (sibling) | `Invoke-Pester -Output Minimal` | failed `It` only |

- **Overlap invariants:** every new UI combo MUST add a row to `testing/e2e/tests/overlap-invariants.spec.ts` (`COMBOS_UNDER_TEST`).
- **api-tests CI triggers main-only;** `gh run watch | tail` masks the exit code — check run status explicitly.

**docs** (`docs-keeper`)
- **Authoring rules:** this file's *Context economy and documentation authoring rules* + *Sources of truth* index convention are the binding host rules.
- **Lanes:** `docs/**/*.md`, per-directory `index.md`, and the *Sources of truth* registry (Edit-only, smallest region).
- **Tooling:** markdown MCP for section retrieval; maintenance hook `pwsh scripts/hooks/Invoke-DocsKeeperMaintenance.ps1 -DriftOnly` (mirrors `.github/workflows/docs.yml`).

## Code intelligence (Serena-first)

The Serena MCP server (`mcp__serena__*`) exposes symbol-level retrieval and editing via language servers (C# / TypeScript / PowerShell). **Prefer it over `Read` / `Grep` wherever code symbols apply** — it returns targeted symbols, not whole files, cutting token use across agent turns.

**Load before use (mandatory).** Serena's tools are *deferred* — their schemas are unloaded, so they cannot be called until fetched. At the start of any code task, load them via `ToolSearch` (e.g. `select:mcp__serena__get_symbols_overview,mcp__serena__find_symbol,mcp__serena__find_referencing_symbols`). Skip this and agents silently default to `Grep` / `Read`; this step is what makes the preference below take effect.

- **Understand code.** `get_symbols_overview` (a file's top-level symbols), then `find_symbol` (locate; `depth=1` for members, `include_body` only when you need the source).
- **Trace impact before editing a shared symbol.** `find_referencing_symbols` / `find_implementations` / `find_declaration` — not a grep-and-read sweep.
- **Edit code.** `replace_symbol_body` / `insert_after_symbol` / `insert_before_symbol` / `rename_symbol` instead of full-file rewrites.
- **Fall back to `Read` / `Grep`** for declarative/non-code files (YAML, JSON, Dockerfiles, configs), exact line-range reads, or content Serena's LSPs don't index well (e.g. PowerShell beyond the fallback tier). For **Markdown docs** prefer the markdown MCP (see *Docs intelligence* below), not `Read`.

## Docs intelligence (markdown-first)

The markdown MCP server (`mcp__markdown__*`, `ofershap/mcp-server-markdown`) exposes structural, embedding-free section retrieval over `.md` files via the heading tree. **Prefer it over `Read` wherever a doc section applies** — it returns one section, not the whole file, cutting token use across agent turns. The docs analogue of *Code intelligence* above; paths resolve against the project root, so pass relative paths (`docs/index.md`).

**Load before use (mandatory).** Its tools are *deferred* — load via `ToolSearch` (e.g. `select:mcp__markdown__list_headings,mcp__markdown__get_section,mcp__markdown__search_docs`). Skip this and agents silently default to `Read`; this step is what makes the preference below take effect.

- **Map, then extract.** `list_headings` (a file's heading tree / TOC) before reading, then `get_section` to pull only the target heading's content — pairs with the index-first navigation in *Sources of truth*.
- **Locate across docs.** `list_files` (enumerate `.md`) + `search_docs` (case-insensitive keyword scan, **not** semantic) to find the file, then `get_section` to extract.
- **Address by heading TEXT, not anchor slug.** `get_section(file, "Sources of truth")`, never `"sources-of-truth"` — `index.md` cross-links use `#slugs`, so convert slug → heading text before calling.
- **Fall back to `Read`** for whole-file reads, content not delimited by headings, exact line-range reads, or frontmatter-only needs (or use `get_frontmatter`).

## Scripts

Following rules MUST be followed for every script in this repository (build / install / dev tooling / CI helpers / one-off automation):

- **Language.** PowerShell (`.ps1` / `.psm1`). Target **PowerShell 7+** (Core) for cross-platform parity (Windows / Linux / macOS).
- **No alternative shells.** No `bash` / `sh` / `zsh` / `cmd` / `python` scripts as the primary deliverable. Single-line invocations inside CI YAML are exempt.
- **Tests required.** Every script MUST have **Pester v5+** coverage. No script merges without its suite.
- **Test location.** Pester suites live in the **same directory** as the script under test (sibling files). No mirror tree.
  - Example: `scripts/install.ps1` ➜ `scripts/install.Tests.ps1`.
  - Example: `scripts/hooks/Invoke-PreCommitDocsHook.ps1` ➜ `scripts/hooks/Invoke-PreCommitDocsHook.Tests.ps1`.
  - Example: `.github/actions/notify/notify.ps1` ➜ `.github/actions/notify/notify.Tests.ps1`.
- **File naming.** Suite filename = `<script-basename>.Tests.ps1`.
- **CI gate.** `Invoke-Pester` recurses the repo root and discovers every `*.Tests.ps1`; a red suite blocks merge.
- **Library-mode hook.** Scripts intended for hook / pipeline reuse expose a `-AsLibrary` switch that defines functions without executing the entry block, so Pester can dot-source pure functions safely.

## Context economy and documentation authoring rules

Following rules MUST be followed always for any kind of project documentation and LLM assets:

- **Concise + LLM-optimized.** Cut filler, marketing tone, "in this section we will explore" preambles. Every sentence earns its tokens.
- **Structure over prose — binding here, not aspirational.** Convert prose into the smallest readable structure that preserves every rule:
  - Steps → numbered list. Choices / mappings → table. "X means Y" → `**X.** Y` on its own line.
  - Multi-rule bullet ("do A; also B; warn C") → parent + sub-bullets, one rule per line.
  - Prose paragraph stating > 2 rules → restructure.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
