# Install & deploy

How to run Deployment Dashboard for a real team. For a zero-config local trial, use the [Quickstart](./quickstart.md) instead.

## Concepts in one minute

- **Ingestion is push-first.** Your CI/CD pipeline `POST`s a deployment event to `POST /api/deployments` (one extra step — see [Integrate your CI/CD](./send-events.md)).
- **Pull mode is optional.** The `Dashboard.Fetcher` component can poll a CI/CD API (GitHub Actions today) and post events through the same endpoint. You only need it if you can't add a push step to your pipelines.
- **The gateway is the only published port.** Everything else (API, frontend, PostgreSQL) is internal. Default published port: `:8080`.
- **The backend is stateless.** Run any number of API instances behind the gateway; no sticky sessions. SSE fan-out works across instances via PostgreSQL `LISTEN/NOTIFY`.

## Deployment shapes (Compose profiles)

Two shapes, each with a pull-mode variant:

- **`standalone`** — cloud / distributed. PostgreSQL is an external managed service; the app tier scales horizontally behind the gateway.
- **`full`** — single-VM / all-in-one. The stack owns its PostgreSQL (Docker volume) on the same host.

> Pick **`standalone`** when your database is managed (e.g. Azure Database for PostgreSQL). Pick **`full`** for a single box that owns its data volume.

> ⚠️ **Required secrets — set these before deploying.** Production profiles require `API_KEY`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` (plus `POSTGRES_HOST` for `standalone`). Compose does **not** refuse to start when they're missing — it substitutes empty strings, so the stack comes up and then the API / database containers **crash-loop** (the API validates these on startup). Set them in `.env` (or your environment) first. The `demo` profile needs none.

### Get the compose project

Two options — OCI artifact (recommended) or curl.

#### Option A: OCI artifact (recommended)

No local compose files needed. Fetch only the env template, fill in your secrets, then reference the artifact directly:

```bash
# 1. Fetch the env template — this is the only file you need locally
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/.env.example
cp .env.example .env
# edit .env — set at least API_KEY, POSTGRES_USER, POSTGRES_PASSWORD
#   (+ POSTGRES_HOST for standalone)

# 2. Load your .env into the shell, then start (see known issue below)
#    Compose reads interpolation variables from the session environment.
docker compose --project-directory . -f oci://ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose:0.2.0 --profile full up -d
```

Replace `0.2.0` with the release you want to pin. `--project-directory .` points Compose at the current directory — without it, some Compose builds (notably on Windows) misread the `oci://` reference as a local path and fail with a `.env` path error.

!!! warning "Known issue: `oci://` flow + env files (Windows / Docker Desktop)"
    When using `-f oci://…`, Compose extracts the project to a local cache directory (e.g. `AppData\Local\cache\docker-compose\<hash>`). On the `up` path the project context relocates to that cache dir, so `.env` auto-load and `--env-file` (even with an absolute path) silently produce `<unset>` for all interpolation variables.

    **Observed behaviour (verified on Docker Desktop for Windows, `0.2.0`):**

    - `.env` in the working directory → all secret vars `<unset>` (auto-load does not fire).
    - `--env-file "$PWD\.env"` on the `up` command → still `<unset>`.
    - `--env-file "$PWD\.env"` on `config --environment` (preview/dry-run) → resolves correctly.

    **Workaround — load variables into the shell session before running `up`:**

    ```powershell
    # Run from the directory containing your .env
    Get-Content .\.env | ForEach-Object {
      if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
      }
    }
    # Compose reads interpolation variables from the session environment
    docker compose --project-directory . -f oci://ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose:0.2.0 --profile full up -d
    ```

    Shell/process environment takes precedence in Compose interpolation and is not affected by project-dir relocation.

    **To verify variable resolution before starting the stack** (`config --environment` does honour the file):

    ```powershell
    docker compose --project-directory . --env-file "$PWD\.env" -f oci://ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose:0.2.0 config --environment
    ```

    This is a current limitation of the `0.2.0` release; a fix may land in a later version.

> **First run prompt.** The first `oci://` pull shows an interactive confirmation listing the interpolation variables and their sources before proceeding — this is expected.

> **Availability.** The OCI artifact is published automatically on each release. It does not exist until the first release (`v0.1.0`) is cut — use the curl alternative below until then.

Image references inside the artifact are pinned to exact digests at publish time — every `up` on a given tag pulls the exact images from that release. Environment variable placeholders (`${API_KEY}`, `${POSTGRES_USER}`, etc.) are resolved client-side at `up` time, not baked into the artifact. See [Pinning a release version](#pinning-a-release-version).

#### Option B: fetch the compose files

Fetch the files you need into a working directory — no clone required, images pull from GHCR.

**Base file (all profiles):**

```bash
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/docker-compose.yaml
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/.env.example
```

**Demo overlay (demo profile only):**

```bash
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/docker-compose.demo.yaml
```

To pin to a specific release, replace `main` in the URLs with the release tag (e.g. `.../v0.2.0/compose/...`) — see [Pinning a release version](#pinning-a-release-version).

### Profiles

| Profile | What starts | Required env | Command |
|---|---|---|---|
| `standalone` | Gateway + Frontend + API. External PostgreSQL, push-only. | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST` | `docker compose --profile standalone up` |
| `standalone-pull` | `standalone` + Fetcher (pull-mode ingestion). | + `GITHUB_REPOS` / `GITHUB_TOKEN` | `docker compose --profile standalone-pull up` |
| `full` | Gateway + Frontend + API + bundled PostgreSQL (Docker volume). Push-only. | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | `docker compose --profile full up` |
| `full-pull` | `full` + Fetcher (pull-mode ingestion). | + `GITHUB_REPOS` / `GITHUB_TOKEN` | `docker compose --profile full-pull up` |
| `demo` | Everything + Demo Driver + GitHub Emulator + Fetcher. Zero-config evaluation. | _(none — insecure defaults)_ | `docker compose -f docker-compose.yaml -f docker-compose.demo.yaml --profile demo up` |

## Deploy with the Fetcher (pull mode)

Pull mode is opt-in. Use it when you can't add a push step to your pipelines. The [Fetcher](../FETCHER_SPECIFICATION.md) polls the GitHub Deployments REST API (read-only against GitHub) and posts events through the same `POST /api/deployments` ingest contract as any CI/CD pipeline step. Only the `-pull` profiles (`full-pull`, `standalone-pull`) start it.

### Required env

| Var | Required | Value |
|---|---|---|
| `GITHUB_TOKEN` | **yes** | GitHub PAT or App token — see token-scope guidance below. |
| `GITHUB_REPOS` | **yes** | Comma-separated `owner/repo` list, e.g. `acme/api,acme/web`. |

All other fetcher knobs (base URL, version source, rate-limit budget, poll interval) are optional with sane defaults — see [Configuration → Fetcher: pull mode](./configuration.md#fetcher-pull-mode).

### Token scope

!!! note "Minimum GitHub token scopes"
    **Public repos (recommended minimum):**

    - *Classic PAT* — **no scopes selected**. A scopeless token still authenticates and grants read access to public data at 5,000 req/hr. Do **not** select `public_repo` — that grants write.
    - *Fine-grained PAT* — **Repository access: Public repositories (read-only)**. This bundles Contents, Deployments, and Actions read — everything the fetcher needs.

    **Private repos:**

    - *Fine-grained PAT* — scope to the specific repos with **Contents: Read**, **Deployments: Read**, and **Actions: Read** (Actions read is only required when `GITHUB_VERSION_SOURCE=artifact:…`).
    - *Classic PAT* — `repo` scope.

    The fetcher is strictly read-only — it never needs write or admin scopes.

### Start with pull mode

Add `GITHUB_TOKEN` and `GITHUB_REPOS` to your `.env`, then use the shell-env workaround from [Option A](#option-a-oci-artifact-recommended) (required on the `oci://` path):

```powershell
# .env additions
# GITHUB_TOKEN=github_pat_…
# GITHUB_REPOS=acme/api,acme/web

# Load .env into the shell session
Get-Content .\.env | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
  }
}
# Start the full stack with the Fetcher
docker compose --project-directory . -f oci://ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose:0.2.0 --profile full-pull up -d
```

For `standalone-pull` (external PostgreSQL), the flow is identical — replace `--profile full-pull` with `--profile standalone-pull` and ensure `POSTGRES_HOST` is set in `.env`.

> **First poll cycle.** The first start triggers a bounded initial backfill (see [Fetcher Specification §2, F7/F13](../FETCHER_SPECIFICATION.md)), so the matrix populates after a poll cycle or two — not immediately.

## Minimal production start

```bash
# 1. Fetch only the env template — fill in your secrets
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/.env.example
cp .env.example .env
# edit .env — set at least API_KEY, POSTGRES_USER, POSTGRES_PASSWORD
#   (+ POSTGRES_HOST for standalone)

# 2. Load your .env into the shell first (oci:// env-file workaround — see Option A above),
#    then start:
docker compose --project-directory . -f oci://ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose:0.2.0 --profile full up -d
```

> Substitute `0.2.0` with the release you want. See [Pinning a release version](#pinning-a-release-version). If the first release has not been cut yet, use [Option B](#option-b-fetch-the-compose-files) instead. For env-file behaviour with `oci://`, see the [known issue in Option A](#option-a-oci-artifact-recommended).

Then point your CI/CD at `http://<host>:8080/api/deployments` — see [Integrate your CI/CD](./send-events.md).

## Running from local source

Building and running from a clone is a **contributor** workflow (local image builds, per-component debug loops) — see [CONTRIBUTING.md → Local setup](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/CONTRIBUTING.md#local-setup).

## Production checklist

- **Set a strong `API_KEY`.** Every write is rejected with `401` without it.
- **Set `CONTROL_API_KEY`** (distinct from `API_KEY`) only if you need the destructive reset surface; leave it unset to hide `POST /api/control/reset` entirely.
- **Front the stack with TLS.** The dashboard is internal read-only tooling (no auth on reads, by design — see [Architecture overview](./architecture-overview.md)). Do **not** expose the Read API to the public internet; terminate TLS and restrict to your internal network.
- **Set `HISTORY_RETENTION_DAYS`** to your audit needs (minimum 90; 365 recommended for production).
- **Scale the API** horizontally behind the gateway as load grows — it's stateless.

See [Configuration](./configuration.md) for every environment variable.

## Pinning a release version

By default the stack pulls `latest`, which tracks the most recent push to `main`. For a reproducible deployment, pin to a published release version:

```dotenv
# compose/.env
DASHBOARD_VERSION=0.2.0
```

**No leading `v`.** The git tag is `v0.1.0`; the published image tag is `0.1.0`. See `compose/.env.example` for the full note.

Each GitHub Release also attaches a compose bundle (`deployment-dashboard-compose-vX.Y.Z.zip`) containing all `compose/*.yaml` files and `compose/.env.example` — a clone-free way to deploy a specific version without checking out the repo.

For the full release process, see [RELEASING.md](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/RELEASING.md).

## Hosting notes

The reference target is **Azure** (≤ $30/month, container-based — see [SAD §5–6](../SAD.md#5-non-functional-requirements)), but nothing is Azure-specific: every backend component is a standard OCI container deployable on any container host. Terraform modules for Azure are planned (`infrastructure/`, not yet present).
