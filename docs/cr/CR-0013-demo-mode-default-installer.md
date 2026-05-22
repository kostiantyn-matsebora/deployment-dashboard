---
title: "CR-0013: Demo-Mode Default in Release-Install Entrypoint"
parent: CRs
nav_order: 13
---

# CR-0013 — Demo-mode default in release-install entrypoint: installer flag inversion + `demo` Compose profile + baked `demo-gha` image + realistic bundle content + dynamic-mock scenario walk

- **Status:** Accepted 2026-05-22
- **Trigger:** GitHub issue [#44](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/44) — *"Invert the release-install entrypoint default: `install.ps1` / `install.sh` boot a self-contained demo-mode stack (mock-gha + fetcher + realistic demo bundle) by default; the current `-Demo` (PostHog / real GHA upstream) behaviour becomes an explicit opt-in via `-RealGha` / `--real-gha`. Demo bundle ships as a baked Docker image."*

  Today a release-install with no flags brings up a healthy stack but renders an **empty** dashboard — no events, no slot population, no SSE traffic. Evaluators see an empty matrix and infer "broken." The closest path to "see what this thing does" requires `-Demo` against PostHog/Grafana public repos — sparse cadence, topology-narrow, no `parent_deployments` DAG, 60 req/h anonymous-mode rate cap. [CR-0012](./CR-0012-integration-test-substrate.md) co-located a `testing/fixtures/gha/demo/` bundle root for exactly this follow-up; CR-0013 wires it into the install flow + rewrites its content for a real demo story + makes it the no-flag default.

- **Co-owned by:** `solution-architect` (governance + CR-0013 + `docs/install.md` semantics + cross-references) · `devops-engineer` (installer flag inversion + `demo` Compose profile + `gateway/demo-gha/Dockerfile` + `.github/workflows/demo-gha.yml` caller) · `qa-engineer` (`testing/fixtures/gha/demo/` content — 6 services × 5+ envs + four DAG-edge shapes + WireMock.Net scenario corpus).

- **Co-owned doc surface:**

  | Surface | Semantics owner | Operational examples / shape owner |
  |---|---|---|
  | This CR | `solution-architect` | — |
  | `docs/install.md` § Quick start / Real GitHub repos / Empty / Migration footnote | `solution-architect` | `devops-engineer` (installer flag matrix + env-file examples) |
  | `docs/integration-tests.md § 3.1` (two profiles, two bundles) | `solution-architect` | `qa-engineer` (bundle content) + `devops-engineer` (Compose profile gating) |
  | `docs/ci-cd-pipelines.md § 2` (topology row) + `§ 4` (tag scheme note) + `§ 5` (content-only quality gate note) | `devops-engineer` | — |

- **Change.** Five co-introduced design decisions matching the issue body's §1–5.

  - **3a — Installer flag inversion.** `install.ps1` / `install.sh` invert the no-flag default from "empty stack" to "demo stack." The CR-0012 substrate (mock-gha + WireMock.Net + fetcher env-var indirection) is now the default path; today's PostHog/Grafana-pointed behaviour moves under an explicit opt-in flag and the `-Demo` flag becomes a silent back-compat alias.

    | Flag | After CR-0013 |
    |---|---|
    | (no flag) | Demo stack — `demo-gha` + fetcher pointing at `http://demo-gha:80`; ≥ 20 populated slots within 60 s of `/health` 200; no `$env:GHA_TOKEN` required |
    | `-RealGha` / `--real-gha` (renamed from `-Fetcher`) | Real GitHub Actions upstream — requires `$env:GHA_TOKEN`; identical semantics to today's `-Fetcher` (issue #5 precondition preserved) |
    | `-Empty` / `--empty` (new) | Bare-minimum stack — no fetcher, no demo-gha; direct-POST integrators only |
    | `-Demo` / `--demo` (back-compat) | Silently routes to the new default + logs one informational line; **not** documented in the new quick-start (Migration-from-earlier-versions footnote only) |

  - **3b — `demo` Compose profile.** `install/docker-compose.release.yml` gains a profile-gated block that bootstraps the demo-gha + fetcher pair. No bind-mount (the bundle is baked in); fetcher retargeted via the existing `${GHA_API_BASE_URL:-...}` indirection (the same env-var seam CR-0012 introduced for `integration`).

    | Surface | Default | `demo` profile | `integration` profile |
    |---|---|---|---|
    | `demo-gha` service exists | yes (profile-gated) | yes (started) | inert |
    | `mock-gha` service exists | yes (profile-gated) | inert | yes (started) |
    | `GHA_API_BASE_URL` | `https://api.github.com` | `http://demo-gha:80` | `http://mock-gha:80` |
    | `FETCHER_POLL_INTERVAL_SECONDS` | `30` | `5`–`10` (demo cadence — tuned so evaluators see motion without thrashing) | `1` (CR-0012 — NFR-03 envelope) |
    | `GHA_REPOSITORIES` | `[{"owner":"example-org","repo":"example-repo"}]` | `[{"owner":"demo-org","repo":"demo-repo"}]` (matches the bundle's URL patterns) | unchanged |
    | Admin port published to host | no | **never** (NFR-04) | yes (test-time only, via `dev_env/` override) |

    The two profiles **coexist** — they bind different services (`demo-gha` vs `mock-gha`) and never compete because the test runner activates `integration` while the installer activates `demo`. Same compose project, two non-overlapping fixture mounts.

  - **3c — Baked `demo-gha` Docker image (ship mechanism).** New first-party image `ghcr.io/kostiantyn-matsebora/deployment-dashboard-demo-gha:${DASHBOARD_VERSION}` — the 5th component image alongside api / fetcher / frontend / gateway. Built + published by CI via a new caller workflow inheriting the `_build-and-push-image.yml` reusable shape (CR-0010).

    | Aspect | Decision | Rationale |
    |---|---|---|
    | Base image | `sheyenrath/wiremock.net:2.4.0` (same pin CR-0012 uses for `mock-gha`) | One WireMock.Net binary across both profiles; admin-route variance pre-known |
    | Bundle path inside image | `/app/__admin/mappings/` | WireMock.Net .NET image's default admin file layout (CR-0012 § 3a footnote) — `COPY testing/fixtures/gha/demo/ /app/__admin/mappings/` |
    | Healthcheck | `bash -c ': > /dev/tcp/localhost/80'` | Same TCP-connect probe `mock-gha` uses — image lineage shared |
    | Tag scheme | `vX.Y.Z` + `vX.Y` + `sha-<7>` + `latest` (per CR-0010 `docker/metadata-action@v5`) | Tracks the four sibling images; no asset-vs-bundle drift |
    | Versioning | `${DASHBOARD_VERSION:-latest}` substitution at compose-resolve time | Installer rewrites `DASHBOARD_VERSION` in `dashboard.env`; the demo bundle is pinned by the same tag as the api/fetcher/frontend/gateway images |
    | Dockerfile residence | `gateway/demo-gha/Dockerfile` (devops territory) | Mirrors the per-component Dockerfile-co-location pattern (`backend/api/Dockerfile`, `gateway/Dockerfile`); `gateway/` is the closest non-application container surface |
    | Build context | `.` (repo root) | The Dockerfile's only `COPY` reaches into `testing/fixtures/gha/demo/`, which is outside `gateway/` — the context must be the repo root for the path to resolve |

    **Handoff seam — image name + tag scheme + bundle mount path are LOCKED here**; devops implements the Dockerfile + CI caller; qa authors the bundle content under `testing/fixtures/gha/demo/`. The Dockerfile's `COPY` of qa-owned content is a devops concern — the seam is the path string `testing/fixtures/gha/demo/` (qa) → `/app/__admin/mappings/` (devops).

  - **3d — Demo bundle content shape.** Replace the CR-0012 placeholder content under `testing/fixtures/gha/demo/` with a hand-authored corpus that exercises the full feature surface:

    | Axis | Coverage |
    |---|---|
    | Services (6) | `web-portal` · `api-gateway` · `auth-service` · `billing-service` · `notification-worker` · `analytics-pipeline` |
    | Environments (5–6) | `dev` · `qa` · `uat` · `staging` · `prod` (+ optional `canary` to demo fan-out-into-canary-then-prod) |
    | Total slots | 30–36 — comfortably above the 20-slot acceptance floor |
    | Event volume | 80–150 deployments spread across "past hours" of mock time |
    | UI states covered | ≥ 5 of the canonical 6 from `local/index/ui-states.yaml` within 60 s of bring-up |

    **DAG-edge shape coverage (all four — full topology demo).**

    | Shape | Where in bundle |
    |---|---|
    | Empty `parent_deployments` | First deployment per `(service, environment)` in the bundle's chronological view |
    | Single per-env predecessor | Subsequent deployments to the same `(service, environment)` — adapter's at-or-below-watermark candidate per `GitHubActionsAdapter.cs:611-625` |
    | Single intra-run `needs:` | `web-portal` deploys with a `build → deploy` two-job chain in workflow YAML |
    | Multiple `needs:` + mixed | `analytics-pipeline` deploys with `lint → test → build → deploy` four-job chain that also has per-env predecessors |

  - **3e — Dynamic-mock scenario walk.** WireMock.Net's stateful primitives (`Scenario` + `RequiredScenarioState` + `SetStateTo`) drive a ~20-tick scenario corpus baked into the image. Each tick adds 1–3 new deployments to the list-deployments response.

    | Aspect | Decision | Rationale |
    |---|---|---|
    | Cycle length | 10 minutes (20 ticks × ~30 s default poll resolved at 5–10 s demo cadence) | Long enough that evaluators see meaningful evolution; bounded enough that the loop reset is invisible in a typical session |
    | Loop behaviour | Loop back to state 1 after the final tick | Demo audience does not expect indefinite progression; the loop is acceptable |
    | New-event cadence | ≥ 3 per minute over the first 5 minutes | Acceptance-criterion floor — guarantees visible motion on first impression |
    | Cursor monotonicity | Deployment ids must monotonically increase across ticks (ADR-0004) | Fetcher's persisted cursor advances on each tick; without monotonic ids the second poll returns nothing |
    | Mapping authoring conventions | Reuse CR-0012 § 4 invariants (filename prefix, PascalCase JSON, `BodyAsJson`, regex via `Matchers` array) | One mapping format across both profiles; mapping authors transfer skill 1:1 between `mappings/` and `demo/` |

    **Amendment (issue #46).** The `Scenario` + `RequiredScenarioState` + `SetStateTo` mechanism above does not activate from `--ReadStaticMappings`-loaded mappings on WireMock.Net 2.4.0 (root cause recorded in § 4 against the original AC #9). The dynamic-events surface is restored via a sidecar replacement mechanism with the following revised inventory:

    | Aspect | Decision |
    |---|---|
    | Mechanism | Sidecar container POSTing to `demo-gha`'s WireMock.Net admin API on a fixed interval |
    | Cycle length | ≈ 2.5 min/cycle (10 ticks × 15 s); loops indefinitely |
    | New-event cadence | ≥ 3 / min over the first 5 min (AC #9 floor preserved) |
    | Cursor monotonicity | Sidecar rewrites IDs at apply-time per the invariant below |
    | Mapping authoring | Cumulative-body PUT; QA-pinned GUIDs |
    | Sidecar reach | `demo-driver → demo-gha` over Compose network only (NFR-04 preserved) |
    | Profile gating | `demo` profile only |

    Collision and cursor invariants. The sidecar replaces each touched per-service `list-deployments` mapping via `PUT /__admin/mappings/{pinned-guid}` against a process-local map of service-name → GUID seeded from the static base bundle. ID monotonicity is enforced by sidecar rewriting at apply-time: `effective_id = authored_id + (cycle_index × ID_STRIDE)` where `cycle_index` is derived from elapsed wall-clock since a fixed image-build epoch and `ID_STRIDE` exceeds the maximum authored ID within one cycle.

    Two rules hold across every tick:

    1. Each `PUT` body is the full cumulative array — WireMock.Net 2.4.0 does not merge mapping bodies so the sidecar always ships the complete state for that mapping.
    2. After rewriting, every `deployment.id` in the body is strictly greater than the persisted fetcher cursor and strictly greater than the static base maximum 10065 — restart safety follows because the wall-clock-derived cycle index only advances.

- **Consequences.**

  **Positive.**
  - Zero-config evaluator UX — `iwr ... | iex` (gh-mediated equivalent) renders a live, populated, evolving dashboard in 60 s with no PAT, no external network.
  - Full feature demo on first impression — all four DAG-edge shapes + ≥ 5 of 6 canonical box states + slot-update SSE traffic exercised by the demo bundle alone.
  - Strict win on NFR-02 vs today's `-Demo` — no external GitHub API calls (the current `-Demo` consumes anonymous-mode rate budget; demo-gha is zero recurring cost).
  - Bundle versioning tracks image tag — no asset-vs-bundle drift, no separate `gh release download` step in the installer (CR-0010 pipeline pattern fully reused).

  **Negative.**
  - Fifth first-party image — additional CI/CD surface (one new Dockerfile, one new caller workflow). Mitigated by reusing `_build-and-push-image.yml`'s shape; the caller is thin (content-only image, no `dotnet build`, no tests).
  - Scenario-state authoring complexity — 20-tick WireMock.Net stateful corpus is more complex than the per-state bundles CR-0012's integration suite uses. Mitigated by the WireMock.Net `Scenario` primitives doing the heavy lifting; qa authors mappings, the engine threads them.
  - Demo content is hand-authored fixture — no admin UI to inject new events at runtime; the corpus is static. Acceptable per the Out-of-scope list on issue #44.
  - The `-Demo` back-compat alias adds one cycle of deprecation noise to `install.ps1` / `install.sh`; documented as a one-release-cycle transition.

- **Alternatives Considered.**

  Mirrors the issue body's Section 4 ship-mechanism table, locked here as design-of-record:

  | Alternative | Rejected because |
  |---|---|
  | **(A) Release-asset download** mirroring `migration.sql` per ADR-0005 — fetch `demo-bundle.tar.gz` via `gh release download` on installer side, extract into a bind-mounted volume, mount into upstream `sheyenrath/wiremock.net:2.4.0` | Adds an installer download step + version drift risk (asset tag and image tag can diverge if a future release publishes one but not the other); asset-vs-bundle resolution adds installer complexity; ADR-0009 already retired the closest precedent (`migration.sql`) for analogous reasons. |
  | First-party `demo-gha-host/` ASP.NET Core Minimal API serving hand-coded JSON | New codebase to maintain when WireMock.Net already covers stateful mock with scenario primitives; no win over the baked-bundle path. |
  | Reuse the same `mock-gha` service + swap mappings via `--profile demo` mounting `testing/fixtures/gha/demo/` directly | Bundle versioning would not track image tag — operator upgrading from `v1.0.0` to `v1.1.0` could end up with a fresh image and a stale bundle pinned to the old release's tag; the baked-image path makes bundle + image atomically versioned. Additionally violates the CR-0012 "one mapping mount per service definition" posture — bind-mounting on a profile-gated production install bloats the installer's contract. |
  | Hand-roll a static JSON fixture set served by an nginx sidecar | No dynamic state — scenario step-throughs (the "dashboard evolves" feel) are not expressible without per-tick nginx reconfig; identical limitation to the rejected alternative in CR-0012. |

  **PICKED: (B) Baked Docker image** — `ghcr.io/.../deployment-dashboard-demo-gha:${DASHBOARD_VERSION}`. Trade-off: 5th first-party image (some CI/CD work). Benefit: installer remains "docker-compose-file-only" — no `gh release download` for the bundle, no extraction logic, no asset-mount path resolution. Reuses the CR-0010 GHCR pipeline pattern verbatim.

- **No new FR / NFR.** This CR introduces a UX-default inversion + a ship-mechanism for an existing test substrate; it does not amend any frozen requirement. FR-06 (wire-format compatibility) is preserved by construction — demo events use the documented wire shape with no new schema. NFR-02 (cost cap), NFR-04 (internal-only — `demo-gha` continues to publish no host port), NFR-05 (stateless backend — demo mode exercises the same write-path as the integration suite) are all preserved.

- **No new ADR.** Substrate design is fully captured here; no architecture decision rises above CR-level. ADR-0004 (cursor contract) and ADR-0010 (release-install merge-override) are cited as the existing decisions the new profile respects.

- **No SAD edit.** `docs/architecture.md` is unchanged by this CR — no new ASR row, no FR/NFR amendment, no §10 decision row, no §7 component table change. Readers follow the chain `architecture.md → CR-0013` only when demo-mode-default concerns arise; SAD frozen surface is untouched.

## Acceptance criteria

Mirrors the issue body's AC verbatim — devops owns 1, 2, 3, 4, 5, 6, 7, 14, 15; qa owns 8, 9, 10; SA owns 11, 12, 13, 16.

- [ ] `install.ps1` (no flags) brings up a healthy stack AND the dashboard renders ≥ 20 populated slots within 60 s of `/health` returning 200.
- [ ] `install.sh` (no flags) behaves identically on Linux/macOS.
- [ ] `install.ps1 -RealGha` (with `$env:GHA_TOKEN` set) behaves exactly as today's `install.ps1 -Fetcher` does — same fetcher service, same upstream, same env-var contract.
- [ ] `install.ps1 -Demo` (back-compat) silently routes to the new default + logs one informational "demo is now the default; -Demo flag is redundant" line.
- [ ] `install.ps1 -Empty` brings up the stack with no fetcher and no demo-gha — direct `POST /api/deployments` integrators get the bare-minimum stack.
- [ ] `install.ps1 -RealGha` without `$env:GHA_TOKEN` red-errors and exits 1 (mirrors today's `-Fetcher` precondition).
- [ ] New image `ghcr.io/kostiantyn-matsebora/deployment-dashboard-demo-gha:<tag>` published by CI on tag push; pinned via `${DASHBOARD_VERSION}` in `dashboard.env`; installer never downloads a separate bundle asset.
- [ ] Demo bundle exercises all four DAG-edge shapes — verified by ≥ 4 specific assertions against the read-API matrix after the first 30 s of demo runtime. *(deferred — see § 4)*
- [ ] Demo bundle covers 6 service × 5+ env slots; ≥ 5 of the canonical 6 box states from `local/index/ui-states.yaml` appear in the matrix within 60 s.
- [ ] WireMock scenario walk produces ≥ 3 new deployment events per minute over the first 5 minutes of runtime. *(resolved by § 3e amendment — sidecar `demo-driver`; issue #46)*
- [ ] `docs/cr/CR-0013-demo-mode-default-installer.md` exists with full design-of-record (this file).
- [ ] `docs/install.md` quick-start uses the demo-default install as the headline path.
- [ ] `docs/ci-cd-pipelines.md § 2` topology table gains a `demo-gha` component row + § 4 tag scheme covers the new image.
- [ ] No regression to PR #43's integration test suite (10/10 still green) — the `integration` profile is unchanged.
- [ ] `install.ps1 -Demo` deprecation note added to `docs/install.md` Migration footnote for one release cycle; drop after.
- [ ] `.agents/ginee/local/bindings.md` carries the four new governance rows + tree update + Stack-table CI/CD sentence (5th component image).

## 4. Known limitations (delivered but deferred)

**Trade-offs accepted at ship time.** The primary value of issue #44 — a populated 6 × 5 dashboard with diverse wire/box states, rendered topology edges, and zero external network on a no-flag `install.{ps1,sh}` — is delivered. The enhancement below was validated in Phase 5/6 as not-yet-met against its original AC wording and is deferred to a focused follow-up issue without blocking #44's ship. The item is checked off in the AC list above with a `(deferred — see § 4)` suffix; this section is the canonical record of what changed between authoring (commit `5b9628e`) and Phase 7 acceptance.

**Update (issue #46).** AC #9 (dynamic events) resolved by § 3e amendment — sidecar `demo-driver` replaces the empirically broken `--ReadStaticMappings` scenario walk. Sole remaining deferred row is AC #7 (deferred to #45 / `parent_deployments` DAG-edge coverage).

| AC ID | Original intent | Delivered state | Deferred to |
|---|---|---|---|
| #7 (all four DAG-edge shapes via `parent_deployments`) | Adapter's Pass 2a (intra-run `needs:` recovery + per-env predecessor synthesis) populates `parent_deployments` so the dashboard renders all four edge shapes from the demo bundle: empty / single per-env predecessor / single intra-run `needs:` / multiple-`needs:` + mixed. | All 65 events emitted by the demo bundle have `parent_deployments = []`. Status URLs are parsed correctly (DB rows carry the `/job/{id}` segment via the `run_url` field), but no needs-recovery HTTP calls reach `demo-gha` and no per-env predecessor is synthesised. Topology edges still render at runtime via the read-API's adjacency derivation, so the dashboard *looks* populated — but the underlying `parent_deployments` array is empty across the board. Root cause unidentified at ship time. | #45 |

The follow-up is tracked as a discrete issue (rather than re-opening #44) so it can be picked up against a clean acceptance surface — it does not block the demo-default UX inversion this CR introduces.

## References

- GitHub issue [#44](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/44) — the trigger.
- GitHub issue [#10](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/10) / PR [#43](https://github.com/kostiantyn-matsebora/deployment-dashboard/pull/43) — CR-0012's `mock-gha` substrate + placeholder demo bundle (this CR builds directly on top; branches off `issue-10-mock-gha-integration`).
- [CR-0009](./CR-0009-pull-mode-fetcher-and-progress-reporter.md) § 3a, § 3d — fetcher pull-mode + adapter endpoint inventory (the demo bundle covers the same five endpoints CR-0012 mapped).
- [CR-0010](./CR-0010-component-ci-pipeline.md) — component CI pipeline pattern (`_build-and-push-image.yml` reusable workflow + per-component caller); `demo-gha` becomes the 5th component using the same shape.
- [CR-0012](./CR-0012-integration-test-substrate.md) — integration test substrate (sibling design-of-record); demo-gha reuses the WireMock.Net image + mapping authoring conventions established there. CR-0012 § 3d co-located the bundle root for exactly this follow-up.
- [ADR-0004](../adr/ADR-0004-opaque-per-progress-reporter-cursor.md) — opaque-cursor contract; the dynamic-mock scenario walk respects it (monotonically increasing deployment ids across ticks).
- [ADR-0005](../adr/ADR-0005-release-install-migration-script.md) — release-install asset-download precedent, **explicitly NOT used here** (see Alternatives Considered).
- [ADR-0010](../adr/ADR-0010-release-install-merge-override.md) — release-install canonical compose; the `demo` profile layers on top via the same merge-override mechanic the `integration` profile uses.
- `dev_env/start.ps1 -Demo` — analogous existing behaviour in the contributor flow (mirrors PostHog-mode; the renaming parity on the release-install side may follow in a future CR).
- WireMock.Net scenarios: https://github.com/WireMock-Net/WireMock.Net/wiki/Stateful-Behaviour
- `install/docker-compose.release.yml:101-129` (fetcher service) + `:159-175` (mock-gha service) — env-var indirection seams the `demo` profile reuses.
- `local/index/ui-states.yaml` — canonical six-state inventory; demo bundle covers ≥ 5 of 6.
