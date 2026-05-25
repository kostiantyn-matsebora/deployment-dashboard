---
name: ginee-update
description: Update the installed ginee framework in place to a release or named ref. Triggers: 'update ginee'; 'upgrade the framework'; 'pull the latest ginee'; 'bump ginee to v<X>'; 'update to ref <branch|sha>'; also session-start name check finding new upstream release.
---

**Scope.** `update`→latest via `/releases/latest`; `update <tag>`→that tag (downgrade needs `--allow-downgrade`); `update <branch|sha>`→`git clone --depth 1` (git on PATH) + "non-release ref" notice.

**Procedure.**

1. **Locate** `<fw>` = `.agents/ginee/`; need `<fw>/core/VERSION`. Else: `framework not found at <path> — pass --target to override`. The installer is intentionally NOT co-located; do not require `install.{ps1,sh}` inside `<fw>`. Migrations are also intentionally NOT co-located — `<fw>/migrations/` and `<fw>/core/MIGRATIONS/` (legacy) are absent on current installs; fetched on demand in Step 7.
2. **Read** `<fw>/core/VERSION` trimmed.
3. **Resolve.** No arg → `gh release view --json tagName --repo <upstream>` (else `iwr`/`curl` the `/releases/latest` API on that repo). `<tag>`/`<branch|sha>` verbatim; latter adds non-release notice. `<upstream>` = `local/framework.config.yaml § github.framework-repo`; default `kostiantyn-matsebora/ginee`.
4. **Compare.** Equal→`already at <v>`+exit. Lower (SemVer release tags only)→refuse without `--allow-downgrade`. Higher/non-release→proceed.
5. **Plan block — WAIT for `yes`/`proceed`** (never auto-run). Fields: Framework, Current `v<current>`, Target `v<target>`/`ref <branch|sha>`, Adapter, Command (per Step 6), Preserves `local/`, Replaces `core/`+`adapters/`+`extras/`.
6. **Fetch installer + Run.** Installer is not co-located — fetch from upstream at the target ref, then execute.
   - `<adapter>` = single non-`_shared` subdir under `<fw>/adapters/`.
   - `<root>` = `<fw>/../..` (project root containing `.agents/`).
   - `<raw>` = `https://raw.githubusercontent.com/<upstream>/<target>/install.{ps1|sh}`.
   - `<repo-url>` = `https://github.com/<upstream>`.
   - Win: `iwr -useb <raw>.ps1 -OutFile <tmp>/install.ps1; pwsh -File <tmp>/install.ps1 -Target <root> -Adapter <adapter> -Ref <target> -RepoUrl <repo-url> -UpdateOnly`.
   - Non-Win: `curl -fsSL <raw>.sh -o <tmp>/install.sh && bash <tmp>/install.sh --target <root> --adapter <adapter> --ref <target> --repo <repo-url> --update-only`.
   - Stream stdout/stderr; capture exit.
7. **Report + fetch migrations + per-item apply gate.** `core/VERSION` `old→new`. Diff `local/index/manifest.yaml` SHA-256s vs fresh `core/`; on drift **never auto-reindex** — offer `ginee-reindex` per `core/protocols/index-protocol.md § Pre-dispatch staleness check`. Excerpt `docs/CHANGELOG.md` `(old,new]`. Migrations are upstream-only — fetch + surface + apply via the sub-procedure below. Recommend `@team-lead rediscover` if any cites discovery/class/role catalog.
   1. **Enumerate.** `gh api repos/<upstream>/contents/migrations?ref=<new>` (else `iwr/curl` the same Contents API URL). The CHANGELOG excerpt's `### Added` / `### Changed` blocks for the `(old, new]` window cite migration filenames inline; cross-reference the directory listing against the CHANGELOG cites to filter the relevant subset.
   2. **Fetch.** Per entry, `iwr/curl` `https://raw.githubusercontent.com/<upstream>/<new>/migrations/<file>` to memory.
   3. **Surface.** One block per migration — H1 title · 5-line summary · `## Action required` section verbatim (or `(none)`) · raw-URL footnote. End with a numbered approval prompt.
   4. **Gate.** Per migration prompt `Apply migration "<slug>"? [yes/skip/all-yes/all-skip]`. Apply only on `yes` / `all-yes`. Never persist to disk unless invoked by the migration body itself.
   5. **Report skips.** Post-update report carries one line per skipped migration with reason `user-skipped at <ISO>`; never silent.
   6. **Network failure.** Fetch failure surfaces inline (`migration fetch failed: <HTTP code|error>; check <upstream-URL>/migrations manually for the v<old>→v<new> window`). Never silent retry; never block on network — framework files already landed in Step 6.

**Forbidden.** Edit `local/*`; mask installer failure (must surface exit code + last 20 lines stderr; no silent retry); bypass adopter's pinned `--ref` (`local/framework.config.yaml § framework.pinned-ref`) without confirming; assume installer is co-located; assume migrations are co-located under `<fw>/migrations/` or `<fw>/core/MIGRATIONS/` (always fetch from upstream); apply a migration without explicit `yes` at the Step 7.4 gate; silently retry on migration-fetch failure (always surface to the user).
