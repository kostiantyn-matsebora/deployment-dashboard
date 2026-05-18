# Migration — Installer adds tarball download path

**Target release:** next minor after 2026-05-18.
**Affected adopters:** none — change is fully backward-compatible. Use this note to opt out of the `git` dependency.

## What changed

The installer (`install.sh` / `install.ps1`) now fetches the framework via the published GitHub Release **tarball / zip** for tagged refs (default), and falls back to `git clone --depth 1 --branch <ref>` only for branches, commits, and forks (`--repo` override).

Per-ref behaviour:

| `--ref` value | Source | Requires `git` on PATH? |
|---|---|---|
| `latest` (new default; was `main`) | Release tarball | No |
| `vX.Y.Z` | Release tarball | No |
| `main` / branch / SHA | `git clone --depth 1 --branch <ref>` | Yes |
| Any value with `--repo <fork-url>` | `git clone` | Yes (forks may not publish releases) |

Each tarball download is verified against the published `SHA256SUMS.txt`. Mismatch aborts the install before anything is unpacked.

Two adjacent bugs got fixed as part of this change:

1. **`install.ps1` scope-leak under `iex`.** When the script ran via `iwr <url> | iex`, the `param()` block executed in the caller's scope. If the user's session already had a `$Ref` / `$Target` / `$Adapter` variable defined (very common — `$Ref` is a stock PowerShell identifier), the `param` defaults didn't fire. PowerShell coerced the existing value via `[string]`, turning `$null` into `''`. Then `git clone --branch ''` triggered Windows `ERROR_INVALID_NAME` ("The filename, directory name, or volume label syntax is incorrect.") with no PowerShell wrapping — hard to diagnose. The installer now re-applies defaults if scope-leaked variables came in empty/whitespace.
2. **`install.ps1` provider-prefixed paths.** `(Get-Location).Path` returns paths like `Microsoft.PowerShell.Core\FileSystem::C:\…` when invoked on a non-FileSystem PSDrive. `git.exe` can't parse those. The installer now strips the provider prefix via `Resolve-Path -LiteralPath … .ProviderPath`.

The release pipeline (`release.yml`) also got an extended exclude list mirroring the install-time prune. Tarballs cut from the next release onwards ship "ready to use" — the install-time prune step becomes a no-op for tarball-sourced installs. The prune step is retained for backward-compat with `v0.1.0` (whose tarball still contains the pre-prune set).

## Action required

**None.** The default `--ref` changes from `main` to `latest`, but `latest` resolves to the most recent published release (currently `v0.1.0`) — semantically the same destination as `main` was for early adopters, with two improvements: (1) you get the audited release rather than bleeding-edge `main`, (2) no `git` dependency.

If you were relying on `--ref main` to track `main`, that still works — just call out `main` explicitly. Same for branch/SHA refs.

## Behavioural change to expect

- Adopters re-running `./install.sh --update-only --adapter <X>` after this change pull from the release tarball instead of `git clone`. Faster, no git dependency. `local/` is still preserved.
- New step-banner output: every external operation (download / checksum-verify / extract / install / clone) emits a `>> ...` line. Failures emit a structured dump of resolved variables (Ref, Target, RepoUrl, Adapter, PSVersion, cwd) so future bug reports are diagnosable from the console output alone.
- Future releases will ship pre-pruned tarballs. The install-time prune step still runs for backward compat with `v0.1.0`; safe + idempotent.

## Backward compatibility

- All existing flags (`--target`, `--adapter`, `--ref`, `--repo`, `--update-only` + `-Target` / `-Adapter` / `-Ref` / `-RepoUrl` / `-UpdateOnly`) work unchanged.
- Existing scripted invocations (`--ref v0.1.0`, `--ref main`, `--ref <sha>`) continue to work — routed to tarball or `git clone` per the table above.
- The default-`--ref` change (`main` → `latest`) is a behavioural delta only for adopters who relied on the previous default. Adopters who passed `--ref` explicitly are unaffected.

## Rollback

This is a strictly additive change to the fetch path plus a default-ref change. No filesystem layout differences. To pin to the pre-change installer behavior:

1. Pin framework to a pre-fix release (currently only `v0.1.0` exists, which has the old installer):
   ```bash
   ./install.sh --ref v0.1.0 --update-only --adapter <X>
   ```
2. Or pass `--ref main` to force the `git clone` fallback path.

## Issue reference

No issue — discovered while investigating an adopter-reported "filename, directory name, or volume label syntax is incorrect" error on Windows PowerShell.
