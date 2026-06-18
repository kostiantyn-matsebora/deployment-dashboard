# Install & deploy

How to run Deployment Dashboard for a real team. For a zero-config local trial, see the [Quickstart](./quickstart.md).

## Concepts in one minute

<div class="grid cards" markdown>

-   :material-upload-outline:{ .lg .middle } **Push-first ingestion**

    ---

    Your CI/CD pipeline `POST`s a deployment event to `POST /api/deployments` — one extra step. [Integrate your CI/CD](./send-events.md).

-   :material-sync:{ .lg .middle } **Pull mode is optional**

    ---

    The Fetcher can poll a CI/CD API (GitHub Actions today) and post through the same endpoint — see the [`-pull` profiles](#2-configure--run).

-   :material-lan-connect:{ .lg .middle } **One published port**

    ---

    The gateway (`:8080`) is the only exposed surface. API, frontend, and PostgreSQL stay internal.

-   :material-server-network:{ .lg .middle } **Stateless backend**

    ---

    Scale API instances behind the gateway; SSE fan-out works across them via PostgreSQL `LISTEN/NOTIFY`.

</div>

## Deployment shapes

Two independent axes pick your profile:

<div class="grid cards" markdown>

-   :material-database:{ .lg .middle } **Database**

    ---

    `full` bundles PostgreSQL in a Docker volume; `standalone` connects to an external managed PostgreSQL (e.g. Azure Database for PostgreSQL) and scales the app tier behind the gateway.

-   :material-swap-vertical:{ .lg .middle } **Ingestion**

    ---

    The base profile is push-only; the **`-pull`** variant adds the [Fetcher](#2-configure--run) for pull-mode ingestion.

</div>

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
    Replace `main` in the URLs with the tag (e.g. `.../v0.16.1/compose/...`) — see [Pinning a release version](#pinning-a-release-version).

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

    Then point your CI/CD at `http://<host>:8080/api/deployments` — see [Integrate your CI/CD](./send-events.md).

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

    Then point your CI/CD at `http://<host>:8080/api/deployments` — see [Integrate your CI/CD](./send-events.md).

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
        | `GITHUB_TOKEN` | Read-only GitHub PAT — see token scope below |
        | `GITHUB_REPOS` | `owner/repo,owner/repo` to poll |

    </div>

    First start runs a bounded backfill, so the matrix fills after a poll cycle or two. Other fetcher options have sane defaults — see [Configuration → Fetcher](./configuration.md#fetcher-pull-mode).

    ??? info "GitHub token scope — read-only; the Fetcher never writes"

        | Repos | Classic PAT | Fine-grained PAT |
        |---|---|---|
        | Public | no scopes | Public repositories → read-only |
        | Private | `repo` scope | Contents · Deployments · Actions: Read |

        - **Classic `repo` over-grants** — it grants full read/write to every private repo, far beyond what the Fetcher uses. Prefer a fine-grained PAT where org policy allows.
        - **Org repos with SAML SSO** — after creating a classic `repo` PAT, click **Configure SSO → Authorize**, then re-authorize after every rotation. An unauthorized token returns **HTTP 403** (`X-GitHub-SSO` header), not 401.

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
        | `GITHUB_TOKEN` | Read-only GitHub PAT — see token scope below |
        | `GITHUB_REPOS` | `owner/repo,owner/repo` to poll |

    </div>

    First start runs a bounded backfill, so the matrix fills after a poll cycle or two. Other fetcher options have sane defaults — see [Configuration → Fetcher](./configuration.md#fetcher-pull-mode).

    ??? info "GitHub token scope — read-only; the Fetcher never writes"

        | Repos | Classic PAT | Fine-grained PAT |
        |---|---|---|
        | Public | no scopes | Public repositories → read-only |
        | Private | `repo` scope | Contents · Deployments · Actions: Read |

        - **Classic `repo` over-grants** — it grants full read/write to every private repo, far beyond what the Fetcher uses. Prefer a fine-grained PAT where org policy allows.
        - **Org repos with SAML SSO** — after creating a classic `repo` PAT, click **Configure SSO → Authorize**, then re-authorize after every rotation. An unauthorized token returns **HTTP 403** (`X-GitHub-SSO` header), not 401.

    ```bash
    docker compose --profile standalone-pull up -d
    ```

## Running from local source

Building from a clone is a **contributor** workflow — see [CONTRIBUTING.md → Local setup](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/CONTRIBUTING.md#local-setup).

## Production checklist

!!! warning ""

    - **Set a strong `API_KEY`.** Writes are rejected `401` without it.
    - **Set `CONTROL_API_KEY`** (distinct from `API_KEY`) only if you need the reset surface; leave it unset to hide `POST /api/control/reset`.
    - **Front the stack with TLS** and keep it on your internal network — reads are unauthenticated by design ([Architecture](./architecture-overview.md)).
    - **Set `HISTORY_RETENTION_DAYS`** (minimum 90; 365 recommended).
    - **Scale the API** horizontally behind the gateway as needed — it's stateless.

See [Configuration](./configuration.md) for every environment variable.

## Pinning a release version

By default the stack pulls `latest` (tracks `main`). For a reproducible deploy, pin in `.env`:

```dotenv
DASHBOARD_VERSION=0.16.1
```

!!! warning "No leading `v`"
    The git tag `v0.16.1` publishes images as `0.16.1`. Each GitHub Release also attaches a compose bundle (`deployment-dashboard-compose-vX.Y.Z.zip`). Full process: [RELEASING.md](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/RELEASING.md).

## Hosting notes

!!! info ""
    The reference target is **Azure** (≤ $30/month, container-based — [SAD §5–6](../SAD.md#5-non-functional-requirements)), but nothing is Azure-specific: every component is a standard OCI container. Terraform modules for Azure are planned (`infrastructure/`, not yet present).

!!! tip "Azure Container Apps"
    The gateway deploys to ACA unchanged — the same image used in Docker Compose. Each proxy location sets the `Host` header to the upstream FQDN so ACA's internal Envoy routes correctly; no ACA-specific config is needed.

!!! note "Demo gateway image"
    The production profiles above use `deployment-dashboard-gateway`. The **demo profile** uses a separate `deployment-dashboard-gateway-demo` image that layers `/demo/*` routing on top of the production image. Production deployments carry no demo routes or demo-driver configuration.
