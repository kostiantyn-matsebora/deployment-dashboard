---
name: ginee-update
description: Update the installed ginee framework in place to a release or named ref. Triggers: 'update ginee'; 'upgrade the framework'; 'pull the latest ginee'; 'bump ginee to v<X>'; 'update to ref <branch|sha>'; also session-start name check finding new upstream release.
---

**Scope.** `update`→latest via `/releases/latest`; `update <tag>`→that tag (downgrade needs `--allow-downgrade`); `update <branch|sha>`→`git clone --depth 1` (git on PATH) + "non-release ref" notice.

**Procedure.**

1. **Locate** `<fw>` = `.agents/ginee/`; need `<fw>/core/VERSION`. Else: `framework not found at <path> — pass --target to override`. The installer is intentionally NOT co-located (per D27); do not require `install.{ps1,sh}` inside `<fw>`.
2. **Read** `<fw>/core/VERSION` trimmed.
3. **Resolve.** No arg → `gh release view --json tagName --repo <upstream>` (else `iwr`/`curl` the `/releases/latest` API on that repo). `<tag>`/`<branch|sha>` verbatim; latter adds non-release notice. `<upstream>` = `local/framework.config.yaml § github.framework-repo`; default `kostiantyn-matsebora/ginee`.
4. **Compare.** Equal→`already at <v>`+exit. Lower (SemVer release tags only)→refuse without `--allow-downgrade`. Higher/non-release→proceed.
5. **Plan block — WAIT for `yes`/`proceed`** (never auto-run). Fields: Framework, Current `v<current>`, Target `v<target>`/`ref <branch|sha>`, Adapter, Command (per Step 6), Preserves `local/`, Replaces `core/`+`adapters/`+`extras/`.
6. **Fetch installer + Run.** Installer is not co-located — fetch from upstream at the target ref, then execute (D27).
   - `<adapter>` = single non-`_shared` subdir under `<fw>/adapters/`.
   - `<root>` = `<fw>/../..` (project root containing `.agents/`).
   - `<raw>` = `https://raw.githubusercontent.com/<upstream>/<target>/install.{ps1|sh}`.
   - `<repo-url>` = `https://github.com/<upstream>`.
   - Win: `iwr -useb <raw>.ps1 -OutFile <tmp>/install.ps1; pwsh -File <tmp>/install.ps1 -Target <root> -Adapter <adapter> -Ref <target> -RepoUrl <repo-url> -UpdateOnly`.
   - Non-Win: `curl -fsSL <raw>.sh -o <tmp>/install.sh && bash <tmp>/install.sh --target <root> --adapter <adapter> --ref <target> --repo <repo-url> --update-only`.
   - Stream stdout/stderr; capture exit.
7. **Report.** `core/VERSION` `old→new`. Diff `local/index/manifest.yaml` SHA-256s vs fresh `core/`; on drift **never auto-reindex** — offer `ginee-reindex` per `core/index-protocol.md § Pre-dispatch staleness check`. Excerpt `docs/CHANGELOG.md` `(old,new]`. List new `core/MIGRATIONS/` + each `## Action required` if any; recommend `@team-lead rediscover` if any cites discovery/class/role catalog.

**Forbidden.** Edit `local/*`; mask installer failure (must surface exit code + last 20 lines stderr; no silent retry); bypass adopter's pinned `--ref` (`local/framework.config.yaml § framework.pinned-ref`) without confirming; assume installer is co-located (D27 — always fetch).
