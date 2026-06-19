# Decommissioned PowerShell scripts (archive)

These are the **pre-port PowerShell originals** of the `scripts/` tree, retained
for reference / emergency rollback after the migration to Python 3.

- **Not wired into anything.** No Claude Code hook, CI workflow, or doc invokes
  these files — `.claude/settings.json` and `.github/workflows/scripts.yml` call
  the Python modules under `scripts/`.
- **Not maintained or tested.** Pester / PSScriptAnalyzer are no longer part of
  CI (see `.claude/scripts.md` → Python-first policy). The structure here mirrors
  the original `scripts/` layout so the set is restorable as a unit if needed.
- **Source of truth is the Python port.** Edit the live `*.py` modules, never
  these. Treat this directory as a frozen snapshot.

Replaced by the Python rewrite — git history at the pre-port commit also holds
these files.
