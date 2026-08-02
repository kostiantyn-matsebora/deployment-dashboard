# Install with Docker Compose

Run Deployment Dashboard on any Linux or Windows host with Docker installed. For a zero-config local trial, see the [Quickstart](../quickstart.md). For an overview of deployment shapes and shared prerequisites, see the [Install & deploy landing](./index.md).

## 1. Get the stack

Fetch the compose file and env template — no clone, images pull from GHCR. Safe to paste as one block:

```bash
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/docker-compose.yaml
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/.env.example
cp .env.example .env
```

!!! note "PowerShell"
    Replace the trailing `\` line-continuations with backticks (`` ` ``).

!!! tip "Pin a release"
    Replace `main` in the URLs with the tag (e.g. `.../v0.20.0/compose/...`) — see [Pinning a release version](#pinning-a-release-version).

## 2. Configure & run

Pick the tab for your profile, set the listed variables in `.env`, then run its command.

> ⚠️ Set every variable in the table before starting. Compose substitutes empty strings for missing values, so the containers crash-loop instead of failing fast.

=== "full"

    <div class="grid cards" markdown>

    -   :material-database:{ .lg .middle } **Single host · bundled PostgreSQL**

        ---

        The simplest production shape — the stack owns its database in a Docker volume.

        | Variable | Set to |
        |---|---|
        | `API_KEY` | Write-endpoint secret (`X-Api-Key`) |
        | `POSTGRES_USER` | Bundled DB user |
        | `POSTGRES_PASSWORD` | Bundled DB password |

    </div>

    ```bash
    docker compose --profile full up -d
    ```

    Then point your CI/CD at `http://<host>:8080/api/deployments` — see [Integrate your CI/CD](../send-events.md).

=== "standalone"

    <div class="grid cards" markdown>

    -   :material-cloud-outline:{ .lg .middle } **App tier · external managed PostgreSQL**

        ---

        Connects to an external managed PostgreSQL (e.g. Azure Database for PostgreSQL) and scales the app tier behind the gateway.

        | Variable | Set to |
        |---|---|
        | `API_KEY` | Write-endpoint secret (`X-Api-Key`) |
        | `POSTGRES_USER` | External DB user |
        | `POSTGRES_PASSWORD` | External DB password |
        | `POSTGRES_HOST` | External DB hostname |

    </div>

    ```bash
    docker compose --profile standalone up -d
    ```

    Then point your CI/CD at `http://<host>:8080/api/deployments` — see [Integrate your CI/CD](../send-events.md).

=== "full-pull"

    <div class="grid cards" markdown>

    -   :material-database-sync:{ .lg .middle } **full + Fetcher · pull-mode ingestion**

        ---

        - **How** — polls the GitHub Deployments API and posts to the dashboard's internal ingest. Outbound-only — nothing accepts inbound traffic.
        - **When** — you can't add a push step to pipelines, or the network forbids inbound WAN traffic.

        | Variable | Set to |
        |---|---|
        | `API_KEY` | Write-endpoint secret (`X-Api-Key`) |
        | `POSTGRES_USER` | Bundled DB user |
        | `POSTGRES_PASSWORD` | Bundled DB password |
        | `GITHUB_TOKEN` | Read-only GitHub PAT — see [Configuration → Fetcher → GitHub token permissions](../configuration/fetcher.md#github-token-permissions) |
        | `GITHUB_REPOS` | `owner/repo,owner/repo` to poll |

    </div>

    First start runs a bounded backfill, so the matrix fills after a poll cycle or two. Other fetcher options have sane defaults — see [Configuration → Fetcher](../configuration/fetcher.md#fetcher-pull-mode).

    !!! info "GitHub token scope"
        Read-only — the Fetcher never writes. Classic vs fine-grained PAT permissions are documented once in [Configuration → Fetcher → GitHub token permissions](../configuration/fetcher.md#github-token-permissions).

    ```bash
    docker compose --profile full-pull up -d
    ```

=== "standalone-pull"

    <div class="grid cards" markdown>

    -   :material-cloud-sync:{ .lg .middle } **standalone + Fetcher · pull-mode ingestion**

        ---

        - **How** — polls the GitHub Deployments API and posts to the dashboard's internal ingest. Outbound-only — nothing accepts inbound traffic.
        - **When** — you can't add a push step to pipelines, or the network forbids inbound WAN traffic.

        | Variable | Set to |
        |---|---|
        | `API_KEY` | Write-endpoint secret (`X-Api-Key`) |
        | `POSTGRES_USER` | External DB user |
        | `POSTGRES_PASSWORD` | External DB password |
        | `POSTGRES_HOST` | External DB hostname |
        | `GITHUB_TOKEN` | Read-only GitHub PAT — see [Configuration → Fetcher → GitHub token permissions](../configuration/fetcher.md#github-token-permissions) |
        | `GITHUB_REPOS` | `owner/repo,owner/repo` to poll |

    </div>

    First start runs a bounded backfill, so the matrix fills after a poll cycle or two. Other fetcher options have sane defaults — see [Configuration → Fetcher](../configuration/fetcher.md#fetcher-pull-mode).

    !!! info "GitHub token scope"
        Read-only — the Fetcher never writes. Classic vs fine-grained PAT permissions are documented once in [Configuration → Fetcher → GitHub token permissions](../configuration/fetcher.md#github-token-permissions).

    ```bash
    docker compose --profile standalone-pull up -d
    ```

## Running from local source

Building from a clone is a **contributor** workflow — see [CONTRIBUTING.md → Local setup](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/CONTRIBUTING.md#local-setup).

## Pinning a release version

By default the stack pulls `latest` (tracks `main`). For a reproducible deploy, pin in `.env`:

```dotenv
DASHBOARD_VERSION=0.20.0
```

!!! warning "No leading `v`"
    The git tag `v0.20.0` publishes images as `0.20.0`. Each GitHub Release also attaches a compose bundle (`deployment-dashboard-compose-vX.Y.Z.zip`). Full process: [RELEASING.md](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/RELEASING.md).
