# Releasing

## Versioning policy

**Unified SemVer.** One git tag drives all six service images; every image shares the same version string.

Pre-1.0 semantics: breaking changes may land between minor versions while `< 1.0`. See [CHANGELOG.md](CHANGELOG.md) header for the current statement.

| Image | What |
|---|---|
| `deployment-dashboard-api` | Write/Read API (.NET) |
| `deployment-dashboard-spa` | Angular SPA (frontend) |
| `deployment-dashboard-gateway` | nginx App Gateway |
| `deployment-dashboard-fetcher` | Pull-mode ingestion service |
| `deployment-dashboard-demo-driver` | Demo orchestration service |
| `deployment-dashboard-github-emulator` | GitHub REST emulator (demo/CI) |

All images are published to `ghcr.io/kostiantyn-matsebora/<image-name>`.

**Image tag format.** `metadata-action` strips the leading `v` from the git tag. A git tag `v0.1.0` publishes image tags `0.1.0`, `0.1`, and `latest`. Pre-release tags (`v0.1.0-rc.1`) publish only the full version — never `latest` or the major.minor short tag.

> **Footgun.** The git tag is `v0.1.0`; the image tag is `0.1.0` (no `v`). Setting `DASHBOARD_VERSION=v0.1.0` requests a tag that does not exist.

---

## Cutting a release

1. **Verify `main` is green** and `## [Unreleased]` in `CHANGELOG.md` reflects everything that is shipping.

2. **Run the prep script** from the repo root on `main` with a clean working tree:

   ```bash
   python3 scripts/release/new_release.py --bump minor
   ```

   - `--bump` choices: `major`, `minor`, `patch`. Use whichever matches the scope of the changes.
   - `--version X.Y.Z` overrides the bump calculation for an explicit version (no leading `v`).
   - `--dry-run` previews without mutating anything.

   The script validates a clean tree on `main` with no existing tag, renames `## [Unreleased]` to `## [X.Y.Z] - <date>`, inserts a fresh empty `## [Unreleased]` above it, creates a `release/vX.Y.Z` branch, commits `chore(release): vX.Y.Z`, pushes, and opens a PR.

3. **Review and merge the PR.** The CHANGELOG diff is the release notes.

4. **Manually tag the merged commit** (this step triggers the release workflow):

   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. **The tag push runs `.github/workflows/release.yml`**, which:
   - Builds and pushes all six images to GHCR under tags `X.Y.Z`, `X.Y`, and `latest`.
   - Extracts the matching `CHANGELOG.md` section as release notes.
   - Bundles `compose/*.yaml` + `compose/.env.example` into a zip artifact.
   - Creates the GitHub Release with notes and the compose bundle attached.
   - Publishes **two OCI Compose artifacts** to GHCR (see below).

   Published images appear at: `https://github.com/kostiantyn-matsebora/deployment-dashboard/pkgs/container/<image-name>`

### OCI Compose artifacts

The release workflow publishes two Compose projects as OCI artifacts, enabling adopters to run the stack with a single command — no clone, no curl:

| Artifact | Source files | Profiles |
|---|---|---|
| `ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose` | `compose/docker-compose.yaml` | `standalone`, `standalone-pull`, `full`, `full-pull` |
| `ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose-demo` | `compose/docker-compose.yaml` + `compose/docker-compose.demo.yaml` | `demo` |

Each artifact is tagged with `X.Y.Z` (always) and `latest` (stable releases only — skipped for pre-release tags containing `-`).

Image references are pinned to exact digests at publish time (`--resolve-image-digests`), so every `up` on a given tag pulls the exact images from that release. Environment variable placeholders (`${API_KEY}`, `${POSTGRES_USER}`, etc.) are preserved as-is in the artifact and resolved client-side at `up` time from the adopter's `.env` or host environment — `--with-env` is intentionally not used.

**Consuming the artifacts:**

```bash
# Production (adopter supplies .env with secrets in cwd)
docker compose -f oci://ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose:0.1.0 --profile full up -d

# Demo (zero-config — insecure defaults baked into the overlay)
docker compose -f oci://ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose-demo:latest --profile demo up
```

---

## Pre-releases

Tag `vX.Y.Z-rc.1` (or any tag containing `-`) follows the same flow but:

- Only the full version tag (`X.Y.Z-rc.1`) is published — no `latest`, no `X.Y` short tag.
- The GitHub Release is marked as prerelease.

---

## Hotfixes

Patch bump from `main` (or a maintenance branch if one exists for that major line). Same flow as above with `-Bump patch`.

---

## Branch protection

Apply once the repo is public (requires admin rights; repo must not be private for the API to accept protection rules on free plans):

```bash
gh api -X PUT repos/kostiantyn-matsebora/deployment-dashboard/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["_ci-green"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false,
  "restrictions": null
}
EOF
```

The single required check `_ci-green` is produced by `.github/workflows/ci.yml` on every PR to `main`, regardless of which paths changed.

---

## Pinning a deployment to a version

Set `DASHBOARD_VERSION` in `compose/.env`:

```dotenv
DASHBOARD_VERSION=0.1.0
```

**No leading `v`.** The git tag is `v0.1.0`; the published image tag is `0.1.0`.

The compose bundle (`deployment-dashboard-compose-vX.Y.Z.zip`) attached to each GitHub Release contains all `compose/*.yaml` files and `compose/.env.example` — a clone-free way to deploy a specific pinned version.

See [docs/guide/install.md](docs/guide/install.md) for full deployment instructions.
