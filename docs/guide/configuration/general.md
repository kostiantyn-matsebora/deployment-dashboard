# Configuration — General

Stack-version configuration: the image-tag pin that applies to all services.

## :material-tag-outline: Stack version { #stack-version }

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DASHBOARD_VERSION` | no | `latest` | Image tag applied to all six stack images. Pin to a published release for reproducible deploys (e.g. `0.13.1`). **Set without a leading `v`** — the git tag `v0.17.0` publishes images as `0.17.0`. `:latest` tracks whichever pipeline (release or CI main build) ran most recently. The API assembly version is baked at build time and reported by the dashboard footer via `GET /api/version`: release images → `vX.Y.Z` (e.g. `v0.13.1`); CI/main `:latest` images → `main+<short-sha>` (e.g. `main+a947098`); local/unstamped → `0.0.0-dev`. No separate runtime env var is needed. |

See [Install — Pinning a release version](../install/docker-compose.md#pinning-a-release-version) for the full workflow, and [RELEASING.md](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/RELEASING.md) for the release process.
