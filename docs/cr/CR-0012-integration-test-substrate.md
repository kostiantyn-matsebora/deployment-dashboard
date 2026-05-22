---
title: "CR-0012: Integration Test Substrate"
parent: CRs
nav_order: 12
---

# CR-0012 — Integration test substrate: WireMock.Net mock-gha service + `testing/integration/` suite + demo-bundle co-location

- **Status:** Accepted 2026-05-22
- **Trigger:** GitHub issue [#10](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/10) — *"Introduce a WireMock.Net standalone Docker service that emulates the subset of the `api.github.com` surface the fetcher consumes, plus a `testing/integration/` suite that exercises the inbound ingest path end-to-end (fetcher → gateway → write-API → DB → SSE). The same Docker image doubles as the substrate for a future demo mode."*

  The write path — `Dashboard.Fetcher` (CR-0009) polling `api.github.com`, derived events POSTed to the Write API through the gateway, NOTIFY/LISTEN fan-out, SSE fan-out — has unit coverage at best and zero cross-stack verification. The natural blocker is that the fetcher's upstream is a third-party API we cannot pin or replay. This CR locks the substrate that closes that gap (deterministic upstream + cross-stack runner + scenario corpus) and authors the demo bundle in the same fixture root for follow-up demo-mode wire-up.

- **Co-owned by:** `solution-architect` (governance + CR-0012 + `docs/integration-tests.md` semantics) · `qa-engineer` (mapping + scenario inventory + `testing/integration/` suite + `testing/fixtures/gha/` corpus) · `devops-engineer` (compose service `mock-gha` + `.github/workflows/integration.yml` + `dev_env/start.ps1 -Integration` switch).

- **Co-owned doc surface:**

  | Surface | Semantics owner | Operational examples / shape owner |
  |---|---|---|
  | This CR | `solution-architect` | — |
  | `docs/integration-tests.md` § 1–3, 6, 9, 10 | `solution-architect` | `qa-engineer` (mappings + scenarios) + `devops-engineer` (compose + workflow) |
  | `docs/integration-tests.md` § 4–5, 7–8 | `qa-engineer` (mapping conventions, admin-API scenario activation) + `devops-engineer` (CI invocation, `-Integration` switch) | — |

- **Change.** Four co-introduced design decisions plus one framing decision.

  - **3a — Deterministic-upstream substrate.** A standalone `mock-gha` container running a pinned WireMock.Net Docker image, addressable on the internal Docker network only, gated by an `integration` compose profile. The fetcher reaches it via `GHA_API_BASE_URL=http://mock-gha:80` — **no fetcher source change** (the env-var contract already exists at `dev_env/docker-compose.local.yml:217`).

    | Aspect | Decision | Rationale |
    |---|---|---|
    | Image | A community-published WireMock.Net image, tag pinned in `dev_env/docker-compose.local.yml` + `install/docker-compose.release.yml` | First-party wrapper is unwarranted — community image follows the same posture as `postgres:16-alpine` already in the stack |
    | Posture | **No `ports:`** on the service definition outside the `integration` profile (NFR-04); admin port published to host **only** when the `integration` profile is active | Strict NFR-04 in production; admin surface accessible from the test runner during integration runs |
    | Profile | `integration` (compose profile name); future `demo` profile reuses the same service definition with a different mappings mount | One service definition, two consumers (tests + demo) — fixture mount differs |
    | Wire reach | Internal Docker DNS `mock-gha:80` for the fetcher; admin API on the runner only via host-mapped port (integration profile only) | NFR-04 production posture preserved; runner-side scenario activation enabled |

  - **3b — `testing/integration/` cross-stack runner.** A new xUnit project sibling to `testing/functional/`. Brings up the stack with the `integration` profile, programmatically loads a scenario into `mock-gha` via its admin API (`POST /__admin/mappings/import`), waits for the fetcher to poll, asserts the resulting Read-API state + SSE wire. **`FETCHER_POLL_INTERVAL_SECONDS=1`** in the integration profile so the NFR-03 5 s envelope remains meaningful.

  - **3c — Fixture corpus shape.** WireMock-native JSON mappings under `testing/fixtures/gha/`, organised as:

    | Path | Purpose |
    |---|---|
    | `testing/fixtures/gha/mappings/` | Per-endpoint base mappings — one file per `(method, URL pattern)`, filename-prefix ordered for priority |
    | `testing/fixtures/gha/scenarios/<state-id>/` | Per-state scenario bundles — one directory per canonical box state (six states from `local/index/ui-states.yaml`) |
    | `testing/fixtures/gha/scenarios/_cross-cutting/` | Cross-cutting scenarios (NFR-05 replica restart, ADR-0004 cursor contract) — distinct from box-state scenarios |
    | `testing/fixtures/gha/demo/` | Demo-mode mapping bundle — long-running multi-service script for follow-up demo-mode issue |

  - **3d — Demo-bundle co-location.** The demo bundle is authored under `testing/fixtures/gha/demo/` as part of this CR but **not** wired into any current entrypoint. The follow-up demo-mode issue consumes it via the future `demo` compose profile. Both the bundle's `README.md` and the demo-bundle section header of `docs/integration-tests.md` carry the verbatim disclaimer: *"AUTHORED HERE, CONSUMED BY: follow-up demo-mode issue. Not wired into any current entrypoint."*

  - **3e — CI workflow severity.** `.github/workflows/integration.yml` lands as **non-blocking watching-week**, then promotes to blocking after one calendar week of green runs. Mirrors CR-0010 Open trade-off (ii) — the integration suite's first runs gather signal; once stable, branch-protection requires it green.

- **Six canonical box states — source of truth.** Recanonicalised against `local/index/ui-states.yaml`, **not** the issue body's GHA-lifecycle list (`success / failure / in-progress / canceled / skipped / queued` — these are upstream GHA states, not dashboard box states). Each integration scenario drives exactly one canonical box state:

  | state-id | Box state | Source |
  |---|---|---|
  | `success` | Last deployment succeeded | `local/index/ui-states.yaml` row 1 |
  | `running-with-last` | Deploying now; previous terminal was success | `local/index/ui-states.yaml` row 2 |
  | `running-failed-with-last` | Deploying now; previous terminal was failure; older success exists | `local/index/ui-states.yaml` row 3 |
  | `failed-with-last` | Last deployment failed; older success exists | `local/index/ui-states.yaml` row 4 |
  | `running` | Deploying now; no prior successful deployment | `local/index/ui-states.yaml` row 5 |
  | `running-failed` | Deploying now; previous terminal was failure; no successful history | `local/index/ui-states.yaml` row 6 |

  Plus two cross-cutting scenarios:

  | Scenario | Asserts |
  |---|---|
  | `_cross-cutting/replica-restart` | NFR-05 — API replica bounce mid-fetch loses no event |
  | `_cross-cutting/cursor-contract` | ADR-0004 — second fetch with persisted cursor returns only new runs |

- **Endpoint coverage matrix vs CR-0009 § 3d.** The mock surface MUST cover the five endpoints the `github-actions` adapter calls today. Re-paste lives in `docs/integration-tests.md § 6`; the matrix is the single source of truth.

- **Profile-gating contract — strict.**

  | Compose surface | Default | Integration profile | Production posture |
  |---|---|---|---|
  | `mock-gha` service exists | yes (profile-gated) | yes (started) | inert (no `ports:`, never started) |
  | `mock-gha` admin port published to host | no | yes | **never** (NFR-04) |
  | `FETCHER_POLL_INTERVAL_SECONDS` | `30` (per CR-0009 default) | `1` | `30` |
  | `release-install` (`install/docker-compose.release.yml`) | service defined, profile-gated | n/a | admin port **never** published; production is unchanged from CR-0010 / ADR-0010 posture |

- **Compose version floor.** `docker compose >= 2.20` — required because the integration profile uses `depends_on: required: false` for the optional `mock-gha` service. `.github/workflows/integration.yml` carries a `Verify docker compose >= 2.20` precondition step; `dev_env/start.ps1 -Integration` carries the same precondition locally.

- **FR-06 assertion seam — read-side echo (Option b).** Each scenario asserts FR-06 wire-format compatibility by reading the persisted event back via `GET /api/deployments/{service}/{environment}/history` (the Read API echo) — **not** by intercepting the fetcher's POST against a WireMock-shaped write API. The Read-side echo is the contract surface: persistence + DTO mapping prove the wire shape lossless end-to-end. Avoids double-mocking (WireMock on both sides) and avoids asserting against the fetcher's internal HTTP client.

- **No new FR / NFR.** This CR introduces a test substrate; it does not amend any frozen requirement. FR-06 / NFR-03 / NFR-04 / NFR-05 are the existing requirements the integration suite asserts.

- **No new ADR.** Substrate design is fully captured here; no architecture decision rises above CR-level (no new pattern, no superseded ADR, no evolved invariant). ADR-0004 (cursor contract) and ADR-0010 (release-install merge-override) are cited as the existing decisions the substrate verifies / preserves.

- **No SAD edit.** `docs/architecture.md` is unchanged by this CR — no new ASR row, no FR/NFR amendment, no §10 decision row, no §7 component table change. Readers follow the chain `architecture.md → CR-0012` only when integration-test concerns arise; SAD frozen surface is untouched.

## Acceptance criteria

- [ ] `mock-gha` service exists in `dev_env/docker-compose.local.yml` + `install/docker-compose.release.yml` gated by the `integration` profile; pinned WireMock.Net image tag.
- [ ] `mock-gha` admin port is published to the host **only** under the `integration` profile; the `release-install` posture never publishes it (NFR-04).
- [ ] `FETCHER_POLL_INTERVAL_SECONDS=1` set in the `integration` profile so NFR-03 5 s envelope is exercised meaningfully.
- [ ] `testing/integration/` xUnit project exists with at least one scenario per canonical box state (six total, state-ids per `local/index/ui-states.yaml`) plus the two `_cross-cutting/` scenarios (NFR-05 replica restart, ADR-0004 cursor contract).
- [ ] Each scenario asserts: (a) FR-06 wire shape via Read-side echo (`GET /api/deployments/{service}/{environment}/history`); (b) Read API surfaces the event within NFR-03 5 s window; (c) SSE stream emits one slot-update per event.
- [ ] WireMock mappings under `testing/fixtures/gha/mappings/` cover the five endpoints the `github-actions` adapter calls (per CR-0009 § 3d); coverage matrix re-pasted in `docs/integration-tests.md § 6`.
- [ ] `.github/workflows/integration.yml` runs the suite on PR + push to `main` with path filters; lands non-blocking, promoted to blocking after one calendar week of green runs.
- [ ] `.github/workflows/integration.yml` includes a `Verify docker compose >= 2.20` precondition step.
- [ ] `dev_env/start.ps1` accepts a `-Integration` switch (mirrors the `-Fetcher` precedent from issue #5) that brings the stack up with the `integration` profile active.
- [ ] `docs/integration-tests.md` ships covering all ten sections per `bindings.md` → `docs/integration-tests.md` row.
- [ ] `testing/fixtures/gha/demo/README.md` carries verbatim: *"AUTHORED HERE, CONSUMED BY: follow-up demo-mode issue. Not wired into any current entrypoint."*
- [ ] `docs/integration-tests.md` demo-bundle section header carries the same verbatim disclaimer.
- [ ] `docs/ci-cd-pipelines.md § 13` row *"Integration smoke / e2e (Q12)"* removed.
- [ ] `docs/WBS.md § 1.6.9` "integration / e2e CI workflow" line removed.
- [ ] `testing/config/README.md` documents the new `integration.json` schema (`readBaseUrl` / `writeBaseUrl` / `apiKey` / `mockGhaAdminBaseUrl` / `fetcherSourceIds`).
- [ ] `.agents/ginee/local/bindings.md` carries the five new governance rows + tree update + Stack-table CI/CD sentence.
- [ ] No regression to existing test surfaces (unit / functional / e2e / mockup-visual / scripts).

## Alternatives Considered

Mirrors the alternatives the issue body listed, locked here as the design-of-record:

| Alternative | Rejected because |
|---|---|
| First-party `mock-gha-host/` ASP.NET Core project | New codebase to maintain when WireMock.Net already does this; no win unless we hit a WireMock limitation in practice |
| WireMock.Net in-process inside the test runner only | Demo-mode reuse impossible — the WireMock instance dies with the test process; demo mode would need its own separate mechanism |
| Static nginx serving JSON fixtures | No dynamic state — pagination, cursor-evolving responses, and scenario step-throughs are not expressible without per-test nginx reconfig |
| Hand-roll a first-party Minimal API mock | All WireMock.Net's benefits, zero of the maintenance discount |

## References

- GitHub issue [#10](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/10) — the trigger.
- [CR-0009](./CR-0009-pull-mode-fetcher-and-progress-reporter.md) § 3d — adapter endpoint inventory (the five-endpoint surface the mock must cover).
- [ADR-0004](../adr/ADR-0004-opaque-per-progress-reporter-cursor.md) — opaque-cursor contract asserted by the `_cross-cutting/cursor-contract` scenario; fetcher non-co-location posture.
- [ADR-0010](../adr/ADR-0010-release-install-merge-override.md) — release-install canonical compose; this CR layers the `integration` profile on top via the same merge-override mechanic.
- [CR-0010](./CR-0010-component-ci-pipeline.md) Open trade-off (ii) — non-blocking-watching-week → blocking promotion pattern this CR mirrors for `integration.yml`.
- `docs/integration-tests.md` — operational guide (mapping authoring, admin-API scenario activation, endpoint coverage matrix, CI invocation, `-Integration` switch, demo-bundle disclaimer).
- `local/index/ui-states.yaml` — canonical six-state inventory (`success` / `running-with-last` / `running-failed-with-last` / `failed-with-last` / `running` / `running-failed`).
- `dev_env/docker-compose.local.yml:217` — pre-existing `GHA_API_BASE_URL` env-var contract the integration profile re-points at `mock-gha:80`.
- `install/docker-compose.release.yml` — canonical service inventory; the `mock-gha` service definition lives here per ADR-0010 (dev_env layers via `-f` merge).
- WireMock.Net upstream: https://github.com/WireMock-Net/WireMock.Net
- WireMock admin API: https://wiremock.org/docs/api/
