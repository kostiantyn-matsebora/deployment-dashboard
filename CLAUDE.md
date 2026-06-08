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

The tree below is authoritative — *Present today* vs *Reserved* are split into the two tables.

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

**Never open a blank/free-form issue** (blank issues are disabled). Before filing:

1. **Classify.** Bug (broken / regressed) vs Feature (new capability / improvement).
2. **Fill the matching template** in `.github/ISSUE_TEMPLATE/` — Bug → `bug-report.md`, Feature → `feature-request.md`. Honor its `title:` prefix + `labels:`, and fill **every** section heading it defines (don't invent or drop sections — the template is the source of truth for sections).
3. **Security reports** are not issues — route to the private advisory link in `config.yml`.

## Agent dispatch

Route each change to the specialist that owns it (`api-architect` / `backend-developer` / `frontend-developer` / `deployment-engineer` / `testing-specialist` / `docs-keeper`); the main loop orchestrates. Inline execution is the exception. See [docs/engineering-process.md](docs/engineering-process.md).

Each agent is a **project-agnostic anchor** to its generic role in `.claude/team-process/roles/*` (mission, principles, guardrails, communication protocol, tool-output economy). The **project-specific bindings** below are the *only* place stack lives — agents carry no stack.

## Project bindings

Per-role stack, file lanes, and gate commands live **one file per role** under `.claude/bindings/`.
**Each role reads ONLY its own file** into context — not the whole set.

| Role | Agent | Binding |
|---|---|---|
| contract | `api-architect` | [`.claude/bindings/contract.md`](.claude/bindings/contract.md) |
| backend | `backend-developer` | [`.claude/bindings/backend.md`](.claude/bindings/backend.md) |
| frontend | `frontend-developer` | [`.claude/bindings/frontend.md`](.claude/bindings/frontend.md) |
| infrastructure | `deployment-engineer` | [`.claude/bindings/infrastructure.md`](.claude/bindings/infrastructure.md) |
| testing | `testing-specialist` | [`.claude/bindings/testing.md`](.claude/bindings/testing.md) |
| docs | `docs-keeper` | [`.claude/bindings/docs.md`](.claude/bindings/docs.md) |

**Tool-output-economy guardrail** (`.claude/team-process/guardrails.md`) — shared across all roles; apply to every command:
- Capture output; branch on the exit code.
- Surface only the aggregate (success) or the failing slice (failure) — never the full log.

## Code & docs intelligence (MCP)

Purpose-routed MCP servers return targeted symbols/sections (callers, dependents, tests, doc
headings), not whole files — **prefer them over `Read` / `Grep`** for code and `.md`. Servers:
**tokensave** (code research/impact) · **serena** (symbol-level editing) · **code-review-graph**
(change review) · **markdown** (`.md` section retrieval).

**External library docs → context7** (not the local-repo servers above). For up-to-date docs/APIs of a
**third-party** framework or library (Angular, EF Core, PrimeNG, nginx, …): `resolve-library-id` →
`get-library-docs`. Use it instead of recalling APIs from memory; **never** for this repo's own code (use
tokensave/serena).

**Load before use (mandatory).** All expose *deferred* tools — uncallable until fetched via
`ToolSearch` (e.g. `select:mcp__tokensave__tokensave_context,mcp__markdown__get_section`). Skip
this and agents silently fall back to `Grep` / `Read`.

**Routing table, per-server notes, and `Read`/`Grep` fallbacks:** [`.claude/mcp-routing.md`](.claude/mcp-routing.md).

## Scripts

**Binding** for every script — build / install / dev tooling / CI helpers / one-off automation:

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

**Binding** for all project documentation and LLM assets:

- **Concise + LLM-optimized.** Cut filler, marketing tone, "in this section we will explore" preambles. Every sentence earns its tokens.
- **Structure over prose — binding here, not aspirational.** Convert prose into the smallest readable structure that preserves every rule:
  - Steps → numbered list. Choices / mappings → table. "X means Y" → `**X.** Y` on its own line.
  - Multi-rule bullet ("do A; also B; warn C") → parent + sub-bullets, one rule per line.
  - Prose paragraph stating > 2 rules → restructure.

