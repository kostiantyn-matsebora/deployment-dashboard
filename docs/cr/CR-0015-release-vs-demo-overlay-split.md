---
title: "CR-0015: Release vs Demo Overlay Split"
parent: CRs
nav_order: 15
---

# CR-0015 — Release vs Demo Overlay Split + Integration Substrate Extraction

- **Status:** Proposed 2026-05-24
- **Trigger:** GitHub issue [#72](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/72) — *"Split `install/docker-compose.release.yml` into solution-app-services-only release + dedicated demo overlay; extract integration substrate from release."*

  `install/docker-compose.release.yml` today mixes three concerns under profile gates — solution application services (`api`, `dashboard`, `gateway`, `fetcher`, `db`), demo upstream (`demo-gha` + `demo-driver` behind `profiles: ["demo"]`), and integration mock (`mock-gha` behind `profiles: ["integration"]`). Downstream consumers — `install.ps1` / `install.sh`, `dev_env/start.ps1`, `.github/workflows/integration.yml`, `dev_env/docker-compose.local.yml` — each have to know which subset is "the solution," and every demo-only or test-only addition drifts the release file's contract surface. CR-0015 splits the three concerns into three files (release / demo / integration) so the release file becomes an auditable inventory of the production assumption, the demo bundle owns the demo overlay end-to-end, and the integration substrate co-locates with the contributor flow that consumes it.

- **Co-owned by:** `team-lead` (CR-0015 + cross-references to ADR-0010 / CR-0012 / CR-0013 / CR-0014) · `solution-architect` (ADR-0010 amendment + architectural-coherence review per D25) · `devops-engineer` (`install/docker-compose.release.yml` profile gating + new `install/docker-compose.demo.yml` ownership of demo service blocks + new `dev_env/docker-compose.integration.yml` extraction + `install/install.{ps1,sh}` flag surface + `dev_env/start.ps1` flag-parity rewire + `.github/workflows/integration.yml` overlay update + `docs/install.md` + `dev_env/README.md` updates) · `qa-engineer` (Pester + bats parity tests on the new flag surface + integration suite regression against the relocated `mock-gha` substrate + functional / e2e / mockup-visual suites on the four invocation paths).

- **Co-owned doc surface:**

  | Surface | Semantics owner | Operational examples / shape owner |
  |---|---|---|
  | This CR | `team-lead` | `solution-architect` (ADR-0010 amendment cross-reference) |
  | `install/docker-compose.release.yml` (db profile gating; `mock-gha` extraction) | `devops-engineer` | — |
  | `install/docker-compose.demo.yml` (demo-gha + demo-driver service blocks) | `devops-engineer` | — |
  | `dev_env/docker-compose.integration.yml` (new — `mock-gha` substrate) | `devops-engineer` | `qa-engineer` (substrate-content invariants per CR-0012 § 3a) |
  | `install/install.{ps1,sh}` (`-LocalDb` + `-RealGha` flag additions; precondition guard for `ConnectionStrings__DefaultConnection`) | `devops-engineer` | — |
  | `dev_env/start.ps1` (`-LocalDb` + `-RealGha` flag-parity additions) | `devops-engineer` | — |
  | `docs/install.md` (flag-matrix refresh) | `team-lead` | `devops-engineer` |
  | `dev_env/README.md` (overlay-presence activation pattern) | `devops-engineer` | — |
  | `testing/scripts/*.Tests.ps1` + `testing/scripts/*.bats` (flag-parity tests) | `qa-engineer` | — |

## Context

State post-prior-landings:

| Surface | Current shape | What CR-0015 changes |
|---|---|---|
| `install/install.ps1` | Full bring-up entrypoint (post-CR-0014 `_bringup-core.ps1` retirement noted in § Consequences) | Gains `-LocalDb` + `-RealGha` flags; gains pre-`docker compose up` precondition guard on `ConnectionStrings__DefaultConnection` when neither `-LocalDb` nor `-Demo` is set |
| `install/docker-compose.demo.yml` | Exists with env-only overrides for `db` / `api` / `fetcher` (per CR-0014 demo path) | Gains `demo-gha` + `demo-driver` service blocks relocated from `release.yml` |
| `install/docker-compose.release.yml` | Hosts `demo-gha` + `demo-driver` (behind `profiles: ["demo"]`) and `mock-gha` (behind `profiles: ["integration"]`); `db` service always activated (no profile gating today) | `demo-gha` + `demo-driver` move out to `demo.yml`; `mock-gha` moves out to `dev_env/docker-compose.integration.yml`; `db` gains `profiles: ["db"]`; release file becomes solution-app-services-only inventory |
| `dev_env/start.ps1` | Switch surface today: `-Demo` + `-Scaled` + `-Integration` | Gains `-LocalDb` + `-RealGha` for 1-for-1 parity with `install.ps1`; preserves `-Demo` + `-Scaled` + `-Integration` |
| `dev_env/docker-compose.integration.yml` | Does not exist | New file — hosts `mock-gha` extracted from `release.yml`; activated by overlay-presence (no profile gating) |

**Body-vs-state delta noted in #72 Phase 3 audit comment:** the issue body's claim that `install/install.ps1` is a 48-line wrapper around `_bringup-core.ps1` is stale — `_bringup-core.ps1` was retired earlier, and `install.ps1` is the full entrypoint today. CR-0015 does NOT reintroduce the helper layer; see § Out of scope.

## Decision

Four ASR resolutions land verbatim as user-confirmed picks (issue #72 Phase 1 / Phase 2 design review).

| ASR | Pick | Resolution |
|---|---|---|
| ASR-A — `db` activation mechanism | A1 — compose profile | `release.yml` `db` service gains `profiles: ["db"]`. `fetcher` retains its existing profile gating. Demo path activates the bundled `db` via `--profile db --profile fetcher`. |
| ASR-B — `mock-gha` placement | B2 — extract to `dev_env/` | New file `dev_env/docker-compose.integration.yml` hosts `mock-gha`. Release stack owns solution app services only; integration substrate lives under `dev_env/` alongside the contributor flow that consumes it. |
| ASR-C — `dev_env/start.ps1` flag surface | C1 — mirror installer 1-for-1 | `start.ps1` gains `-LocalDb` + `-RealGha`. Preserves `-Demo` + `-Scaled` + `-Integration`. |
| ASR-D — `ConnectionStrings__DefaultConnection` precondition | default — install-script responsibility | When neither `-LocalDb` nor `-Demo` is set, `install.ps1` / `install.sh` fail fast pre-`docker compose up` with a clear error if `ConnectionStrings__DefaultConnection` is unset. |

## Switch matrix — `install.ps1` / `install.sh`

Canonical reference for downstream reviewers.

| Flag (pwsh / bash) | Compose overlays chained | Profiles activated | Database source |
|---|---|---|---|
| default (no flag) | `install/docker-compose.release.yml` | (none) | external Postgres — `ConnectionStrings__DefaultConnection` required pre-`docker compose up` per ASR-D |
| `-LocalDb` / `--local-db` | `install/docker-compose.release.yml` | `db` | bundled `db` service |
| `-RealGha` / `--real-gha` | `install/docker-compose.release.yml` | `fetcher` | external Postgres (mirrors default DB source — operator combines with `-LocalDb` for bundled `db`) |
| `-Demo` / `--demo` | `install/docker-compose.release.yml` + `install/docker-compose.demo.yml` | `db` + `fetcher` | bundled `db` |

## Switch matrix — `dev_env/start.ps1`

Mirrors the installer matrix; contributor flows always append `dev_env/docker-compose.local.yml` (per ADR-0010) on non-`-Scaled` paths.

| Flag (pwsh) | Compose overlays chained | Profiles activated | Database source |
|---|---|---|---|
| default (no flag) | `install/docker-compose.release.yml` + `dev_env/docker-compose.local.yml` | (none) | external Postgres — `ConnectionStrings__DefaultConnection` required |
| `-LocalDb` | `install/docker-compose.release.yml` + `dev_env/docker-compose.local.yml` | `db` | bundled `db` service |
| `-RealGha` | `install/docker-compose.release.yml` + `dev_env/docker-compose.local.yml` | `fetcher` | external Postgres |
| `-Demo` | `install/docker-compose.release.yml` + `install/docker-compose.demo.yml` + `dev_env/docker-compose.local.yml` | `db` + `fetcher` | bundled `db` |
| `-Integration` | `install/docker-compose.release.yml` + `dev_env/docker-compose.local.yml` + `dev_env/docker-compose.integration.yml` | `db` + `fetcher` | bundled `db` (mock-gha substrate present; activation via overlay-presence, no profile flag) |
| `-Scaled` | `dev_env/docker-compose.scaled.yml` (standalone — unchanged per ADR-0010) | per scaled file | per scaled file |

## Consequences

### Supersession delta — ADR-0010

ADR-0010 amendment routed to `solution-architect` per D25. Specific § amendments:

| ADR-0010 section | Amendment |
|---|---|
| § Decision | Framing softened — "dev_env compose derives from release via `-f` merge" extends to a multi-file overlay stack (release + optional demo + optional integration + dev-local) instead of the two-file mental model. |
| § Mechanics | Adds row — compose-profile-gating of `db` (post-CR-0015) co-exists with overlay merge; profiles select services within a file, overlays select files within a stack. |
| § Consequences | Adds two rows — (a) `dev_env/start.ps1` mirrors the installer flag surface 1-for-1; (b) the overlay stack supports three or four files depending on flag combination. |
| § Supersession | Adds cross-ref to CR-0015 as the carrier of the multi-file extension. |

### Cross-ref — CR-0012 (`mock-gha` relocation)

CR-0012 § "Profile-gating contract" anchors `mock-gha` in `release.yml` behind `profiles: ["integration"]`. CR-0015 moves `mock-gha` to `dev_env/docker-compose.integration.yml` and switches activation from profile-gating to overlay-presence (the file's presence in the `-f` chain activates the substrate; no `--profile integration` flag remains). CRs accumulate rather than rewrite — CR-0015 carries the delta forward by cross-ref alone; CR-0012 is NOT amended.

### Cross-ref — CR-0013 (demo bundle topology untouched)

The CR-0013 demo bundle stays where it lives — `gateway/demo-gha/` Dockerfile, `gateway/demo-driver/` Dockerfile + `entrypoint.py`, qa-owned mappings + ticks under `testing/fixtures/gha/demo/`. CR-0015 relocates only the `demo-gha` + `demo-driver` *service block definitions* (from `release.yml` to `demo.yml`); the baked images, the bundle content, the scenario walk, the admin-API driving pattern all remain at their CR-0013 anchors. The `-Demo` back-compat alias from CR-0013 § 3a continues to route to the demo default.

### Cross-ref — CR-0014 (re-run safety + inline demo credentials preserved)

CR-0014 § 3c pins demo-mode credentials — `POSTGRES_PASSWORD = local-dev-password`, `API_TOKEN = demo-api-token`. CR-0015's `-Demo` path continues to write these literals on demo paths only; non-demo paths preserve random-per-install behaviour. The CR-0014 `_bringup-core.ps1` + `_bringup-core.sh` helpers were retired earlier (post-CR-0014; not formalised in any prior CR). CR-0015 formalises that retirement as a pre-condition of this work — `install.ps1` is the full entrypoint, not a 48-line wrapper.

### Positive consequences

- `install/docker-compose.release.yml` becomes a clean solution-app-service inventory matching the production assumption (api / dashboard / gateway / fetcher / db, all profile-gated where opt-in).
- External-Postgres path is first-class — operators pointing at Azure Postgres Flexible Server / RDS / on-prem Postgres no longer have to dodge a default-on `db` container.
- Integration substrate lives co-located with the contributor flow that uses it (`dev_env/`) instead of bleeding into the release file.
- `dev_env/start.ps1` parity with `install.ps1` removes a drift class — the two flag surfaces evolve together.
- ASR-D precondition catches a common misconfig fast — operators see a named-flag error before `docker compose up` runs, rather than a `28P01` from the API container minutes later.

### Negative consequences

- Two new compose overlays to maintain (`install/docker-compose.demo.yml` gains service blocks; `dev_env/docker-compose.integration.yml` is net-new). Mitigated by the single source-of-truth principle — each file owns one concern.
- Overlay-presence activation pattern (`mock-gha` activates when `dev_env/docker-compose.integration.yml` is in the `-f` chain; no `--profile integration` flag) needs documentation in `dev_env/README.md` so contributors do not look for a flag that no longer exists.
- ADR-0010 amendment makes the original two-file mental model history — readers see the three-file / four-file overlay shape going forward.

## Acceptance

The 11 acceptance criteria from issue #72 land verbatim, mapped to their enforcer.

| AC# | Criterion | Enforcer |
|---|---|---|
| AC #1 | `install/docker-compose.release.yml` contains only the solution's application services. `db` and `fetcher` are opt-in (not default-on); no `demo` or `integration` profiles remain. | `devops-engineer` (release.yml) + `solution-architect` (architectural-coherence review) |
| AC #2 | Default `install.ps1` (no flags) brings up application-only services and exits cleanly. Missing `ConnectionStrings__DefaultConnection` produces a clear error pre-`docker compose up`. | `devops-engineer` (`install.ps1` / `install.sh` precondition guard per ASR-D) |
| AC #3 | `install/docker-compose.demo.yml` brings up `demo-gha` + `demo-driver` + demo-mode env overrides on `fetcher`, and force-activates `db` + `fetcher` on top of the release file via `-f` merge. | `devops-engineer` (demo.yml service blocks + install-script profile activation) |
| AC #4 | `install.ps1` + `install.sh` `-Demo` switch invokes `docker compose -f release.yml -f demo.yml up`; no `--profile demo` activation remains. | `devops-engineer` (`install.ps1` / `install.sh`) |
| AC #5 | `install.ps1` + `install.sh` gain an `-LocalDb` (or equivalent) switch for "release + bundled Postgres, no demo". | `devops-engineer` (`install.ps1` / `install.sh` flag surface per ASR-A + ASR-C) |
| AC #6 | `dev_env/start.ps1 -Demo` composes release + demo + local layers; the demo experience is identical to today for contributors. | `devops-engineer` (`start.ps1` overlay chain) + `qa-engineer` (Pester parity test) |
| AC #7 | `dev_env/start.ps1` (default) and `dev_env/start.ps1 -Scaled` continue to work unchanged. | `qa-engineer` (regression coverage in `testing/scripts/start.Tests.ps1`) |
| AC #8 | `mock-gha` placement decided + documented (release `--profile integration` vs `dev_env/docker-compose.integration.yml` layer). | `devops-engineer` (new `dev_env/docker-compose.integration.yml` per ASR-B) + `team-lead` (CR-0015 documents the pick) |
| AC #9 | `dev_env/README.md`, `docs/install.md`, and ADR-0010 (or a successor CR) document the new layout + the production assumption that bundled `db` is convenience, not contract. | `devops-engineer` (`dev_env/README.md`) + `team-lead` (`docs/install.md` semantics) + `solution-architect` (ADR-0010 amendment) |
| AC #10 | Mockup-visual + functional + e2e + integration suites green on all four invocation paths (default, demo, contributor, contributor+demo). | `qa-engineer` (suite regression; change-scoped per `core/process.md § Phase 5`) |
| AC #11 | `docker compose port` for `demo-gha` and `demo-driver` returns nothing — NFR-04 unchanged. | `qa-engineer` (Pester `port-discipline.Tests.ps1` + integration-suite assertion) + `devops-engineer` (no `ports:` block on demo / driver services) |

## Out of scope

- Do NOT resurrect `install/_bringup-core.ps1` or `install/_bringup-core.sh`. The CR-0014 helpers were retired post-CR-0014 (pre this CR); CR-0015 preserves the retirement by construction.
- Do NOT introduce per-user UI preference persistence — orthogonal concern; `localStorage`-only per CR-0002 / CR-0005 / CR-0006.
- Do NOT relocate the CR-0013 demo bundle (`gateway/demo-gha/Dockerfile`, `gateway/demo-driver/Dockerfile` + `entrypoint.py`, qa-owned fixtures under `testing/fixtures/gha/demo/`). Only the service-block definitions move.
- Do NOT change the integration workflow gate. `.github/workflows/integration.yml` remains `if: false` per issue #66; only path-filters + on-failure logs step are touched as part of the `mock-gha` relocation.
- No new FR / NFR. CR-0015 is a coordination + structural-split record; no frozen requirement is amended. NFR-04 (internal-only) is preserved by construction — demo + integration services retain their no-host-ports posture per AC #11.

## References

- GitHub issue [#72](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/72) — the trigger.
- [ADR-0010](./../adr/ADR-0010-dev-env-compose-derives-from-release.md) — `dev_env/docker-compose.local.yml` is a compose-merge override layered on `install/docker-compose.release.yml`. CR-0015 amends ADR-0010 to extend the merge pattern to a multi-file overlay stack (release + optional demo + optional integration + dev-local).
- [CR-0012](./CR-0012-integration-test-substrate.md) — integration test substrate; `mock-gha` profile-gating contract carried forward by CR-0015 cross-ref (no CR-0012 amendment).
- [CR-0013](./CR-0013-demo-mode-default-installer.md) — demo-mode default in release-install entrypoint; demo bundle topology preserved by construction (only service-block definitions relocate).
- [CR-0014](./CR-0014-shared-bringup-logic-and-demo-credentials.md) — predefined demo-mode credentials; `-Demo` path continues to write fixed `POSTGRES_PASSWORD` + `API_TOKEN`.
- `install/docker-compose.release.yml` — release-install canonical compose; gains `db` profile gating + loses `demo-gha` / `demo-driver` / `mock-gha` service blocks.
- `install/docker-compose.demo.yml` — demo overlay; gains `demo-gha` + `demo-driver` service blocks (env-only overrides today per CR-0014).
- `dev_env/docker-compose.integration.yml` — new file; hosts the relocated `mock-gha` substrate.
- `dev_env/start.ps1` — flag-parity rewire per ASR-C.
