# deployment-dashboard

Helm chart for the [Deployment Dashboard](https://kostiantyn-matsebora.github.io/deployment-dashboard/) —
a self-hosted deployment/version dashboard.

This is a **chart-local quick reference**. The full adopter guide (installation
walkthrough, values reference, upgrade notes) lives on the
[docs site](https://kostiantyn-matsebora.github.io/deployment-dashboard/).

## Install

```console
helm install my-dashboard oci://ghcr.io/kostiantyn-matsebora/charts/deployment-dashboard \
  --set apiKey=<your-api-key> \
  --set postgresql.auth.password=<your-db-password>
```

## Key toggles

| Value | Default | Meaning |
|---|---|---|
| `gateway.enabled` | `true` | Routing Option A (gateway Pod, single public surface) vs Option B (native Ingress path rules). |
| `postgresql.enabled` | `true` | Bundle PostgreSQL in-chart vs point at `externalDatabase.*` (managed PG). |
| `demo.enabled` | `false` | Zero-config demo mode (Demo Driver + GitHub Emulator). **Never enable in production** — bundled demo credentials are insecure by design. |
| `fetcher.enabled` | `false` | Enable the pull-mode Fetcher alongside push ingestion. |

See `values.yaml` for the full interface, or `helm show values` on the packaged chart.

## Local development

```console
helm lint .
helm template . -f ci/prod-values.yaml
helm template . -f ci/demo-values.yaml
```
