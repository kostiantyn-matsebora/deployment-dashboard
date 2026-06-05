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
