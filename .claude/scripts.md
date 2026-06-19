## Scripts

**Binding** for every script — build / install / dev tooling / CI helpers / one-off automation:

- **Language.** Python 3 (`.py`). Target **Python 3.11+** for cross-platform parity (Windows / Linux / macOS). Stdlib-only at runtime — a ported script imports no third-party package so it stays invocable by path (e.g. a Claude Code hook runs `python3 scripts/hooks/<name>.py`).
- **No alternative shells.** No `bash` / `sh` / `zsh` / `cmd` / PowerShell (`.ps1` / `.psm1`) scripts as the primary deliverable. Single-line invocations inside CI YAML are exempt. **Bootstrap exception** — see below.
- **Tests required.** Every script MUST have **pytest** coverage. No script merges without its suite. Tests use real implementations — **no mocks**; inject collaborators as plain callables.
- **Test location.** pytest suites live in the **same directory** as the script under test (sibling files). No mirror tree.
  - Example: `scripts/install.py` ➜ `scripts/install_test.py`.
  - Example: `scripts/hooks/invoke_pre_commit_docs_hook.py` ➜ `scripts/hooks/invoke_pre_commit_docs_hook_test.py`.
  - Example: `.github/actions/notify/notify.py` ➜ `.github/actions/notify/notify_test.py`.
- **File naming.** Module = `snake_case.py`; suite filename = `<script-basename>_test.py`.
- **Lint.** `ruff` (config in `scripts/pyproject.toml`) lints every script and suite; a lint error blocks merge.
- **CI gate.** `pytest` recurses `scripts/` and discovers every `*_test.py`; a red suite blocks merge.
- **Library-mode hook.** Importing a module never runs its entry block — side-effecting logic lives in `main()` guarded by `if __name__ == "__main__": main()`, so tests `import` and exercise the pure functions directly (the Python equivalent of the former `-AsLibrary` switch).

### Bash bootstrap exception

A `bash` script is permitted **only** when Python cannot run the logic — i.e. bootstrapping the environment *before* `python3` exists (installing the Python toolchain itself, pre-`python` remote-env setup). It is never the primary deliverable for anything `python3` can do.

- **Tested with `bats`** (Bats-core), not pytest — bash cannot be exercised through pytest's loader.
- **Test location.** `.bats` suite lives in the **same directory** as the `.sh` under test (sibling). No mirror tree.
  - Example: `scripts/hooks/install-dependencies.sh` ➜ `scripts/hooks/install-dependencies.bats`.
- **File naming.** Suite filename = `<script-basename>.bats`.
- **CI gate.** The scripts pipeline installs `bats` and runs it recursively over `scripts/`; every `.sh` MUST have a `.bats` sibling, and a red suite blocks merge — same rule as pytest for `.py`.
