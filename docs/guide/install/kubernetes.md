# Deploy to Kubernetes (Helm)

The `deployment-dashboard` Helm chart deploys the full stack to any Kubernetes cluster you already run. For an overview of deployment shapes and shared prerequisites, see the [Install & deploy landing](./index.md).

## Topology

| Component | Kubernetes resource | Ingress |
|---|---|---|
| Gateway | Deployment + Service (nginx) | Ingress (Option A) — or none, see [Routing options](#routing-options) |
| Frontend | Deployment + Service (Angular/nginx) | Internal (Option A) — or its own Ingress path (Option B) |
| API | Deployment + Service (.NET 10) | Internal (Option A) — or its own Ingress path (Option B) |
| Fetcher | Deployment | None — outbound only |
| PostgreSQL | StatefulSet (bundled) — or external managed instance (standalone) | Internal / external |
| Secret | — | API key · control key · PostgreSQL password |

## Prerequisites

- A running Kubernetes cluster and `kubectl` context pointed at it
- `helm` >= 3.x
- An Ingress Controller (or a Gateway API implementation) — required to expose the stack publicly
- A default `StorageClass` — required only if using the bundled PostgreSQL

## Install

Install straight from the published chart — no clone needed.

**Full mode** (bundled PostgreSQL, Option A gateway routing):

```bash
helm install deployment-dashboard oci://ghcr.io/kostiantyn-matsebora/charts/deployment-dashboard \
  --version <ver> \
  --set apiKey=<strong-write-key> \
  --set postgresql.auth.password=<strong-db-password> \
  --set ingress.enabled=true \
  --set ingress.className=<your-ingress-class> \
  --set ingress.host=<dashboard.example.com>
```

**Standalone mode** (external managed PostgreSQL):

```bash
helm install deployment-dashboard oci://ghcr.io/kostiantyn-matsebora/charts/deployment-dashboard \
  --version <ver> \
  --set apiKey=<strong-write-key> \
  --set postgresql.enabled=false \
  --set externalDatabase.host=<pg-host> \
  --set externalDatabase.database=deployment_dashboard \
  --set externalDatabase.username=<db-user> \
  --set externalDatabase.existingSecret=<secret-with-pg-password> \
  --set ingress.enabled=true \
  --set ingress.className=<your-ingress-class> \
  --set ingress.host=<dashboard.example.com>
```

!!! tip "Pin a release"
    Replace `<ver>` with a chart release tag for a reproducible deploy — mirrors [Pinning a release version](./docker-compose.md#pinning-a-release-version) for the other install methods.

## Values reference

| Value | Meaning |
|---|---|
| `image.tag` | Pin to a release tag; empty defaults to the chart's `appVersion`. |
| `gateway.enabled` | `true` (default) = [Option A](#routing-options) — nginx gateway pod + one Ingress. `false` = [Option B](#routing-options) — native Ingress path routing, no gateway pod. |
| `ingress.enabled` | `true` (default) — expose the stack through an Ingress Controller. The Install examples set it explicitly for clarity; it's already on. |
| `ingress.className` | Ingress class to target (e.g. `nginx`). |
| `ingress.host` | Public hostname routed to the stack. |
| `ingress.tls` | TLS configuration for the Ingress (secret name, hosts). |
| `postgresql.enabled` | `true` (default) = bundled in-chart PostgreSQL (full mode). `false` = external managed PostgreSQL via `externalDatabase.*` (standalone mode). |
| `postgresql.auth.password` | Bundled PostgreSQL password. Required when `postgresql.enabled` and no `postgresql.auth.existingSecret`. |
| `externalDatabase.host` / `.port` / `.database` / `.username` / `.existingSecret` | External PostgreSQL connection details (standalone mode only). |
| `fetcher.enabled` | Opt-in pull-mode Fetcher; pair with `fetcher.github.*` for the GitHub token and repos to poll. |
| `apiKey` | Write-endpoint secret (`X-Api-Key`). Required. |
| `controlApiKey` | Distinct secret to enable `POST /api/control/reset`; leave unset to hide the reset surface. |
| `existingSecret` | Reference an existing Kubernetes Secret for `apiKey` / `controlApiKey` instead of setting them inline. |
| `api.corsAllowedOrigins` | Empty (default) = CORS off — single-origin gateway routing. Set only for split-host Option B deployments; see the [CORS caveat](#routing-options). |
| `demo.enabled` | Opt-in demo simulators (demo-driver + GitHub emulator) and `/demo/*` routes. **Off by default — unsafe for production.** See [Demo mode](#demo-mode). |

## Routing options

Two mutually exclusive ways to expose the stack, matching the [gateway's GW6 decision](../../GATEWAY_SPECIFICATION.md):

| Option | `gateway.enabled` | Ingress shape | CORS |
|---|---|---|---|
| **A — Gateway** (default) | `true` | One Ingress → gateway pod, which proxies to frontend + API internally | Off — single origin, no `api.corsAllowedOrigins` needed |
| **B — Native Ingress** | `false` | Ingress routes paths directly to frontend and API Services, no gateway pod | Required whenever frontend and API resolve to **different** hosts |

!!! warning "CORS caveat for Option B"
    Option B with a **single** Ingress host and path-based routing (e.g. `/` → frontend, `/api` → API) still shares one origin — CORS stays off. But if you split frontend and API onto **distinct hosts**, you must set `api.corsAllowedOrigins` to the frontend's origin, or browser requests to the API are rejected. This mirrors backend decision D6 in [`API_SPECIFICATION.md`](../../API_SPECIFICATION.md).

## Demo mode

Set `--set demo.enabled=true` to add a demo-driver Deployment, a GitHub-emulator Deployment, `/demo/*` routes, and a Fetcher repointed at the emulator — the same story as the [Quickstart](../quickstart.md#run-the-demo), running in-cluster instead of via Compose.

!!! warning "Not for production"
    `demo.enabled` is **off by default** and ships insecure defaults (a placeholder `demo-api-key`, no real secrets). Never enable it on a cluster that also serves real traffic.

## Upgrade / uninstall

```bash
helm upgrade deployment-dashboard oci://ghcr.io/kostiantyn-matsebora/charts/deployment-dashboard --version <new-ver>
helm uninstall deployment-dashboard
```

Chart versions track dashboard releases in lockstep with `image.tag` — pin both together for a reproducible upgrade.

!!! note "PVC retention"
    `helm uninstall` does **not** delete the PersistentVolumeClaim backing the bundled PostgreSQL StatefulSet. Delete it manually (`kubectl delete pvc ...`) if you want a clean slate; leave it in place to preserve data across a reinstall.

## Networking & security

- The bundled PostgreSQL uses a static password via a Kubernetes Secret (`postgresql.auth.password` or `postgresql.auth.existingSecret`) — there is no managed-identity auth path on Kubernetes. **Azure managed-identity AAD auth stays Azure-only**, available through the [Azure (Terraform)](./azure-terraform.md) path instead.
- With `gateway.enabled: true` (Option A), the gateway pod is the **single public surface** (GW1) — frontend and API stay internal Services, reachable only through the gateway's Ingress.
- Store `apiKey` / `controlApiKey` in a Secret (`existingSecret`) rather than passing them as plain `--set` values in production — Helm records `--set` values in its release history.
