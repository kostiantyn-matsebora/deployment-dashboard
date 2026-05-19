---
name: devops-engineer-local
description: Project-local extension to the cardinal `devops-engineer` charter (`.agents/ginee/core/roles/devops-engineer.md`). Captures deployment-dashboard-specific craft notes — gotchas, conventions, and tooling-version pins that benefit this project's devops dispatches but don't belong on the framework-upstream side.
aliases: [platform-engineer]
---

# DevOps Engineer — project-local extension

Load this **alongside** the cardinal charter (`.agents/ginee/core/roles/devops-engineer.md`). The cardinal owns the generic craft; this file owns deployment-dashboard-specific knowledge that the cardinal deliberately stays stack-agnostic about.

## Cross-OS PowerShell craft

This project ships PowerShell scripts that run on **both** Windows developer hosts AND Linux CI runners (`ubuntu-latest` per `.github/workflows/scripts.yml`). The runtime is **PowerShell 7+ (pwsh)** on both. The Pester test suite under `testing/scripts/*.Tests.ps1` invokes each script as a subprocess and asserts on its side-effects, so any cross-OS divergence in the script's own behaviour is visible as a CI failure on `ubuntu-latest`.

Affected files (today):
- `install/install.ps1`, `install/uninstall.ps1` (release-install entrypoints).
- `dev_env/start.ps1`, `dev_env/stop.ps1` (local-dev wrappers).
- `testing/scripts/*.Tests.ps1` (Pester test code — qa-owned, but driven by the same cross-OS requirement).

### Rule — favour cross-platform APIs over `$env:*` for OS-provided paths

| Don't | Use | Why |
|---|---|---|
| `$env:TEMP` | `[System.IO.Path]::GetTempPath()` | `$env:TEMP` is Windows-only; on Linux it's unset and `Join-Path $null` throws. `GetTempPath()` returns the OS-appropriate dir (`C:\Users\<u>\AppData\Local\Temp\` / `/tmp/` / `/var/folders/.../T/`). |
| `$env:USERPROFILE` | `[Environment]::GetFolderPath('UserProfile')` | `$env:USERPROFILE` is Windows-only; the .NET call resolves to `$HOME` on POSIX. |
| `$env:APPDATA` / `$env:LOCALAPPDATA` | `[Environment]::GetFolderPath('ApplicationData')` / `'LocalApplicationData'` | Same reason — `$env:*` variants are Windows-only. |
| Hard-coded `\` in paths | `Join-Path` or `[System.IO.Path]::Combine()` | The `\` separator works on Windows only. PS 7 accepts `/` everywhere; `Join-Path` produces the right separator per OS. |

**The general framing:** when the script reaches for a "where is this special OS-provided directory" answer, use `[System.IO.Path]` / `[Environment]` static methods. The `$env:*` form is fine for user-supplied values (`$env:GHA_TOKEN`, `$env:DASHBOARD_API_TOKEN`) but not for OS-provided defaults.

### Rule — Pester test suites must run identically on both runners

The CI workflow `.github/workflows/scripts.yml` runs the Pester suite on `ubuntu-latest` only today (and locally on Windows during development). Both surfaces must pass; "green on Windows but red on Linux" or vice versa is a P1 defect — fix in the test file, not by skipping the test or pinning the runner.

When authoring or reviewing a new test:

1. Search for `$env:TEMP` / `$env:USERPROFILE` / `$env:APPDATA` in the test body. Reject the test if any are present.
2. Search for `\\` in path literals. Reject if any are present (use `Join-Path` / `/`).
3. For subprocess invocation, prefer `Start-Process pwsh -NoProfile -File <script>` over `& pwsh.exe ...` — `pwsh.exe` is Windows-only.
4. When asserting on file outputs, use `-LiteralPath` rather than `-Path` to avoid wildcard surprises on either OS.

### Rule — `.gitattributes` is the EOL safety net

The repo has no `.gitattributes` and relies on each contributor's local `core.autocrlf` setting. The bats test files were explicitly fixed to LF during the issue #7 cycle (per the qa-engineer's Phase 5 report); PowerShell files happen to tolerate CRLF on Linux but it's fragile — here-strings with the closing `"@` / `'@` at column 0 can break under certain CRLF + parser combinations.

If `core.autocrlf=true` is ever introduced (default on Windows installs), add `.gitattributes` with `*.sh text eol=lf` + `*.bats text eol=lf` to keep the bash + bats files in LF. PowerShell files are case-by-case but `*.ps1 text eol=lf` is the safest default.

## History — past CI failures rooted in cross-OS gaps

A log of past defects, kept short to surface patterns rather than enumerate every fix:

| Date | Defect | Fix | Root-cause class |
|---|---|---|---|
| 2026-05-19 | PR #9 Pester job failed 0/52 on `ubuntu-latest` (Windows green). | Swap `Join-Path $env:TEMP "..."` → `Join-Path ([System.IO.Path]::GetTempPath()) "..."` in all four `.Tests.ps1` files. | OS-provided-path env-var Windows-isms (see § Cross-OS PowerShell craft rule). |

Add a row when a future cross-OS defect lands; one line each, with the root-cause class column linking back to the rule that would have caught it.

## Source of truth — augmentations beyond the cardinal

The cardinal charter's "Source of truth" table covers index files that exist in `local/index/`. Add to that list:

| Read | What it gives you | Load when |
|---|---|---|
| This file (`local/roles/devops-engineer.md`) | Project-local devops gotchas + cross-OS rules + CI defect history. | **always** alongside the cardinal charter |

## Out of scope for this file

- **The cardinal devops craft** (IaC patterns, container-image layering, secret rotation, etc.) — that's in `core/roles/devops-engineer.md`. This file extends with project-specific knowledge only.
- **Project routing / role boundaries** — those live in `local/bindings.md`.
- **Specific index recipes** — those live under `local/index/*` per `core/index-protocol.md`.
- **Architecture / CR / ADR semantics** — `solution-architect` owns those.
