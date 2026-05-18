# Migration — `engineering-team` → `ginee`

**Target release:** next minor after 2026-05-18.
**Affected adopters:** all installs prior to the D11 rebrand (`core/VERSION` ≤ `0.1.0`, installed under `.agents/engineering-team/`).

## What changed

The framework was renamed from the codename `engineering-team` to its formal name `ginee` (D11, 2026-05-18). Rationale + tagline: see `PLAN.md § D11`.

- **Install directory:** `.agents/engineering-team/` → `.agents/ginee/` (D8 revision).
- **Skill prefix:** unchanged (`ginee-*` was already the skill prefix as codename → formal name; see D16).
- **GitHub repo:** `kostiantyn-matsebora/engineering-team` → `kostiantyn-matsebora/ginee`. GitHub serves redirects, but the new label scheme + URLs only live on the new repo.
- **Issue labels:** `engineering-team:ready` / `:in-progress` / `:blocked` → `ginee:ready` / `:in-progress` / `:blocked`.

## Action required

**One step — auto-handled, three — adopter-owned.**

### 1. Install dir rename — installer auto-handles

`./install.sh --update-only --adapter <…>` (or `.\install.ps1 -UpdateOnly -Adapter <…>`) detects a legacy `.agents/engineering-team/` and renames it in place before fetching. `local/` carries over intact. No manual action.

### 2. CLAUDE.md pointer block — installer auto-refreshes (claude adapter)

The claude adapter installer now **detects-and-replaces** the pointer block on `-UpdateOnly` using the `## Engineering team framework` sentinel — body refreshes to the current template even when the block already exists. This generalizes beyond the rename: pointer blocks evolve across releases and previously never re-synced.

Other adapters: manual re-paste — see `adapters/<client>/install.md § Updates`.

### 3. `local/*` content rewrite — run the migration script

The installer cannot touch `local/` by design (`local/` is adopter-owned, survives updates). 17 hits across 8 files reference the old name in framework.config.yaml, bindings.md, project-profile.md, and the index/ entries.

Run from the adopter project root **after** the installer's `-UpdateOnly` pass:

```bash
.agents/ginee/core/scripts/migrate-engineering-team-to-ginee.sh
```

```powershell
.\.agents\ginee\core\scripts\migrate-engineering-team-to-ginee.ps1
```

The script:

- Rewrites every textual `engineering-team` occurrence under `local/` to `ginee` (preserves case for `Engineering-team` / `ENGINEERING-TEAM` if any).
- Rewrites `.agents/engineering-team/` path anchors under `local/index/*` to `.agents/ginee/`.
- Skips binary files + the `manifest.yaml` SHA-256 entries (content unchanged, only paths).
- Reports a per-file rewrite count.
- Idempotent: re-running on a clean tree is a no-op.
- Prints a final reminder about GitHub-side prerequisites (#4 below).

Equivalent one-liner if you prefer not to run the script:

```bash
grep -rl 'engineering-team' .agents/ginee/local/ | xargs sed -i 's|engineering-team|ginee|g'
```

```powershell
Get-ChildItem .agents\ginee\local -Recurse -File | ForEach-Object {
  (Get-Content $_.FullName -Raw) -replace 'engineering-team','ginee' | Set-Content $_.FullName -NoNewline
}
```

`/ginee-rediscover` regenerates `local/` from scratch — same effect on the rename, but destroys any hand-tuned content. Prefer the script for an in-place rewrite.

### 4. GitHub-side prerequisites — adopter-owned

If your project files framework issues to the framework upstream (per `local/framework.config.yaml § github.framework-repo`), check + update:

| Setting | Old value | New value |
|---|---|---|
| `github.framework-repo` | `kostiantyn-matsebora/engineering-team` | `kostiantyn-matsebora/ginee` |
| `github.ready-label` | `engineering-team:ready` | `ginee:ready` |
| `github.in-progress-label` | `engineering-team:in-progress` | `ginee:in-progress` |
| `github.blocked-label` | `engineering-team:blocked` | `ginee:blocked` |

GitHub redirects the repo URL on the API side, but label names do **not** auto-migrate — operations against the new repo with old label names silently no-op. The migration script rewrites these values in `framework.config.yaml`.

If you mirror the same label scheme on your **primary** repo (`github.repo`) for ginee-managed tasks, rename them via the GitHub UI or `gh label edit`.

## Behavioural change to expect

- `@team-lead pick up framework#<N>` continues to fail-fast when `github.framework-repo` is unset or points at the old repo without redirect — by design, per D14.
- Skill names + prefix (`ginee-*`) unchanged — no change to how workflows invoke.
- `local/index/manifest.yaml` SHA-256 entries are computed against current file content, not paths. The path-anchor strings in `local/index/*` files (`@.agents/engineering-team/...`) are textual cross-refs; rewriting them does not invalidate hashes.

## Backward compatibility

- **Codename `engineering-team` deprecated, not aliased.** Unlike the `project-manager` → `team-lead` rename (which retained `project-manager` as a permanent alias), `engineering-team` is **not** a runtime alias — it appeared only in paths, repo names, and labels, none of which carry alias semantics. Rewrite is required.
- **GitHub redirect.** The old `kostiantyn-matsebora/engineering-team` repo URL redirects via GitHub's standard rename cache — works for browser navigation + `git remote`. Labels do not redirect; the old scheme is silently missing on the new repo until renamed.
- **CI / scripts.** If your project's CI greps for `engineering-team` in framework files (`.agents/engineering-team/` paths), update to `.agents/ginee/`. The framework's own validation expects `ginee`.

## Rollback

Pre-rename installs continue to work — the codename rebrand is cosmetic at the framework layer. To pin:

1. `./install.sh --ref v0.1.0 --update-only --adapter <…>` (the last pre-rebrand tag, if available in releases).
2. Restore `.agents/engineering-team/` from git history if you committed it.
3. Revert any `local/*` rewrites your previous migration pass made.

No data loss in either direction.

## Issue reference

`#23` — *[Framework Bug] Upgrade leaves "engineering-team" references in adopter files — no rename migration, adapter pointer not re-synced.*
