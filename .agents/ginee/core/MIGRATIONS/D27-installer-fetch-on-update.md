# Migration — D27 installer fetched from upstream on update

**Target release:** next minor after 2026-05-22 (`v0.12.0`).
**Affected adopters:** every adopter on every adapter — opt-in; no breaking change to the installer itself.

## What changed

The `ginee-update` skill no longer requires `install.ps1` / `install.sh` to live inside `.agents/ginee/`. Standard installs (curl/iwr bootstrap or `install.{ps1,sh} -Adapter <X>`) **intentionally prune the installer scripts** from the framework dir — they belong to the bootstrap layer, not the runtime layer. Pre-D27 the skill's Step 1 precondition (`need install.ps1+install.sh+core/VERSION` inside `<fw>`) failed for every adopter, exiting with a misleading `framework not found at <path>` message even when the framework was correctly installed.

D27 fixes this by aligning the update flow with the bootstrap pattern:

| Step | Pre-D27 | Post-D27 |
|---|---|---|
| **Step 1 (Locate)** | Require `install.ps1` + `install.sh` + `core/VERSION` inside `<fw>`. | Require **only** `<fw>/core/VERSION`. The framework existence sentinel is `VERSION`, not the installer. |
| **Step 1 error message** | `framework not found at <path>` — wrong (framework *was* found; installer just wasn't co-located). | Same wording, but now accurate (truly fires only when `core/VERSION` is missing). |
| **Step 6 (Run)** | `pwsh -File <fw>/install.ps1 -UpdateOnly -Ref <target>` — failed: no such file. | Fetch installer from upstream raw URL at the target ref → execute from temp dir. |
| **Adapter detection** | Not in scope (Step 6 implicitly assumed installer would prompt or be re-invoked manually). | Read from `<fw>/adapters/` — single non-`_shared` subdir. Passed to installer via `-Adapter`. |
| **Project root** | Not in scope. | `<fw>/../..` (i.e., parent of `.agents/`). Passed via `-Target`. |
| **Upstream URL** | Hard-coded in installer. | From `local/framework.config.yaml § github.framework-repo` (default `kostiantyn-matsebora/ginee`). Passed via `-RepoUrl`. Same key D14 + `ginee-file-framework-*` already use. |

The installer itself (`install.ps1` / `install.sh`) is unchanged. D27 is strictly a change to how the **skill** locates and invokes it.

Affected files:

- `core/skills/ginee-update/SKILL.md` — Steps 1 + 6 + `Forbidden` block.
- `adapters/{claude,copilot-cli,agents-md,generic}/install.md` § Updates — replace `.\install.ps1 -UpdateOnly` "recommended" line (implied a co-located installer) with the `/ginee-update` skill as primary path + bootstrap one-liner as manual fallback.
- `core/MIGRATIONS/D27-installer-fetch-on-update.md` — this file (NEW).
- `PLAN.md` — D27 locked-decision entry.
- `CLAUDE.md` — D27 row in the locked-decisions table.
- `docs/` co-update per D25 binding — `CONCEPTS.md`, `GETTING_STARTED.md`, `CHEATSHEET.md`, `CHANGELOG.md`.

## Why

Three trade-offs considered:

| Option | Approach | Verdict |
|---|---|---|
| **(a) Skill fetches installer from upstream** | Skill resolves target ref → downloads `install.{ps1,sh}` from raw URL at that ref → runs from temp. Adapter + project-root + upstream-URL detected from the existing tree + config. | **Chosen.** Bootstrap pattern is symmetric (same as `iwr | iex`). `.agents/ginee/` stays runtime-only. No version skew (a stale local installer can never drive a newer-ref update). Network already required at update time to fetch the new framework. |
| (b) Installer drops a copy of itself into `<fw>` | Bootstrap installs `install.{ps1,sh}` into `<fw>/`; skill drives the co-located copy. | Rejected. Creates stale-installer-drives-new-ref version skew — installer breaking changes silently affect update flow. Pollutes the runtime tree with deploy-layer artefacts. Existing installs still miss the file → still need a fallback chain. |
| (c) Fallback chain | `<fw>/install.ps1` → project-root `install.ps1` → upstream fetch. | Rejected. More moving parts; ambiguous which layer "won." Hides version-skew risk of (b) behind a "graceful fallback" that still exists. |

(a) wins because it matches the existing bootstrap mental model (`iwr | iex`), keeps `.agents/ginee/` pure-runtime, and avoids version skew without adding fallback complexity.

## Adopter action

**Chicken-and-egg.** The pre-D27 skill is the broken artefact — it can't update itself. To land the fix on existing installs, run the bootstrap one-liner **once** (the documented workaround in issue #67):

```powershell
$env:GINEE_UPDATE_ONLY='1'; $env:GINEE_ADAPTER='<claude|copilot-cli|agents-md|generic>'; iwr -useb https://raw.githubusercontent.com/kostiantyn-matsebora/ginee/main/install.ps1 | iex
```

```bash
GINEE_UPDATE_ONLY=1 GINEE_ADAPTER=<claude|copilot-cli|agents-md|generic> bash -c "$(curl -fsSL https://raw.githubusercontent.com/kostiantyn-matsebora/ginee/main/install.sh)"
```

After this one-time bootstrap, the refreshed skill body lands in `.claude/skills/ginee-update/` (or the equivalent per adapter) and `/ginee-update` works for all future updates.

No `local/*` edits required. No `framework.config.yaml` schema change. If `github.framework-repo` was already set (per D14), the skill picks it up automatically.

## Behavioural change to expect

- `/ginee-update` (or "update ginee") now succeeds against any standard install when a newer upstream release exists. Pre-D27 it exited at Step 1 with the misleading `framework not found at <path>` for every adopter.
- The Step-5 plan block continues to show the resolved installer command before any execution — but the command path now points at a temp dir (`<tmp>/install.ps1` / `<tmp>/install.sh`) rather than the (never-present) `<fw>/install.ps1`.
- Step 6 streams the same step-banner output the installer always emitted (`>> Downloading ginee-vX.Y.Z.zip`, `>> Verifying SHA256`, `>> Extracting`, …); failure surface unchanged.
- Forks: adopters who set `github.framework-repo: <fork-owner>/ginee` will have the skill fetch the installer from that fork's raw URL. Forks that don't publish releases still need `--ref <branch|sha>` per `installer-tarball-path.md` (git-clone fallback inside the installer).

## Safeguards

- **Never auto-update.** Step 5 of the procedure remains a hard approval gate.
- **Never edit `local/*`** — mirrors the installer's `local/` preservation guarantee.
- **Never silent retry on installer failure** — exit code + last 20 lines of stderr surface immediately.
- **Never assume installer is co-located** — the skill always fetches; pre-D27 assumption removed from the `Forbidden` block.
- **Pinned ref still honoured** — `local/framework.config.yaml § framework.pinned-ref` continues to gate the resolved target per Step 3.

## Backward compatibility

- **Installer unchanged.** `install.ps1` / `install.sh` take the same flags, behave the same way, prune the same paths.
- **Manual bootstrap one-liner unchanged** — `GINEE_UPDATE_ONLY=1 ... | iex` continues to work as both the manual fallback and the one-time chicken-and-egg recovery for pre-D27 installs.
- **No schema change** to `local/framework.config.yaml`. `github.framework-repo` was already wired in D14.
- **No breaking change to the skill's external surface.** Same triggers (`/ginee-update`, "update ginee", …), same plan-block layout, same post-update report. Only the resolution + invocation internals changed.
- Adopters on pre-D27 framework versions can keep using the manual bootstrap one-liner indefinitely — the skill is a convenience surface, not a replacement.

## Rollback

D27 is purely a skill-internal change. To revert:

1. Replace `core/skills/ginee-update/SKILL.md` with the pre-D27 version (recover from git history at `d1a145f` or earlier).
2. Optionally drop D27 from `PLAN.md` + `CLAUDE.md` + this file.

The installer + bootstrap path are untouched, so no further rollback steps are needed.

## Issue reference

Closes [#67](https://github.com/kostiantyn-matsebora/ginee/issues/67) — "ginee-update skill: install.ps1/install.sh precondition unreachable after standard install."
