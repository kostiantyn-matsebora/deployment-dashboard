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

**Session worktree.** When the `SessionStart` hook emits `additionalContext` containing an `EnterWorktree` instruction with a worktree path, call `EnterWorktree` with that path immediately — before reading or responding to the user's first message. Call it directly; `EnterWorktree` does not require loading its schema via `ToolSearch` first (the worktree-entry guard blocks `ToolSearch` until `EnterWorktree` completes).

**Lazy branching.** Session worktrees start in detached HEAD. Before any `git commit`, first run `git checkout -b <conventional-name>` to create a properly named branch. The `Invoke-BranchGuard.ps1` hook enforces this mechanically and will block the commit if HEAD is still detached.

## Agent dispatch

Route each change to the specialist that owns it (`api-architect` / `backend-developer` / `frontend-developer` / `deployment-engineer` / `testing-specialist` / `docs-keeper`); the main loop orchestrates. Inline execution is the exception. See [docs/engineering-process.md](docs/engineering-process.md).

## Code intelligence (Serena-first)

The Serena MCP server (`mcp__serena__*`) exposes symbol-level retrieval and editing via language servers (C# / TypeScript / PowerShell). **Prefer it over `Read` / `Grep` wherever code symbols apply** — it returns targeted symbols, not whole files, cutting token use across agent turns.

- **Understand code.** `get_symbols_overview` (a file's top-level symbols), then `find_symbol` (locate; `depth=1` for members, `include_body` only when you need the source).
- **Trace impact before editing a shared symbol.** `find_referencing_symbols` / `find_implementations` / `find_declaration` — not a grep-and-read sweep.
- **Edit code.** `replace_symbol_body` / `insert_after_symbol` / `insert_before_symbol` / `rename_symbol` instead of full-file rewrites.
- **Fall back to `Read` / `Grep`** for declarative/non-code files (YAML, JSON, Markdown, Dockerfiles, configs), exact line-range reads, or content Serena's LSPs don't index well (e.g. PowerShell beyond the fallback tier).

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
