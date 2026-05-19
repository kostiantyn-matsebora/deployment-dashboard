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

## Cross-OS gh CLI use

The release installer (`install/install.{ps1,sh}`) takes a hard dependency on
the **GitHub CLI (`gh`)** running on the adopter's host. The release repo +
GHCR images are both private; `gh` is the auth transport for both surfaces
(asset download via `gh release download`; GHCR docker login via `gh auth
token | docker login`). This applies on Windows + macOS + Linux uniformly —
no per-OS divergence in the script's auth model.

Affected files:
- `install/install.ps1`, `install/install.sh` (release-install entrypoints — embed the gh prereq probe + the gh-mediated asset fetch + the gh-mediated GHCR login).
- `dev_env/start.ps1`, `dev_env/stop.ps1` (local-dev — NOT affected; the contributor flow builds images from source, no GHCR pull, no release-asset fetch).
- `testing/scripts/*.Tests.ps1` (Pester — affected only insofar as the test suite needs a `gh` shim / mock when running offline).

### Rule — gh is a hard prereq; probe early, fail fast

The installer's first action — before any `docker compose` invocation — must
verify three things:

| Check | Command | Fail message |
|---|---|---|
| `gh` is on `PATH` | `gh --version` | `'gh' CLI not found on PATH. Install via 'winget install GitHub.cli' (Windows) / 'brew install gh' (macOS) / 'apt install gh' or 'dnf install gh' (Linux), then re-run.` |
| `gh` is authenticated for `github.com` | `gh auth status --hostname github.com` (exit 0) | `gh is not authenticated for github.com. Run 'gh auth login' and retry.` |
| `gh` token carries GHCR read access — any of `read:packages`, `write:packages`, or `admin:packages` | parse `gh auth status --hostname github.com --show-token` output for the scope list (under `Token scopes:`) and regex-match `(read\|write\|admin):packages`. The scope model is hierarchical (`write` ⊃ `read`; `admin` ⊃ both), and `gh` only emits the highest granted scope — matching only `read:packages` rejects valid `write:packages`-granted tokens. | `gh token for github.com lacks GHCR read access. Need one of: 'read:packages', 'write:packages', or 'admin:packages'. Run 'gh auth refresh --hostname github.com --scopes read:packages' and retry.` |

All three fail fast; none of the three fall back to "try without". The user
gets a friendly, actionable error before any docker work starts.

### Rule — wrap `gh --version` (and any "is gh installed" probe) in try/catch under PowerShell

PowerShell's `$ErrorActionPreference = 'Stop'` (which `install.ps1` sets at
the top per the cardinal devops charter) turns
`System.Management.Automation.CommandNotFoundException` into a script-terminating
error. That means a bare `gh --version` invocation, when `gh` is missing,
**terminates the script before the friendly error path can fire** — the user
sees the raw stack trace instead of "install gh via winget …".

The portable shape:

```powershell
$ErrorActionPreference = 'Stop'

$ghAvailable = $false
try {
    $null = & gh --version 2>&1
    $ghAvailable = $LASTEXITCODE -eq 0
} catch [System.Management.Automation.CommandNotFoundException] {
    $ghAvailable = $false
}

if (-not $ghAvailable) {
    Write-Error "'gh' CLI not found on PATH. Install via 'winget install GitHub.cli' (Windows) / 'brew install gh' (macOS) / 'apt install gh' or 'dnf install gh' (Linux), then re-run."
    exit 1
}
```

The same wrap applies to any subsequent gh invocation that might race a
session-state change (`gh auth status` after a manual `gh auth logout` mid-run):
let the cmd's exit code drive the friendly error, not the terminating
exception.

In bash (`install.sh`), the equivalent shape is:

```bash
if ! command -v gh >/dev/null 2>&1; then
    echo "Error: 'gh' CLI not found on PATH. Install via 'brew install gh' (macOS) / 'apt install gh' (Debian/Ubuntu) / 'dnf install gh' (Fedora/RHEL)." >&2
    exit 1
fi
```

`command -v` is the POSIX-portable "is it on PATH" check; `which` is BSD/GNU-
divergent and not safe across the macOS + Debian + Alpine matrix.

### Rule — `read:packages` is not in the gh default scope set, and scopes are hierarchical

A vanilla `gh auth login` produces a token with the default scope set
(`repo`, `read:org`, `gist`, `workflow`); **none of `read:packages` /
`write:packages` / `admin:packages` is in that list**. The installer's
probe (above) must match any of the three on `gh auth status --show-token`
output — GitHub's OAuth scopes are hierarchical: `write:packages` includes
`read:packages` and `admin:packages` includes both, and `gh auth status`
only lists the highest granted scope. A regex narrowed to `read:packages`
literally rejects valid `write:packages`-granted tokens (which
*can* pull from GHCR). Use `(read|write|admin):packages` instead.

The friendly recovery command in the error message still suggests
`gh auth refresh ... --scopes read:packages` (the minimum grant);
users with higher-tier scopes don't need to act.

Do NOT have the installer try to silently `gh auth refresh` on the user's
behalf — that opens a browser flow that fails non-interactively (CI runners,
SSH'd hosts). The installer reports the missing scope and the user runs
`gh auth refresh` themselves.

### Rule — anonymous-vs-authed fetcher mode is split across two layers

Two `GHA_TOKEN`-related decisions live in two different files and **must
not be conflated**. The split is intentional and load-bearing — either
side can be edited without breaking the other.

| Layer | File | What it gates | Failure mode if conflated |
|---|---|---|---|
| **Install script gates user intent** | `install/install.{ps1,sh}` | Whether the operator is *allowed* to boot the fetcher without a real PAT. Bare `-Fetcher` / `--fetcher` without `$env:GHA_TOKEN` exits 1; `-Demo` / `--demo` is the only flag that permits a PAT-less boot. | If the script tried to also inspect transport behaviour ("is the running fetcher actually anonymous?"), it would need to read fetcher state at install time — a layering violation. |
| **Fetcher gates transport** | `backend/fetcher/Dashboard.Fetcher/DependencyInjection/ServiceCollectionExtensions.cs` (`ConfigureGitHubAuthorization`) | Whether the outgoing HTTP request carries an `Authorization` header. Real PAT → `Bearer <token>` (5000 req/h authed). Empty / whitespace / `local-dev-gha-token-placeholder` → no header at all (60 req/h anonymous). | If the fetcher tried to also gate on the install flag, it would couple runtime transport to install-time configuration, and the placeholder-in-compose-default contract would have to leak into the fetcher's options shape. |

The compose-default placeholder literal `local-dev-gha-token-placeholder`
in `install/docker-compose.release.yml` is the **contract anchor**
between the two layers: install side may omit the `GHA_TOKEN=` line in
`dashboard.env` (so compose falls back to the placeholder); fetcher side
recognises the placeholder as "no auth — go anonymous." Do not change
this literal in only one of the two files.

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
