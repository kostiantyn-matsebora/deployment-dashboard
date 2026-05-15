# Progress Snapshot — 2026-05-16 (end of session, TODO line 8 consolidated-API container closed)

Resume point. Read `CLAUDE.md` first; this is a working snapshot, not authoritative.

## One-line status

Write + Read APIs consolidated into a single deployable container (`backend/api/Dashboard.Api`) hosting two library surfaces; API-key middleware refactored to `IEndpointFilter` and scoped to the write endpoint group only. Full four-phase cycle: SAD + CLAUDE.md updated (Decision 11), backend C# host added with libraries kept separate for future re-split, Dockerfile + compose + gateway collapsed to one upstream (location-block identity preserved). 130/130 backend tests green; stack came up clean on first compose; SSE end-to-end 0.10s; SA Phase 4 SIGN-OFF.

## Cycle closed this session

### Cycle E — Consolidate Write+Read APIs into one container (TODO line 8)

Four-phase execution:

| Phase | Agent | Deliverable |
|---|---|---|
| 1 — Contract | `solution-architect` | SAD edits: §6 budget (3 ACA apps, not 4), §7 intro + High-Level Overview diagram + C4 note + Components summary table + new "Backend module architecture" + "Future split — trigger conditions" subsections + Routing matrix (single upstream, per-path block identity preserved) + Local Development containers table + Azure Deployment ASCII + Component Mapping cost table, §8 (API-key scoping to write group only), §9 MVP container row, §10 NEW Decision 11 ("one container, two library surfaces — split deferred"), §11 WBS 1.0 (new) / 1.1 / 1.1.2 / 1.1.4 / 1.2 / 1.2.7 / 2.1 / 4.5 / 5.2 / 7.3 / 8.1. CLAUDE.md repo-structure tree rewritten (host + library projects, dependency rules mirror frontend modular monolith). `docs/ci-cd-integration.md` verified unchanged (callers see only the gateway URL). |
| 2a — Backend (parallel) | `backend-engineer` | New `backend/api/Dashboard.Api/` host project (`Microsoft.NET.Sdk.Web`, `Program.cs`, `appsettings.{json,Development.json}`, `Properties/launchSettings.json`, `api.http`). `Dashboard.WriteApi` and `Dashboard.ReadApi` converted to **library projects** (`Microsoft.NET.Sdk` + `FrameworkReference Microsoft.AspNetCore.App`; no `Program.cs`; no Dockerfile). Endpoint registration extracted into `WriteApiEndpoints.MapWriteEndpoints(IEndpointRouteBuilder)` and `ReadApiEndpoints.MapReadEndpoints(IEndpointRouteBuilder)`, paired with `services.AddWriteApi(IConfiguration)` / `services.AddReadApi(IConfiguration)` extensions. `ApiKeyMiddleware` refactored from pipeline middleware to `IEndpointFilter`; `RequireApiKey()` extensions on `RouteGroupBuilder` + `RouteHandlerBuilder`. `PATCH /api/config/topology` moved from read-side to write-side endpoint group so auth boundary is composition-time, not request-time. `Dashboard.sln` updated. Project graph: `api → write+read+shared`; `write → shared`; `read → shared`; libraries do not reference each other or `api`. **130/130 tests green** (Shared 64 + Read 42 incl. 6 new ApiKeyScopingTests + Write 24); 0 warnings, 0 errors. |
| 2b — DevOps (parallel) | `devops-engineer` | `backend/api/Dockerfile` created (multi-stage SDK→aspnet:10.0; `dotnet publish api/Dashboard.Api/Dashboard.Api.csproj`; ENTRYPOINT `dotnet Dashboard.Api.dll`; `ASPNETCORE_URLS=http://+:8080`; non-root user preserved). Deletions: `backend/write-api/Dockerfile`, `backend/read-api/Dockerfile`, `backend/write-api/.dockerignore`, `backend/read-api/.dockerignore`. `backend/.dockerignore` kept as single source of truth for bin/obj scrub. `dev_env/docker-compose.local.yml` and `dev_env/docker-compose.scaled.yml`: two services collapsed to one `api:` service; env vars union (`API_TOKEN` + `HISTORY_RETENTION_DAYS`); `gateway.depends_on` updated; scaled compose runs 3 × `api`. `gateway/nginx.conf`: `upstream write_api` + `upstream read_api` + `map $request_method $deployments_upstream` collapsed into a single `upstream api { server api:8080; keepalive 32; }`; **four `location` blocks preserved by per-path identity** (`/api/deployments`, `/api/stream`, `/health`, `/api/`) all `proxy_pass http://api…` — future re-split is a one-line-per-location change. SSE pass-through tuning untouched (`proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 1h`, `Last-Event-ID` forwarding, `X-Accel-Buffering: no`, `gzip off`). No Terraform / `.github/workflows/` work in this cycle (both directories empty; SAD now documents the future three-ACA-app shape). |
| 3 — Integration | `backend-engineer` (integrator) | Full stack `pwsh start.ps1`: db healthy, migrations exited 0, api / dashboard / gateway up. **9/9 smoke rows green** (GET /health → 200; GET /api/environments → 200; GET /api/services → 200; GET /api/deployments → 200; GET /api/stream → 200 + `text/event-stream`; GET /api/config/topology → 200 unauth; POST /api/deployments no-key → **401**; POST with key → 201; PATCH /api/config/topology no-key → **401**; PATCH with key → 200). **Auth boundary verified end-to-end** — reads unauthenticated, writes API-key-gated. **SSE round-trip 0.10s** (NFR-03 budget 5s). Manual browser smoke from a real Chrome session validated via gateway access logs (SPA shell + both Angular bundles + all four bootstrap endpoints all 200 from `api:8080` upstream). Caveat honestly flagged: integrator cannot read DevTools / drive the browser, so DOM-level matrix/drawer/filter visual rendering not confirmed at the console level — recommended follow-up: Playwright DevTools-level smoke. Zero C# fixes needed during integration. Clean teardown via `stop.ps1`. |
| 4 — Compliance | `solution-architect` | **SIGN-OFF: 7/7 invariants PASS**. NFR-02 (≤ $30/mo; 3 ACA apps vs prior 4), NFR-03 (0.10s measured vs 5s budget), NFR-04 (gateway still the only public ingress; api + dashboard `expose:`-only), NFR-05 (stateless; scaled compose 3 × api; `Last-Event-ID` forwarded), §8 security (write group filter only, no global `UseMiddleware`), §6 platform agnosticism (OCI-compliant, port 8080, no Azure-proprietary bindings), library boundary preserved (re-split seam real — verified via project graph + nginx per-path identity). Mockup unaffected. Phase 3 manual-smoke section present with honest caveat. No SAD edits needed during review. |

## Stack status (verified end-of-session via Phase 3 integration)

| Container | State | Endpoint |
|---|---|---|
| `dashboard-gateway` | `Up (healthy)` | `http://localhost:8080/` (only public) |
| `dashboard-frontend` | `Up (healthy)` | internal, served via gateway |
| `dashboard-api` | `Up` | internal — replaces former `dashboard-write-api` + `dashboard-read-api` |
| `dashboard-db` | `Up (healthy)` | `localhost:5432` |
| `dashboard-pgadmin` | `Up` | `http://localhost:5050/` |
| `dashboard-migrations` | `Exited (0)` | one-shot |

Resume clean: `pwsh -NoProfile -File dev_env/stop.ps1` → `pwsh -NoProfile -File dev_env/start.ps1` → `pwsh -NoProfile -File testing/scripts/seed.ps1 -Clean`.

## Test suite counts (backend only run this cycle)

| Suite | Count | Command |
|---|---|---|
| Backend unit (Shared 64 + Read 42 incl. 6 new ApiKeyScopingTests + Write 24) | **130 / 130** (was 124 → +6 net) | `dotnet test backend/Dashboard.sln` |
| Frontend unit | **183 / 183** (unchanged — no SPA work this cycle) | `cd frontend && npm test -- --watch=false` |
| Functional / API | **76 / 76** (unchanged) | `pwsh -NoProfile -File testing/functional/run-tests.ps1` |
| E2E (Playwright, chromium) | **79 / 79** (unchanged) | `pwsh -NoProfile -File testing/e2e/run-tests.ps1` |
| Mockup visual harness | **12 / 12** (unchanged) | `pwsh -NoProfile -File testing/mockup-visual/run-tests.ps1` |
| Integration smoke this cycle | **9 / 9** rows green | Phase 3 ad-hoc curl matrix against `http://localhost:8080` |

Frontend / functional / e2e / mockup-visual suites NOT re-run this cycle (no code in those domains changed). Recommended to re-run once before the next substantive cycle to confirm zero drift.

## Contract landmarks landed today

| Landmark | SAD anchor | Code anchor |
|---|---|---|
| Single backend deployable container hosting two library surfaces | SAD §7 "Backend module architecture", §10 Decision 11 | `backend/api/Dashboard.Api/Program.cs` (composition root) + `backend/Dashboard.sln` |
| Library boundary preserved for future re-split | SAD §7 "Future split — trigger conditions" | `Dashboard.WriteApi.csproj` + `Dashboard.ReadApi.csproj` (both `Microsoft.NET.Sdk` library, no `OutputType=Exe`); project graph in `Dashboard.sln` |
| API-key middleware as endpoint filter on write group only | SAD §8 Security, §7 "Backend module architecture" rule row | `backend/shared/Dashboard.Shared/Security/ApiKeyMiddleware.cs` (`IEndpointFilter` + `RequireApiKey()` extensions); applied at `Program.cs` via `MapGroup(string.Empty).RequireApiKey()` |
| PATCH `/api/config/topology` on write group (auth-gated) | SAD §11 WBS 1.2.7 | `WriteApiEndpoints.MapTopologyConfigPatch` |
| Gateway single upstream, per-path location identity preserved | SAD §7 "App Gateway → Routing matrix" + "Future split" | `gateway/nginx.conf` (one `upstream api`; four `location` blocks each `proxy_pass http://api…`) |
| Three-image deployment topology (api, dashboard, gateway) | SAD §6, §7 Component Mapping table, §10 Decision 11 | `dev_env/docker-compose.local.yml` + `dev_env/docker-compose.scaled.yml` |

## TODO status (`TODO` is canonical — file edited this session)

| # | Item | Status |
|---|---|---|
| 1 | Genericize service names | ☒ |
| 2 | UX: UI compactness + four-view picker (FR-12) | ☒ |
| 3 | UX: Tree-shaped promotion flow (Layout axis + topology) | ☒ |
| 4 | Add `ref` + `sha` attributes (data plane) | ☒ |
| 5 | UX: use `ref`/`sha` for Display + Topology | ☒ |
| 6 | **Architecture: merge read+write APIs into one container (this cycle)** | ☒ **closed this session** |
| 7 | UX: light/dark/auto theme | ☐ open — natural next pickup |
| 8 | UX: Version column width (long versions) | ☐ open |
| 9 | Architecture: strict API validation + OpenAPI/Swagger | ☐ open |
| 10 | Architecture: optional CI/CD fetcher component (pull-mode alternative) | ☐ open |
| 11 (Phase 2.0) | UX: group/colorize/correlate by attribute | ☐ open |

## Open follow-ups (non-blocking, surfaced during cycles)

1. **Playwright DevTools-level smoke** — close the headless-integrator visual gap from Phase 3. Add a Playwright check under `testing/e2e/` that boots the local stack and asserts (a) matrix grid mounts (≥ 1 slot box rendered), (b) drawer opens on slot click, (c) search filter + "failures only" toggle wired. Owner: `qa-engineer`. NEW this cycle.
2. **Favicon 404** — `GET /favicon.ico` returns 404 from the dashboard container (cosmetic; surfaces in gateway access log during smoke). Ship a project favicon in the SPA build output. Owner: `frontend-engineer`. NEW this cycle.
3. **`MapGroup` prefix semantic** — the write group uses `MapGroup(string.Empty).RequireApiKey()` because handlers register absolute paths; SAD §7 / §10 use the shorthand `MapGroup("/api").RequireApiKey()`. Semantically identical (filter scoping is by endpoint identity, not path prefix). Optional refactor if the literal `/api` prefix is preferred — rewrite each handler's pattern to be relative. NEW this cycle.
4. **Mockup drawer drift vs SPA drawer pattern** (pre-existing): mockup uses `x-show="hasAttr(...)"` to hide null ref/sha rows; SPA + e2e oracle keep testid-bearing anchors always-visible with empty content per Full-attribute disclosure rule. Both satisfy SAD §7. Convergence in a future cycle. Owner: `frontend-engineer` (mockup edit).
5. **Pre-existing e2e fragility**: no `localStorage.clear()` in `beforeEach`. Owner: `qa-engineer`.
6. **`docs/ui-compact-options.md` not cited in CLAUDE.md authoritative-files set**. Owner: `solution-architect`.
7. **`docs/ci-cd-integration.md`** — pre-existing: ~9 sections needing the `deployment_id` + `parent_deployments` field additions. Owner: `solution-architect`.
8. **`testing/functional/Dashboard.Functional.Tests/ConfigTopologyTests.cs`** — pre-existing: stale `AllowUserOverride` test references. Owner: `qa-engineer`.
9. **In-memory `SlotUpdateBroker` ring buffer survives DB truncate** — pre-existing: post-MVP item.
10. **Defensive `.dockerignore` from prior cycle** — backend hand-off `obj/` leak root cause; defensive scrub still in place (compose `migrations` service explicitly scrubs `/src/**/{bin,obj}` for the same reason; per Phase 2b, this discipline carried forward to the new layout via the single `backend/.dockerignore`).
11. **Stray malformed-path artifact** at repo root from prior session — pre-existing.
12. **Cleanup of `qa-bot-*` leaked rows** — pre-existing, cosmetic.

## Resume instructions

1. Open the working directory in Claude Code — agent definitions reload.
2. Recommended clean cycle before substantive work: `pwsh -NoProfile -File dev_env/stop.ps1` → `pwsh -NoProfile -File dev_env/start.ps1` → `pwsh -NoProfile -File testing/scripts/seed.ps1 -Clean`.
3. Run the full smoke ladder before the next cycle (this cycle only re-ran backend unit + integration smoke; frontend / functional / e2e / mockup-visual all unchanged but unverified post-consolidation).
4. Per the TODO-driven workflow in `CLAUDE.md`: read `TODO`, ask the user about the first ☐ item — currently **TODO line 9 "UX: light/dark/auto theme"**.
5. Address the open follow-ups (above) opportunistically when adjacent work touches the same files.

## Git state

- Repo: local-only, branch `main`, single prior commit `afcee6a Initial commit`.
- Local git config (repo scope): `user.name = kostiantyn-matsebora`, `user.email = komkom@duck.com`.
- Working tree at session end: consolidated-API cycle changes staged + committed (see latest `git log`).
- No remote configured.
