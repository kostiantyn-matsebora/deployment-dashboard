# `gateway/demo-gha/` — demo-gha component image

Source for the **first-party demo-gha image** introduced by [CR-0013](../../docs/cr/CR-0013-demo-mode-default-installer.md): the 5th component image alongside `api` / `fetcher` / `frontend` / `gateway`.

## Purpose

Bakes the demo-mode WireMock.Net mappings (`testing/fixtures/gha/demo/`, qa-owned) into a self-contained Docker image so the release-install entrypoint can stand up an offline-capable mock GitHub Actions upstream with **zero caller configuration**. Without this image the release-install demo path would need a separate `gh release download` for the bundle asset (rejected — see [CR-0013 § Alternatives Considered](../../docs/cr/CR-0013-demo-mode-default-installer.md#change)).

## How it is consumed

- **Compose**: `install/docker-compose.release.yml` defines a `demo-gha` service gated by the `demo` Compose profile (`profiles: ["demo"]`). The release-install `install.ps1` / `install.sh` activate that profile by default; explicit opt-outs are `-RealGha` / `-Empty`.
- **Image ref**: `ghcr.io/kostiantyn-matsebora/deployment-dashboard-demo-gha:${DASHBOARD_VERSION:-latest}` — same tag scheme as the four sibling images per [CR-0010](../../docs/cr/CR-0010-component-ci-pipeline.md).
- **Fetcher wiring**: the demo profile retargets the fetcher's `GHA_API_BASE_URL` to `http://demo-gha:80` via the existing env-var indirection seam (no fetcher code change).
- **Internal-only (NFR-04)**: the service has **no `ports:`** in the compose definition — the admin port is never published to the release host.

## Build details

- **Base image**: `sheyenrath/wiremock.net:2.4.0` — same pin [CR-0012](../../docs/cr/CR-0012-integration-test-substrate.md) uses for the sibling `mock-gha` service. One WireMock.Net binary across both demo and integration profiles.
- **Bundle path inside image**: `/app/__admin/mappings/` (WireMock.Net .NET image's default admin file layout — CR-0012 § 3a footnote).
- **Build context**: **repo root** (`.`). The Dockerfile's `COPY testing/fixtures/gha/demo/` reaches outside `gateway/`, so the context must be the repo root for the path to resolve. The CI caller (`.github/workflows/demo-gha.yml`) passes `context-path: .` to the reusable `_build-and-push-image.yml` workflow.
- **No `CMD` / `ENTRYPOINT` override**: the base image launches WireMock.Net on port 80 and scans `/app/__admin/mappings/` at startup. The compose-level healthcheck (TCP probe via `bash -c ': > /dev/tcp/localhost/80'`) verifies the port accepts connections.

## Ownership boundary

| File | Owner |
|---|---|
| `Dockerfile` (+ this README) | `devops-engineer` |
| `testing/fixtures/gha/demo/**` (the COPY source) | `qa-engineer` |

The `COPY` line is a devops concern (image layout). The mapping content it pulls in is a qa concern (scenario coverage, DAG-edge shapes, dynamic-mock scenario walk per CR-0013 § 3d / § 3e). See `.agents/ginee/local/bindings.md` governance rows for the split.

## Related

- [CR-0013](../../docs/cr/CR-0013-demo-mode-default-installer.md) — design-of-record.
- [CR-0012](../../docs/cr/CR-0012-integration-test-substrate.md) — sibling design (`mock-gha` service + integration profile + bundle root co-location).
- [CR-0010](../../docs/cr/CR-0010-component-ci-pipeline.md) — component CI pipeline pattern (`_build-and-push-image.yml` + per-component caller). `demo-gha.yml` follows this shape with `build-kind: copy` (no language toolchain, no tests).
