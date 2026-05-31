# GitHub Emulator Specification — `@deployment-dashboard/github-emulator`

**Status:** Draft · **Date:** 2026-05-31

Standalone service that emulates the GitHub REST API surface the fetcher consumes, backed by an in-memory store. Enables end-to-end demo and integration-test scenarios without touching `api.github.com`.

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/FETCHER_SPECIFICATION.md`](FETCHER_SPECIFICATION.md) §5 | GitHub REST endpoint contracts, field mapping, status mapping, parent-derivation, version/artifact, backfill, rate-limit — authoritative spec for the surface this service emulates. |
| [`demo/data/github/`](../demo/data/github/) | Curated demo fixture files (workflow YAML, deployment seeds). |
| [`docs/diagrams/github-emulation.md`](diagrams/github-emulation.md) | Visual reference for demo-mode topology and seed→backfill→poll sequence. |

---

## 1. Stack

| Aspect | Value |
|---|---|
| Runtime | Node.js / TypeScript |
| Framework | NestJS 10 + Express |
| Default port | `3100` (override via `PORT` env var) |
| State | In-memory only — resets on restart |
| Location | `demo/github-emulator/` |
| Auth | None — internal-only service; no gateway route |

---

## 2. Solution layout

```
demo/github-emulator/
  src/
    main.ts                       bootstrap (port, config)
    app.module.ts                 NestJS root module
    github-rest.controller.ts     emulated GitHub REST surface at root:
                                  GET /repos/{owner}/{repo}/...
                                  GET /rate_limit
    control.controller.ts         control surface: GET|POST /_github/*
    github-store.ts               in-memory store singleton (§3)
    github-store.service.ts       seed/clear/emit orchestration + store summary
    github-fixture-loader.ts      load curated demo set from demo/data/github/
    github-random-generator.ts    random repos/deployments/statuses/workflow-YAML factory
    rate-limit-headers.ts         X-RateLimit-* + Link header helper
  test/
    github-rest.controller.spec.ts
    control.controller.spec.ts
    github-store.spec.ts
    github-random-generator.spec.ts
    github-fixture-loader.spec.ts
  Dockerfile                      multi-stage: build → node:lts-alpine runtime
  package.json
  tsconfig.json
```

---

## 3. In-memory store

Store is process-local and **independent of the dashboard API's data** — it survives an API data-reset, enabling the fetcher to re-backfill from it post-reset.

Per-repo shape:

| Key | Contents |
|---|---|
| deployments | List of deployment objects (`id`, `sha`, `ref`, `environment`, `payload`, `creator.login`, `created_at`) |
| statuses (per deployment) | Status lifecycle (`id`, `state`, `target_url`, `creator.login`, `created_at`) |
| runs (keyed by `run_id`) | Workflow run metadata (`id`, `name`, `path`, `head_sha`) |
| workflow YAML (keyed by `path` + `ref`) | Raw YAML string |
| environments | List of `{ name }` objects |
| artifacts (per `run_id`) | Artifact metadata + content (`id`, `name`, `expired`, version string) |

---

## 4. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3100` | HTTP listen port |
| `GITHUB_SIM_RATE_LIMIT` | `5000` | Simulated hourly request quota; reflected in `X-RateLimit-*` headers + `GET /rate_limit` response. Drives the fetcher's F16 budget logic. |
| `SEED_ON_STARTUP` | `true` | When `true`, seeds the demo set from `demo/data/github/` on startup so the fetcher has data immediately (§9). |
| `SCENARIOS_DIR` | `../../demo/data` | Base path for fixture resolution. |
| `EMIT_INTERVAL_MS` | `8000` | Interval between appended deployments while periodic emission is enabled (§6.3). |

---

## 5. Emulated GitHub REST surface — `/`

Paths are served at the service root (no prefix). The fetcher points `GITHUB__BASE_URL=http://github-emulator:3100`; its root-relative paths resolve directly.

| Method | Path | Response shape | FETCHER_SPEC ref |
|---|---|---|---|
| `GET` | `/repos/{owner}/{repo}/deployments?environment=&per_page=&page=` | Array of deployment objects (`id`, `sha`, `ref`, `environment`, `payload`, `creator.login`, `created_at`); newest-first; filtered by `environment` when present; paginated (`Link rel=next` when more pages remain). | §5.1, §5.8.2 |
| `GET` | `/repos/{owner}/{repo}/deployments/{id}/statuses` | Array of status objects (`id`, `state`, `target_url`, `creator.login`, `created_at`); newest-first. | §5.1 |
| `GET` | `/repos/{owner}/{repo}/actions/runs/{run_id}` | Run metadata (`id`, `name`, `path`, `head_sha`). | §5.6.2 |
| `GET` | `/repos/{owner}/{repo}/contents/{path}?ref={sha}` | `{ content: "<base64 workflow YAML>", encoding: "base64" }`. | §5.6.2 |
| `GET` | `/repos/{owner}/{repo}/actions/workflows?per_page=100` | `{ total_count, workflows: [{ id, name, path, state }] }`. | §5.8.2 |
| `GET` | `/repos/{owner}/{repo}/environments` | `{ total_count, environments: [{ name }] }`. | §5.8.2 |
| `GET` | `/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts` | `{ total_count, artifacts: [{ id, name, expired }] }`. | §5.7.2 |
| `GET` | `/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip` | `application/zip` containing a single text file whose content is the version string. | §5.7.2 |
| `GET` | `/rate_limit` | `{ resources: { core: { limit, remaining, used, reset } } }`. | §5.9 |

**Cross-cutting.**

- Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Used`, and `X-RateLimit-Reset` from a simulated per-process budget that decrements per request and rolls over hourly (budget = `GITHUB_SIM_RATE_LIMIT`). Drives the fetcher's F16 budget path.
- List endpoints carry a `Link: <...>; rel="next"` header while more pages remain. Drives the fetcher's pagination loop.
- Unknown repo / deployment / run / path → GitHub-shaped `404` (NOT RFC 9457 — this surface emulates GitHub, not the dashboard API).
- Auth headers (`Authorization: Bearer`, `Accept`, `X-GitHub-Api-Version`) are accepted but NOT validated (internal demo service).

---

## 6. Control surface — `/_github/`

Intended for the demo driver proxy, test harnesses, and manual operation. No auth required.

### 6.1 Status

| Method · Path | Response |
|---|---|
| `GET /_github/status` | `GithubStoreStatus` |

`GithubStoreStatus`:
```json
{
  "dataset":      "demo",
  "repos":        2,
  "deployments":  18,
  "statuses":     54,
  "workflows":    4,
  "environments": 3,
  "emitting":     false,
  "seeded_at":    "2026-05-31T10:00:00Z"
}
```

### 6.2 Seed + clear

| Method · Path | Request | Response | Effect |
|---|---|---|---|
| `POST /_github/seed` | `{ dataset: "demo"\|"random", count?: number, reset?: boolean }` | `GithubStoreStatus` | `reset:true` clears the store first. `"demo"` loads the curated fixture (§7); `"random"` generates synthetic data (§8). `count` = number of services/workflows for random, ignored for demo. |
| `POST /_github/clear` | — | `GithubStoreStatus` | Empties the store. |

### 6.3 Emission control

| Method · Path | Request | Response | Effect |
|---|---|---|---|
| `GET /_github/emit` | — | `{ emitting: boolean }` | Read-only status. |
| `POST /_github/emit` | `{ enabled?: boolean }` — omit to toggle | `{ emitting: boolean }` | When enabled, every `EMIT_INTERVAL_MS` appends a new deployment + in-progress→success/failure status lifecycle (`created_at=now`) so the fetcher's next poll picks it up. |

---

## 7. Curated demo set (`demo/data/github/`)

The fixture files loaded when `dataset: "demo"` is requested. They MUST cover:

- ≥2 repos whose workflow `name:` fields map to demo service identities coherent with `demo/data/events.json` (same service and environment names).
- At least one workflow with a dev→staging→prod deployment-job `needs` chain, so `parent_deployments` resolves a real chain per FETCHER_SPEC §5.6 (F10).
- At least one service whose version comes from a `version.txt` artifact to exercise `artifact:` resolution (FETCHER_SPEC §5.7, F15).
- A spread of `success`, `failure`, and `in-progress` status lifecycles across deployments.

---

## 8. Random set + periodic emit

- Generated repos/workflows/deployments are analogous to the write-path `random-event-generator.ts` in the demo driver.
- Generated workflow YAML includes an environment `needs` chain so parent derivation works on random data (F10 exercised).
- Periodic emit appends new deployments (`created_at=now`) over time; the fetcher's incremental poll picks them up on the next interval.

---

## 9. Startup defaults

| State | Default |
|---|---|
| Store | Seeded from `demo/data/github/` demo set when `SEED_ON_STARTUP=true` (default) |
| Emission | Disabled |
| Rate-limit budget | `GITHUB_SIM_RATE_LIMIT` (default 5 000), rolling hourly |

When `SEED_ON_STARTUP=true` the emulator is immediately ready for the fetcher without a manual `POST /_github/seed` call — the fetcher starts backfilling as soon as it connects.

---

## 10. Testing

| Layer | File | Scope |
|---|---|---|
| Unit | `github-store.spec.ts` | Store CRUD (seed / clear / emit); per-request rate-limit decrement + hourly rollover; store independent of API data |
| Unit | `github-rest.controller.spec.ts` | Each emulated endpoint returns the correct shape; `X-RateLimit-*` headers on every response; `Link: rel="next"` when more pages; unknown repo/deployment/run/path returns GitHub-shaped `404` |
| Unit | `control.controller.spec.ts` | `seed` / `clear` / `emit` / `status` endpoints correct; seed + clear mutate the store; emit toggle works |
| Unit | `github-random-generator.spec.ts` | Generated workflow YAML includes an environment `needs` chain; deployments have a full in-progress→success/failure lifecycle; all required fields present |
| Unit | `github-fixture-loader.spec.ts` | Curated demo fixture loads without error; covers F10 (dev→staging→prod `needs` chain) and F15 (artifact-sourced version); loaded dataset matches `GithubStoreStatus` counters |
| Integration | `fetcher-emulation.e2e.spec.ts` | Start emulator + seed demo set (`POST /_github/seed {dataset:"demo"}`); run the real fetcher-host against `http://github-emulator:3100`; real `Dashboard.Api` + Postgres; assert the dashboard shows the expected services, a non-trivial `parent_deployments` chain, and an artifact-sourced version. Realizes FETCHER_SPEC §7.2. |

---

## 11. Running

```powershell
cd demo/github-emulator
npm install          # first time only
npm run start:dev    # ts-node, hot-reload
```

Override port or rate-limit quota:

```powershell
$env:PORT                 = '3100'
$env:GITHUB_SIM_RATE_LIMIT = '1000'
npm run start:dev
```

---

## 12. Deployment

| Aspect | Spec |
|---|---|
| Image | Multi-stage Dockerfile in `demo/github-emulator/`. Stage 1: `node:lts-alpine` builds TypeScript. Stage 2: `node:lts-alpine` runs the compiled output. |
| Compose service | `github-emulator` in the demo compose profile. Internal-only — no gateway route. |
| Network | Fetcher reaches the emulator directly on the internal compose network at `http://github-emulator:3100`. The demo driver proxy reaches it at `http://github-emulator:3100` (or `GITHUB_EMULATOR_URL`). |
| Port | Container listens on `PORT` (default `3100`). Not exposed to the host by default. |

---

## 13. Out of scope

- ETag/`304` conditional-request emulation (the fetcher tolerates its absence — FETCHER_SPEC §5.5).
- Dynamic editing of individual seeded fixtures beyond `/_github/seed`, `/_github/clear`, and `/_github/emit`.
- Emulating GitHub APIs the fetcher does not consume (e.g. issues, pull requests, checks).
- Authentication or access control (internal-only service).
