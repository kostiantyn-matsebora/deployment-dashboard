---
title: "CR-0014: Shared Bring-Up Logic and Predefined Demo-Mode Credentials"
parent: CRs
nav_order: 14
---

# CR-0014 — Shared bring-up logic across `install.{ps1,sh}` + `dev_env/start.ps1` + predefined demo-mode credentials

- **Status:** Proposed 2026-05-23
- **Trigger:** GitHub issue [#60](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/60) — *"Share install + start bring-up logic; predefined demo-mode credentials."*

  Today the bring-up steps live in three places at once — `install/install.ps1`, `install/install.sh`, `dev_env/start.ps1` — and drift has already shipped (e.g. `--force-recreate` from issue #53 landed in `install.ps1` only). Demo mode is meant to be zero-config and re-runnable, but a random `POSTGRES_PASSWORD` per install collides with the persisted `pg-data` volume on re-run, the API container 28P01s on connect, and the operator's only recovery is `uninstall.{ps1,sh} --volumes`. The volume-detection guard in `install.ps1 § 4a` blocks the fresh install but does not remove the friction. CR-0014 refactors the bring-up concerns into colocated helpers and pins demo-mode credentials to fixed literals so demo re-runs are idempotent against an existing pg volume.

- **Co-owned by:** `team-lead` (CR-0014 + cross-references) · `solution-architect` (architectural-coherence review per D25 + helper-contract design-of-record S1–S10) · `devops-engineer` (helper extraction + `install.ps1` / `install.sh` / `start.ps1` rewire + `docs/install.md` update + `uninstall.{ps1,sh}` restore + `dev_env/stop.ps1` reach) · `qa-engineer` (Pester + bats parity tests + pwsh/bash drift detection + uninstall coverage restoration).

- **Co-owned doc surface:**

  | Surface | Semantics owner | Operational examples / shape owner |
  |---|---|---|
  | This CR | `team-lead` | `solution-architect` (helper-contract S1–S10) |
  | `docs/install.md` (flag matrix; demo creds advertised with "do not use for production" caveat) | `team-lead` | `devops-engineer` |
  | `install/_bringup-core.ps1` + `install/_bringup-core.sh` (new helpers) | `devops-engineer` | — |
  | `testing/scripts/*.Tests.ps1` + `testing/scripts/*.bats` (parity tests) | `qa-engineer` | — |

- **Change.** Two co-introduced concerns matching issue #60 § A (shared bring-up logic) and § B (predefined demo credentials).

  - **3a — Shared bring-up logic via colocated helpers.** `install.ps1`, `install.sh`, and `dev_env/start.ps1` invoke a six-function helper contract sourced from sibling files at `install/_bringup-core.ps1` (pwsh) and `install/_bringup-core.sh` (bash). The `_` prefix marks both files as private to the install surface; both colocated under `install/` so the helper + entrypoint live in the same directory.

    The chosen option (per S3 + user answer #3) is **Option C from issue #60 § A** — `start.ps1` becomes a thin alias around `install.ps1 -BuildLocally`; build-vs-pull divergence is carried entirely by docker compose `-f` merge-override per ADR-0010, not by the helper. `install.sh` stays as a full bash sibling (per user answer #2) sourcing `_bringup-core.sh`.

    | Flag verb | pwsh | bash | Semantics |
    |---|---|---|---|
    | Build locally | `-BuildLocally` | `--build-locally` | `start.ps1` passes this to `install.ps1`; helpers treat it as no-op (image source is divergence-only at compose layer) |

    **Composition shape.**

    | Caller | How it reaches the helper | Build-vs-pull divergence |
    |---|---|---|
    | `install.ps1` (release-install entrypoint) | Dot-sources `_bringup-core.ps1` directly | None — uses `install/docker-compose.release.yml` |
    | `install.sh` (bash sibling) | `source install/_bringup-core.sh` | None — uses `install/docker-compose.release.yml` |
    | `dev_env/start.ps1` (contributor flow) | `& pwsh -NoProfile -File install/install.ps1 -BuildLocally <args>` — subprocess, NOT dot-source (per S3) | Carried by `dev_env/docker-compose.local.yml` overlay per ADR-0010 |

    `start.ps1` retains its start-specific argument-translation layer (`-Demo`, `-Fetcher`, `-AllowMissingGhaToken`, `-Integration`, `-Scaled`) which it maps onto `install.ps1`'s flag surface before subprocess invocation. `start.sh` is NOT introduced — issue #60 scope is share-existing, not add-new-surface (per S10).

    **PostHog seed branch deletion** (SA-pinned 2026-05-23): `dev_env/start.ps1` line 47 onwards seeds `$env:GHA_REPOSITORIES = "PostHog/posthog"` as a pre-CR-0013 stopgap for non-empty demo data. With CR-0013's `demo-gha` deterministic-fixture image, the PostHog branch has no remaining use case — it is deleted outright (not preserved as a separate flag). Contributors who want to point the fetcher at a live GitHub repo use `-RealGha` + `-GhaRepositories`; the demo path is now exclusively `demo-gha`-backed.

  - **3b — Six-function helper contract + one guard helper.** The pwsh + bash helpers expose 1:1 mirrored signatures. Bash sibling shape is identical-by-construction; QA enforces drift via the parity-test design owned in O-2.

    | # | Concern | pwsh | bash | Inputs | Output |
    |---|---|---|---|---|---|
    | 1 | Env-file generation | `Write-DashboardEnvFile` | `write_dashboard_env_file` | `$EnvFilePath`, `$Version`, `$Port`, `$ApiToken`, `$PgPassword`, `$DemoLines[]?` | writes file |
    | 2 | Secret handling | `Resolve-DashboardSecrets` | `resolve_dashboard_secrets` | `$EnvFilePath`, `$ModeDemo`, `$ResetDemoDefaults` | hashtable / paired stdout |
    | 3 | Demo-mode env-var seeding | `Resolve-DemoEnvDefaults` | `resolve_demo_env_defaults` | `$EnvFilePath`, `$ResetDemoDefaults` | env-line array (4 keys) |
    | 4 | Profile + compose-args resolution | `Resolve-ComposeArgs` | `resolve_compose_args` | `$ModeDemo`, `$ModeRealGha`, `$ModeEmpty`, `$BuildLocally`, `$ComposeFile`, `$EnvFile`, `$OverlayFile?` | string array of `-f` / `--profile` / `--env-file` tokens |
    | 5 | Health-poll | `Wait-DashboardHealth` | `wait_dashboard_health` | `$HealthUrl`, `$TimeoutSeconds`, `$ComposeArgs[]` | exit 0 / 1 + log dump |
    | 6 | URL panel | `Write-DashboardUrlPanel` | `write_dashboard_url_panel` | `$Port`, `$ApiToken`, `$EnvFile`, `$ModeDemo`, `$ModeRealGha`, `$ModeEmpty` | stdout |
    | 7 | Volume-detection guard | `Test-PgVolumeConflict` | `test_pg_volume_conflict` | (pg volume name) | exit 1 / 0 with relaxed demo-mode logic |

    **Invocation order in `install.ps1`** (per S8): the volume-detection guard `Test-PgVolumeConflict` is called once from `install.ps1 § 4a`; the demo path skips the guard (fixed credentials make collision impossible).

    **`-BuildLocally` semantics** (per S5): the flag is a no-op at the helper boundary. Build-vs-pull divergence is carried entirely by docker compose `-f` overlay per ADR-0010. The helper does not branch on `$BuildLocally`; the caller passes an appropriate compose-file pair into `Resolve-ComposeArgs` and the merge does the work.

    **Env-block inheritance contract** (per O-6 resolution — Option α, SA-pinned 2026-05-23): `Resolve-DemoEnvDefaults` and `Write-DashboardEnvFile` take NO `-EnvVars` / `-Env` pass-through parameter. The `start.ps1` → `install.ps1` subprocess hop (`& pwsh -NoProfile -File install.ps1 -BuildLocally <args>`) inherits the parent process's env block by OS-default on Windows + Linux + macOS — `start.ps1`'s `$env:GHA_REPOSITORIES` / `$env:FETCHER_POLL_INTERVAL_SECONDS` / `$env:GHA_API_BASE_URL` / `$env:GHA_TOKEN` mutations are visible to the child pwsh and to any helper invoked from it. Explicit pass-through is redundant; YAGNI until a second caller emerges with a distinct env-block requirement.

  - **3c — Predefined demo-mode credentials.** The demo path writes fixed `POSTGRES_PASSWORD` and `API_TOKEN` literals to `dashboard.env`, replacing today's random-per-install generation on demo paths only. Non-demo paths (`-RealGha` / `--real-gha`, `-Empty` / `--empty`) preserve random-per-install behaviour exactly as today (per S7 + issue #60 § B).

    | Variable | Demo path value | Non-demo path |
    |---|---|---|
    | `POSTGRES_PASSWORD` | `local-dev-password` (reused literal — same as `dev_env/docker-compose.local.yml` ADR-0010 dev-literal) | random hex per install |
    | `API_TOKEN` | `demo-api-token` (new literal — separate from `dev_env`'s `local-dev-token-not-for-production` to keep release-install demo branding distinct) | random hex per install |

    **Re-run safety.** With fixed `POSTGRES_PASSWORD`, re-running `install.ps1` (no flags — demo default per CR-0013) against an existing `pg-data` volume succeeds without volume drop or 28P01 from the API container. The pg cluster initialised on first install accepts the same credentials on subsequent installs.

    **Volume-detection guard relaxation** (per S8): `Test-PgVolumeConflict` retains its current red-error behaviour for non-demo paths (where credential drift would brick the cluster) and is bypassed on the demo path (where fixed credentials make collision impossible). One helper, two callsite outcomes.

    **`-ResetDemoDefaults` flag — demo-mode credential-drift escape hatch** (per O-4 SA pin 2026-05-23): a separate guard, located in `install.ps1 § 4a` (NOT in `_bringup-core.ps1` — core stays mode-agnostic), detects a specific drift class that emerges when a demo-mode install runs against a pg volume initialised under different credentials.

    | Concern | Spec |
    |---|---|
    | Check location | `install.ps1 § 4a` (mode-aware caller layer; `_bringup-core.ps1` does not know about modes) |
    | Trigger | All three conditions hold: (a) demo-mode re-run · (b) persisted `dashboard.env` `POSTGRES_PASSWORD` ≠ `local-dev-password` (i.e. carried over from a pre-CR-0014 random-per-install era, or from a prior `-RealGha` install) · (c) pg-volume `deployment-dashboard_postgres-data` exists |
    | Default action (no flag) | Hard-fail with an explicit message naming three remediation paths: rerun with `-ResetDemoDefaults`; rerun `uninstall --remove-data` then re-bringup; manually edit `dashboard.env` to set `POSTGRES_PASSWORD=local-dev-password` (which only works if the operator knows the prior credentials matched the volume) |
    | `-ResetDemoDefaults` action | Force-overwrite `dashboard.env` with demo literals (`POSTGRES_PASSWORD=local-dev-password`, `API_TOKEN=demo-api-token`) AND emit a yellow warning that the operator MUST run `uninstall --remove-data` before the next bringup to drop the incompatible pg volume — otherwise the API container will still 28P01 on connect |
    | Why not silent overwrite | 28P01 surface is opaque to first-time contributors; an explicit guard + named flag is the documented escape hatch |
    | Why not auto-drop the volume | Destructive behaviour behind a flag named `-ResetDemoDefaults` violates least-surprise; data-drop stays gated behind `uninstall --remove-data` |

  - **3d — Compose-level deviation preserved.** ADR-0010 stipulates that `dev_env/docker-compose.local.yml` is a compose-merge override layered on `install/docker-compose.release.yml`. CR-0014 does not amend ADR-0010 — the contributor flow continues to merge the override file via the second `-f` flag in `Resolve-ComposeArgs`. The helper does not know or care which compose-file pair it received; it concatenates the tokens and hands them to docker compose.

  - **3e — In-process migrations untouched.** ADR-0009 (API self-migrates on start; installer does not actuate migrations) is preserved by construction — neither the helpers nor the entrypoint rewrites touch the migration actuation path. No `migrations:` service exists in either compose file before or after CR-0014.

  - **3f — CR-0013 demo contract preserved.** The CR-0013 demo-mode default (no-flag → demo stack with baked `demo-gha`, 20+ populated slots within 60 s of `/health` 200) is preserved by construction. CR-0014 changes only the *credential generation step* of the demo path; the bundle content, the compose profile, the `demo-gha` image, and the dynamic-mock walk are all untouched. The `-Demo` back-compat alias from CR-0013 § 3a continues to route to the demo default.

- **Consequences.**

  **Positive.**
  - Single source of truth for the six bring-up concerns (env-file generation, secret handling, demo-mode env-var seeding, profile + compose-args resolution, health-poll, URL panel). Future installer-side improvements propagate to the contributor flow automatically.
  - Drift class identified in issue #60 (`--force-recreate` from issue #53 landing in `install.ps1` only) is structurally eliminated — there is no second place for the flag to land.
  - Demo re-runs are idempotent against an existing `pg-data` volume — fixed `POSTGRES_PASSWORD` + `API_TOKEN` make the credential-drift class disappear. Operator no longer needs `uninstall.{ps1,sh} --volumes` between demo re-runs.
  - Volume-detection guard simplifies — the demo path skips it (collision impossible by construction); non-demo paths retain the existing red-error.
  - Helper-contract surface (6 + 1 guard) is small and well-bounded; pwsh + bash drift is detectable via the QA parity test (O-2).

  **Negative.**
  - Two new sibling files (`install/_bringup-core.ps1` + `install/_bringup-core.sh`) — additional code surface. Mitigated by colocation under `install/` + `_` prefix marking them as private.
  - pwsh-to-bash drift risk on the six-function contract — both must stay 1:1. Mitigated by the QA parity test design in O-2; absent test coverage, the bash sibling would be the second drift class.
  - Demo credentials are now publicly documented literals — `POSTGRES_PASSWORD = local-dev-password`, `API_TOKEN = demo-api-token`. Mitigated by NFR-04 (internal-only — no public ingress); `docs/install.md` carries an explicit "do not use for production" caveat per issue #60 § B.
  - `start.ps1` subprocess invocation of `install.ps1` introduces one pwsh boot per `start.ps1` run (vs today's dot-source). Mitigated by single-shot invocation — `start.ps1` calls `install.ps1` once and exits; no nested loops. Subprocess (rather than dot-source) chosen per S3 to keep `start.ps1` argument-translation scope isolated from `install.ps1`'s state.

- **Alternatives Considered.**

  Issue #60 § A surfaced three design options. The chosen option (C) is locked here as design-of-record.

  | Alternative | Rejected because |
  |---|---|
  | **(A) PowerShell-only** — drop `install.sh`; both flows in `*.ps1` (already the project default per `#Requires -Version 7.0`). | Linux/macOS adopters without pwsh installed lose the no-prerequisite install path. User answer #2 locks `install.sh` as a full bash sibling. |
  | **(B) Shared PowerShell helper module sourced by both `install.ps1` and `start.ps1`; `install.sh` shrinks to a `pwsh` wrapper or stays as-is.** | Pwsh-wrapper variant degrades to Alternative (A) for bash adopters; "stays as-is" variant retains the duplication this CR is structured to remove. No coverage gain over (C). |
  | **(C) `start.ps1` becomes a thin wrapper around `install.ps1 -BuildLocally` — single core; build-vs-pull toggled by flag.** | **PICKED.** Matches user answer #3 (build-vs-pull carried by docker compose `-f` overlay per ADR-0010, not by branched helper logic). Six-function helper contract (S4) lives at `install/_bringup-core.{ps1,sh}`; `start.ps1` is the alias surface; `install.sh` is the bash sibling. Image source is the only legitimate divergence (issue #60 AC #2). |

- **No new FR / NFR.** This CR refactors implementation surface + pins demo-credential generation; it does not amend any frozen requirement. NFR-04 (internal-only) is preserved by construction — demo credentials are reachable only inside the docker network and on the host running the install. CR-0013's demo-mode default + acceptance floor (≥ 20 slots in 60 s) is preserved per § 3f.

- **No new ADR.** Refactor lands as CR-0014 only. ADR-0010 (compose-merge override mechanic) and ADR-0009 (in-process migrations) are cited as the existing decisions this CR respects without amendment. Per S6 — refactor surface stays at CR-level.

- **No SAD edit.** `docs/architecture.md` is unchanged by this CR — no new ASR row, no FR/NFR amendment, no §10 decision row, no §7 component table change. Readers follow the chain `architecture.md → CR-0014` only when bring-up-helper concerns arise; SAD frozen surface is untouched.

## Acceptance criteria

Mirrors issue #60's AC verbatim — devops owns 1, 2, 3, 4, 6, 8; qa owns 7; team-lead owns this CR's AC. Numbering follows issue order.

- [ ] AC #1 — Each duplicated concern from issue #60 § A lives in one source location (the six-function helper contract under `install/_bringup-core.{ps1,sh}`), not three.
- [ ] AC #2 — Image source is the only legitimate divergence between install and start flows; carried by docker compose `-f` overlay per ADR-0010, not by helper-internal branching.
- [ ] AC #3 — Demo path writes fixed `POSTGRES_PASSWORD = local-dev-password` + fixed `API_TOKEN = demo-api-token`; re-running with the same `-InstallDir` against an existing pg volume succeeds without volume drop or 28P01 from the API container.
- [ ] AC #4 — `-RealGha` / `--real-gha` and `-Empty` / `--empty` paths preserve today's random-per-install secret generation; only the demo path uses fixed credentials.
- [ ] AC #5 — CR-0013 demo-mode contract preserved — no behavioural regression on the demo path (≥ 20 populated slots within 60 s of `/health` 200, four DAG-edge shapes, ≥ 5 of 6 canonical box states; demo bundle + image + dynamic-mock walk untouched).
- [ ] AC #6 — Volume-detection guard (`Test-PgVolumeConflict` / `test_pg_volume_conflict`) updated so it does not red-error on demo-mode re-install; non-demo paths retain today's behaviour.
- [ ] AC #7 — All bring-up + teardown scripts retain unit-test coverage at parity. Scripts in scope: `install/install.ps1` + `install/install.sh` + `dev_env/start.ps1` + `dev_env/stop.ps1` + `install/uninstall.ps1` + `install/uninstall.sh`. Pester + bats coverage matches today's framework; `uninstall.{ps1,sh}` restored to green (broken in current main per issue #60 § Motivation; scope from O-4 QA discovery).
- [ ] AC #8 — All flows pass smoke tests on supported platforms (Windows pwsh, Linux bash, macOS bash).

## Open issues — traced to Phase 4 work

Surfaced by `solution-architect` during Phase 2 step 1 design-of-record + Phase 2 step 2 QA discovery; cited here so Phase 4 dispatch can resolve each against the CR.

All Phase 3 open issues (OI-1 / OI-2 / OI-4) pinned by SA roundtrip 2026-05-23 and folded into the CR body above. O-6 (env-block inheritance contract) resolved Option α — no `-EnvVars` parameter. Remaining open items are Phase 4 work-tracking only.

| # | Subject | Status | Phase 4 owner |
|---|---|---|---|
| O-1 | CR-0014 authoring (this document) | Delivered Phase 2 step 1 | `team-lead` (delivered) |
| O-2 | QA parity-test design — pwsh ↔ bash six-function contract drift detection | Open — Phase 4 work | `qa-engineer` |
| O-3 | `docs/install.md` user-doc update — flag matrix + demo credentials + "do not use for production" caveat | Open — Phase 4 work (advisory; SA-flagged for confirm-on-Phase-4-dispatch) | `devops-engineer` |
| O-4 | `uninstall.{ps1,sh}` restore-to-green — six concrete defects from Phase 2 step 2 QA discovery (see § O-4 defect inventory) | Open — Phase 4 work | `devops-engineer` |
| O-5 | `dev_env/stop.ps1` reach into helper — URL-panel reuse on teardown banner? | Open — Phase 4 work | `devops-engineer` (SA flag — confirm scope on Phase 4 dispatch) |
| O-6 | Contract gap — `start.ps1` `$env:*` mutations vs. `install.ps1` subprocess invocation | **Resolved 2026-05-23** — Option α (OS-level env-block inheritance); no `-EnvVars` parameter on helpers. See § 3b "Env-block inheritance contract" | — (closed) |

### O-4 defect inventory — Phase 2 step 2 QA discovery

Six concrete defects identified by `qa-engineer` against `install/uninstall.{ps1,sh}` + tests. `D-5` verified NOT a defect — demo profile IS included in uninstall compose-args; logged for completeness.

| ID | Severity | Surface | Defect |
|---|---|---|---|
| D-1 | High | `install/uninstall.ps1` | `$InstallDir` default `./dashboard-release` ≠ `install.ps1`'s `$HOME/.dashboard-release` — uninstall from the canonical install path does nothing (SA-flagged seed in issue #60 § Motivation) |
| D-2 | High | `install/uninstall.sh` | `INSTALL_DIR` default same drift class as D-1 (bash side) |
| D-3 | Medium | `install/install.ps1:266` | Error message references `-Volumes` flag that doesn't exist; real flag is `-RemoveData`. **In-scope for CR-0014** (SA pin 2026-05-23 — SA typo'd "CR-0013" in roundtrip; correction landed here). Fix: replace `-Volumes` with `-RemoveData` in the error hint string |
| D-4 | Medium | `install/install.sh:251` | Same stale `--volumes` hint as D-3 (bash side); real flag is `--remove-data`. **In-scope for CR-0014** (SA pin 2026-05-23). Fix: replace `--volumes` with `--remove-data` in the error hint string |
| D-6 | Low | `testing/scripts/uninstall.Tests.ps1` | Oracle gap — doesn't assert demo + integration profiles |
| D-7 | Medium | Discoverability (D-3 / D-4 surface) | Actual flag undiscoverable from error hint emitted on common failure mode — operator sees `-Volumes` / `--volumes`, runs `--help`, finds no such flag |

All six land in Phase 4 under `devops-engineer` ownership (D-1 / D-2 / D-3 / D-4 / D-7) + `qa-engineer` ownership (D-6 + uninstall test restoration to green per AC #7).

## References

- GitHub issue [#60](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/60) — the trigger.
- GitHub issue [#53](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/53) — `--force-recreate` drift example cited in issue #60 § Motivation; the drift class CR-0014 structurally eliminates.
- [CR-0013](./CR-0013-demo-mode-default-installer.md) — demo-mode default in release-install entrypoint; CR-0014 preserves CR-0013's demo contract by construction (only credential generation changes; bundle + image + scenario walk untouched). § 3f covers the invariance.
- [ADR-0009](./../adr/ADR-0009-startup-applied-ef-migrations.md) — API self-migrates on start; installer does not actuate migrations. Untouched by CR-0014 per § 3e.
- [ADR-0010](./../adr/ADR-0010-dev-env-compose-derives-from-release.md) — `dev_env/docker-compose.local.yml` is a compose-merge override layered on `install/docker-compose.release.yml`. CR-0014's build-vs-pull divergence is carried entirely by this mechanic per § 3a + § 3d.
- `install/install.ps1` § 4a (volume-detection guard) — callsite for `Test-PgVolumeConflict`.
- `dev_env/docker-compose.local.yml` (`local-dev-password` literal) — source of the reused `POSTGRES_PASSWORD` value per S7.
