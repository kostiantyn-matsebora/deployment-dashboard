# `gateway/demo-driver/` — demo-driver sidecar image

Source for the **6th first-party component image** introduced by [#46](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/46): a periodic ticker that drives the `demo-gha` WireMock.Net admin API so the demo-mode dashboard surfaces ongoing deployment activity instead of a single frozen baseline.

## Purpose

Without a driver the `demo-gha` image returns the same `/repos/.../deployments` payload forever — every poll cycle the fetcher writes the same events and the UI stays static. The demo-driver sidecar PUTs replacement bodies (and POSTs additive status mappings) into `demo-gha`'s `/__admin/mappings` endpoint on a 15 s cadence, looping a qa-authored sequence of tick directories indefinitely.

## How it is consumed

- **Compose**: `install/docker-compose.release.yml` defines a `demo-driver` service gated by the `demo` profile (depends on `demo-gha: service_healthy`). No `ports:`, no `healthcheck:` — egress only.
- **Image ref**: `ghcr.io/kostiantyn-matsebora/deployment-dashboard-demo-driver:${DASHBOARD_VERSION:-latest}`.

## Runtime contract

| Knob | Default | Source |
|---|---|---|
| `DEMO_DRIVER_GHA_URL` | `http://demo-gha:80` | Phase 3 lock |
| `DEMO_DRIVER_PERIOD_SECONDS` | `15` | Phase 3 lock |
| `DEMO_DRIVER_ID_STRIDE` | `100` | Phase 3 lock |
| `DEMO_DRIVER_BUILD_EPOCH` | `0` (= use process-start) | Dockerfile `ARG BUILD_EPOCH` |

- **GUID discovery**: at startup, the driver reads every `/app/static-base/05-list-deployments-*.json` (baked from `testing/fixtures/gha/demo/mappings/`), extracts the top-level `Guid` per file, and builds a `slug -> Guid` map. Files without a pinned `Guid` are logged INFO and skipped (their service is silently dropped from PUT updates until the bundle author pins one).
- **Tick loop**: `/app/ticks/<NNN>-<slug>/*.json` sorted lexically; each tick directory's JSON files are applied per period. Filename prefix `list-deployments-<service>` → `PUT /__admin/mappings/{pinned-guid}`; prefix `status-` → `POST /__admin/mappings` (additive). Loops indefinitely.
- **ID monotonicity**: `effective_id = authored_id + (cycle_index * ID_STRIDE)`. `cycle_index = (now - BUILD_EPOCH) / (total_ticks * PERIOD_SECONDS)`. With `BUILD_EPOCH=0` the anchor is the process-start wall-clock — monotone within the process lifetime, may reset on restart. The reusable `_build-and-push-image.yml` does not currently plumb `--build-arg BUILD_EPOCH`; the in-process fallback keeps the image self-sufficient.
- **PUT fallback**: if `PUT /__admin/mappings/{guid}` returns 4xx, the driver falls back to `DELETE` + `POST` (full body) once per service per process — logged INFO once.
- **SIGTERM**: cooperative — finishes the in-flight tick's HTTP IO, then exits 0 (≤10 s).
- **Errors**: 4xx/5xx from admin are logged WARNING; the loop never crashes.

## Ownership boundary

| Path | Owner |
|---|---|
| `Dockerfile`, `entrypoint.py`, this `README.md` | `devops-engineer` |
| `testing/fixtures/gha/demo/mappings/05-list-deployments-*.json` (Guid pinning) | `qa-engineer` |
| `testing/fixtures/gha/demo/ticks/**` | `qa-engineer` |

## Related

- Issue [#46](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/46) — Phase 3 design lock.
- [CR-0013](../../docs/cr/CR-0013-demo-mode-default-installer.md) — sibling design for the static demo-gha image this driver augments.
- [CR-0010](../../docs/cr/CR-0010-component-ci-pipeline.md) — component CI pipeline pattern; `demo-driver.yml` follows it with `build-kind: copy`.
