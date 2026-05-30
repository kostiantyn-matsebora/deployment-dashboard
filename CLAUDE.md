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

## Solution directory structure

Architecture-only baseline — no service code committed yet (per commit `d0045c6`). The tree below is authoritative; reserved slots are listed separately.

**Present today:**

| Path | Role |
|---|---|
| `docs/` | All design + contract documentation (see *Sources of truth*). |
| `backend/[service]` | Backend services |
| `frontend/[application]` | Frontend application |
| `testing/[type]` | Testing solutions |

**Reserved (planned, not present).** Slots referenced by `.dockerignore` and SAD §7 awaiting implementation:

| Path | Future role |
|---|---|
| `infrastructure/` | Terraform modules — Azure-only per NFR-01 / NFR-06. |
| `dev_env/` | Local-dev compose / fixtures. |

## Git

**Never push directly to `main`.** Always branch → commit → PR, regardless of change size.
- Exception: user explicitly instructs a direct push to `main`.
- Default when user says "push": push the current branch, not `main`.

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
