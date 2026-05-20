# Migration — D18: DevOps script-quality obligation

**Target release:** next minor after 2026-05-19 (`core/VERSION` → `0.2.0`).
**Affected adopters:** every adopter project that has devops-owned PowerShell / bash scripts.
**Closes:** [#28](https://github.com/kostiantyn-matsebora/ginee/issues/28), [#30](https://github.com/kostiantyn-matsebora/ginee/issues/30).

## What changed

DevOps-owned PowerShell / bash scripts now ship three deliverables in the same task / same PR:

| Deliverable | PowerShell | bash | Gate |
|---|---|---|---|
| Lint | `PSScriptAnalyzer` | `shellcheck` | Zero error-level findings on changed/added scripts. |
| Unit tests | `Pester` | `bats-core` | Every changed/added function or top-level branch covered. |
| Coverage | `Invoke-Pester -CodeCoverage` | `bashcov` or `kcov` | `≥` adopter threshold on **changed + added** line set (framework default `90`). |

Authorship boundary moves from `qa-engineer` to `devops-engineer` for files in the devops-owned tree. QA retains script-suite ownership for seed / cleanup / smoke / scenario-harness glue under the QA tree.

## Modified

- `core/roles/devops-engineer.md` — Forbidden-actions carve-out narrowed; new `## Script-quality obligation` section.
- `core/roles/devops-engineer.details.md` — `§ Container ownership` adds script-quality-artefacts row; `§ CI/CD pipelines` promotes script lint+tests+coverage from optional step to required step 6.
- `core/roles/qa-engineer.md` — frontmatter `description` narrowed; `§ Required test layers` Script/CI row narrows QA scope to QA-owned scripts.
- `core/roles/qa-engineer.details.md` — `§ Script-suite tests` scoped to QA-owned scripts only.
- `core/templates/framework.config.yaml` — new `devops-scripts:` block (`tests-path`, `coverage-threshold`, `coverage-tool-bash`, optional `coverage-grace`).
- `core/templates/bindings.md` — `Roles — deterministic routing` + `Project role boundaries` rows updated to reflect the split.

## Action required

### Adopters

After re-fetching framework files on upgrade:

1. **Decide test location.** Where the unit tests for your devops-owned scripts will live. Recommended: sibling `tests/` next to each devops script root (e.g. `dev_env/tests/`, `.github/actions/<name>/tests/`).
2. **Wire `devops-scripts:` in `local/framework.config.yaml`:**
   ```yaml
   devops-scripts:
     tests-path: tests/                # adjust to your layout
     coverage-threshold: 90            # framework default; lower temporarily for catch-up
     coverage-tool-bash: bashcov       # bashcov | kcov | null (if no bash scripts)
     # coverage-grace: 2026-09-01      # optional adopter-declared catch-up window
   ```
3. **Pick the bash coverage tool** when you have bash scripts: `bashcov` (Ruby; richer reporting) or `kcov` (C; lighter). PowerShell uses native `Invoke-Pester -CodeCoverage`.
4. **Add lint config beside the scripts:**
   - PowerShell — `PSScriptAnalyzerSettings.psd1` (start from the default ruleset; suppress with justification).
   - bash — `.shellcheckrc` (start with default severity = `error`).
5. **Wire the same gate into PR validation CI** per `devops-engineer.details.md § CI/CD pipelines` step 6. Local + CI invoke the same runners with the same threshold — no duplicate CI-only implementation.
6. **Optional backfill task** — file an issue like `[Tech debt] Backfill script tests for existing devops scripts` if your repo has untested legacy scripts. The rule only gates **changed + added** lines; untouched legacy is grandfathered.

### Boundary-move impact on QA

- QA's `## Required test layers § Script / CI` row narrowed to seed / cleanup / smoke / scenario-harness glue.
- Existing QA-authored Pester / bats tests for devops-owned scripts can stay where they are or move into the devops tree; the boundary applies to **new** changes. If you do move them, the boundary aligns with the file's owning role per `local/bindings.md § Project role boundaries`.

## Backward compatibility

- **Soft break.** Adopters with existing untested devops scripts start the next devops task with a coverage debt. Mitigations:
  - **Grandfather**: rule applies only to scripts changed / added after the upgrade.
  - **Grace key**: `devops-scripts.coverage-grace` declares a finite catch-up window.
  - **Threshold lower**: temporarily set `devops-scripts.coverage-threshold` below 90 — deviation visible in PR.
- **No-tooling escape valve.** Adopters without coverage tooling configured surface this as a discovery gap to `team-lead` (per `devops-engineer.md § Script-quality obligation` last rule) — adopter wires the runners via a one-shot backfill task before the next devops change. The rule never silently lowers the bar.

## Rationale

Pre-D18, script-suite tests were QA-authored on a different cadence than the script change, so devops changes shipped without unit coverage and regressions surfaced only on the next live run. This contradicted devops's own `## Post-step health verification` rule. The carve-out keeps QA owning seed / cleanup / smoke / scenario-harness glue (their cadence) while moving the lint + unit-test + coverage gate onto the script author's own iteration.

Sub-issue [#30](https://github.com/kostiantyn-matsebora/ginee/issues/30) expanded the obligation from "unit tests only" to "lint + unit tests + coverage" — lint catches the failure modes Pester / bats cannot (parameter binding, unsafe quoting, unused vars), and bundling all three into a single gate avoids three serial round-trips per script change.
