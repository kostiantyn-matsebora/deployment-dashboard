---
title: Install & deploy
shortTitle: Install & deploy
intro: 'Choose a deployment method and follow its guide — Docker Compose for self-hosted, Azure (Terraform) for managed cloud.'
children:
  - /docker-compose
  - /azure-terraform
---

# Install & deploy

How to run Deployment Dashboard for a real team. For a zero-config local trial, see the [Quickstart](../quickstart.md).

## Contents

### `docker-compose.md`

- [Get the stack](./docker-compose.md#1-get-the-stack)
- [Configure & run](./docker-compose.md#2-configure--run)
- [Running from local source](./docker-compose.md#running-from-local-source)
- [Pinning a release version](./docker-compose.md#pinning-a-release-version)

### `azure-terraform.md`

- [Topology](./azure-terraform.md#topology)
- [Prerequisites](./azure-terraform.md#prerequisites)
- [Deploy](./azure-terraform.md#deploy)
- [Post-deploy steps](./azure-terraform.md#post-deploy-steps)
- [Cost](./azure-terraform.md#cost)
- [Networking & security](./azure-terraform.md#networking--security)

---

## Concepts in one minute

<div class="grid cards" markdown>

-   :material-upload-outline:{ .lg .middle } **Push-first ingestion**

    ---

    Your CI/CD pipeline `POST`s a deployment event to `POST /api/deployments` — one extra step. [Integrate your CI/CD](../send-events.md).

-   :material-sync:{ .lg .middle } **Pull mode is optional**

    ---

    The Fetcher can poll a CI/CD API (GitHub Actions today) and post through the same endpoint — see the [`-pull` profiles](./docker-compose.md#2-configure--run).

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

    The base profile is push-only; the **`-pull`** variant adds the [Fetcher](./docker-compose.md#2-configure--run) for pull-mode ingestion.

</div>

## Choose a deployment method

| Method | When to use |
|---|---|
| [Docker Compose](./docker-compose.md) | Self-hosted — any Linux/Windows host with Docker installed. Full control of infra. |
| [Azure (Terraform)](./azure-terraform.md) | Managed cloud — zero-ops Azure Container Apps stack, provisioned end-to-end by Terraform. |

## Shared prerequisites

Both methods require images from GHCR. No registry credentials are needed for public images.

## Production checklist

!!! warning ""

    - **Set a strong `API_KEY`.** Writes are rejected `401` without it.
    - **Set `CONTROL_API_KEY`** (distinct from `API_KEY`) only if you need the reset surface; leave it unset to hide `POST /api/control/reset`.
    - **Front the stack with TLS** and keep it on your internal network — reads are unauthenticated by design ([Architecture](../architecture-overview.md)).
    - **Set `HISTORY_RETENTION_DAYS`** (minimum 90; 365 recommended).
    - **Scale the API** horizontally behind the gateway as needed — it's stateless.

See [Configuration](../configuration.md) for every environment variable.

## Pinning a release version

By default the stack pulls `latest` (tracks `main`). For a reproducible deploy, pin to a release tag — see the method-specific guides for how:

- Docker Compose: set `DASHBOARD_VERSION` in `.env` — see [Pinning a release version](./docker-compose.md#pinning-a-release-version).
- Azure Terraform: set `dashboard_version` in `terraform.tfvars` — see [Deploy](./azure-terraform.md#deploy).

## Hosting notes

!!! tip "Azure Container Apps"
    The gateway deploys to ACA unchanged — the same image used in Docker Compose. Each proxy location sets the `Host` header to the upstream FQDN so ACA's internal Envoy routes correctly; no ACA-specific config is needed.

!!! note "Demo gateway image"
    The production profiles above use `deployment-dashboard-gateway`. The **demo profile** uses a separate `deployment-dashboard-gateway-demo` image that layers `/demo/*` routing on top of the production image. Production deployments carry no demo routes or demo-driver configuration.
