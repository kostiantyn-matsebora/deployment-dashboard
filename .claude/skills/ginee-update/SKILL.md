---
name: ginee-update
description: Update the installed ginee framework in place to a release or named ref. Triggers: 'update ginee'; 'upgrade the framework'; 'pull the latest ginee'; 'bump ginee to v<X>'; 'update to ref <branch|sha>'; also session-start name check finding new upstream release.
---

**Scope.** `update`→latest via `/releases/latest`; `update <tag>`→that tag (downgrade needs `--allow-downgrade`); `update <branch|sha>`→`git clone --depth 1` (git on PATH) + "non-release ref" notice.

**Procedure.**

1. **Locate** `<fw>` = `.agents/ginee/`; need `install.ps1`+`install.sh`+`core/VERSION`. Else: `framework not found at <path> — pass --target to override`.
2. **Read** `<fw>/core/VERSION` trimmed.
3. **Resolve.** No arg → `gh release view --json tagName --repo kostiantyn-matsebora/ginee` (else `iwr`/`curl` the `/releases/latest` API on that repo). `<tag>`/`<branch|sha>` verbatim; latter adds non-release notice.
4. **Compare.** Equal→`already at <v>`+exit. Lower (SemVer release tags only)→refuse without `--allow-downgrade`. Higher/non-release→proceed.
5. **Plan block — WAIT for `yes`/`proceed`** (never auto-run). Fields: Framework, Current `v<current>`, Target `v<target>`/`ref <branch|sha>`, Adapter, Command `<installer> --update-only --ref <target>`, Preserves `local/`, Replaces `core/`+`adapters/`+`extras/`.
6. **Run.** Win `pwsh -File <fw>/install.ps1 -UpdateOnly -Ref <target>`; else `<fw>/install.sh --update-only --ref <target>`. Stream stdout/stderr; capture exit.
7. **Report.** `core/VERSION` `old→new`. Diff `local/index/manifest.yaml` SHA-256s vs fresh `core/`; on drift **never auto-reindex** — offer `ginee-reindex` per `core/index-protocol.md § Pre-dispatch staleness check`. Excerpt `docs/CHANGELOG.md` `(old,new]`. List new `core/MIGRATIONS/` + each `## Action required` if any; recommend `@team-lead rediscover` if any cites discovery/class/role catalog.

**Forbidden.** Edit `local/*`; mask installer failure (must surface exit code + last 20 lines stderr; no silent retry); bypass adopter's pinned `--ref` (`local/framework.config.yaml § framework.pinned-ref`) without confirming.
