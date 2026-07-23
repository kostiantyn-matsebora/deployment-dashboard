# Configuration — Demo

Demo and dev-only variables set by the `demo` Compose profile — not required for any production profile.

## :material-flask-outline: Demo / dev only { #demo-dev-only }

Set by [`docker-compose.demo.yaml`](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/compose/docker-compose.demo.yaml) for the zero-config `demo` profile — **not required for any production profile.** Override only to tune the simulated deployment stream.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `EMIT_INTERVAL_MS` | no | `8000` | Interval (ms) between simulated deployment events from the demo driver / emulator. |
| `EMIT_DELAY_MS` | no | `0` | Startup delay (ms) before the demo driver begins emitting. |
| `GITHUB_SIM_RATE_LIMIT` | no | `5000` | Simulated GitHub hourly request quota the emulator advertises. |

Other demo vars (`WRITE_API_URL`, `FETCHER_URL`, `GITHUB_EMULATOR_URL`, `MOCK_URL`, `PORT`, `SEED_ON_STARTUP`, `SCENARIOS_DIR`) are fixed internal wiring set by the overlay and are not meant to be overridden.

### Demo-gateway image vars

The `demo` profile uses the `deployment-dashboard-gateway-demo` image instead of the production gateway. Two additional vars are specific to that image:

| Var | Default (in image) | Set by demo overlay | Purpose |
|---|---|---|---|
| `DNS_RESOLVER` | auto-detected from `/etc/resolv.conf` at container start (falls back to `127.0.0.11` if none found) | not set — auto-detect; override with `168.63.129.16` for Azure Container Apps if needed | DNS resolver for variable-based `proxy_pass` in the demo snippet — required because the demo-driver is an optional service. |
| `DEMO_DRIVER_UPSTREAM` | — | `demo-driver:3001` | Demo driver upstream `host:port`. |

An explicit `DNS_RESOLVER` env always overrides auto-detection. These vars are **absent from the production gateway image** — its `NGINX_ENVSUBST_FILTER` excludes them.
