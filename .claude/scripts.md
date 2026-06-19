## Scripts

**Binding** for every script — build / install / dev tooling / CI helpers / one-off automation:

- **Language.** PowerShell (`.ps1` / `.psm1`). Target **PowerShell 7+** (Core) for cross-platform parity (Windows / Linux / macOS).
- **No alternative shells.** No `bash` / `sh` / `zsh` / `cmd` / `python` scripts as the primary deliverable. Single-line invocations inside CI YAML are exempt. **Bootstrap exception** — see below.
- **Tests required.** Every script MUST have **Pester v5+** coverage. No script merges without its suite.
- **Test location.** Pester suites live in the **same directory** as the script under test (sibling files). No mirror tree.
  - Example: `scripts/install.ps1` ➜ `scripts/install.Tests.ps1`.
  - Example: `scripts/hooks/Invoke-PreCommitDocsHook.ps1` ➜ `scripts/hooks/Invoke-PreCommitDocsHook.Tests.ps1`.
  - Example: `.github/actions/notify/notify.ps1` ➜ `.github/actions/notify/notify.Tests.ps1`.
- **File naming.** Suite filename = `<script-basename>.Tests.ps1`.
- **CI gate.** `Invoke-Pester` recurses the repo root and discovers every `*.Tests.ps1`; a red suite blocks merge.
- **Library-mode hook.** Scripts intended for hook / pipeline reuse expose a `-AsLibrary` switch that defines functions without executing the entry block, so Pester can dot-source pure functions safely.

### Bash bootstrap exception

A `bash` script is permitted **only** when PowerShell cannot run the logic — i.e. bootstrapping the environment *before* `pwsh` exists (installing PowerShell itself, pre-`pwsh` remote-env setup). It is never the primary deliverable for anything `pwsh` can do.

- **Tested with `bats`** (Bats-core), not Pester — bash cannot be exercised through Pester's loader.
- **Test location.** `.bats` suite lives in the **same directory** as the `.sh` under test (sibling). No mirror tree.
  - Example: `scripts/hooks/install-dependencies.sh` ➜ `scripts/hooks/install-dependencies.bats`.
- **File naming.** Suite filename = `<script-basename>.bats`.
- **CI gate.** The scripts pipeline installs `bats` and runs it recursively over `scripts/`; every `.sh` MUST have a `.bats` sibling, and a red suite blocks merge — same rule as Pester for `.ps1`.
