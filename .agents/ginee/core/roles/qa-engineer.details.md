---
audience: qa-engineer
load: on-demand
triggers: [qa-details, tests, e2e, fixtures, smoke, harness]
cap-bytes: 12000
reads-before-applying: []
---

# QA Engineer — Domain Elaboration

Companion to `core/roles/qa-engineer.md`. The kernel file holds normative rules; this file holds elaboration, patterns, and stack-specific guidance.

## Functional / API test catalogue (FR & API-section driven)

Drive from architecture doc. Cover every endpoint × every documented status code (happy path · auth-failure · validation-failure · not-found · conflict). Every server-side derived view (computed columns · latest-per-key · joined snapshots) for documented null/empty/edge cases. Real-time stream — connects · receives a fresh event after write within documented latency · honours resume-token on reconnect. Health endpoint — returns success + underlying-store ping confirmed.

## E2E test catalogue (mockup driven)

Drive from mockup. Every documented behaviour: rendering of each UI state · hover · click → drawer · real-time update without reload · filters · empty state · stats / summary widgets.

## Zero-setup rule for test runners (functional · E2E · smoke)

Developer runs any test suite against local dev stack with no arguments. Every test-runner entry point at a predictable path. Runners accept (but never require) parameters for non-local targets only.

**Configuration declarative; runners thin.** Test endpoint URLs + local-dev API token in declarative config file, NEVER in script defaults / test source.

Standard layout:

```
testing/
├── config/local.json       # { readBaseUrl, writeBaseUrl, apiKey, ... } consumed by every runner
├── config/README.md        # how to add target (dev.json, prod-smoke.json)
├── fixtures/seed-data.json # canonical UI-state corpus
├── functional/run-tests.<ext>  # thin wrapper ≤ 40 lines
├── e2e/run-tests.<ext>         # thin wrapper ≤ 40 lines
├── e2e/{<runner config>,scenarios/,tests/}
├── smoke/run-smoke.<ext>
├── pester/run-pester.<ext>     # or equivalent
└── scripts/{seed,cleanup}.<ext>
```

**Runner rules:**

1. **Zero-arg local run.** No params → load `testing/config/local.json` + run. Stack unreachable → emit `"Local stack not reachable at <url> — run the local startup script first."` + exit non-zero.
2. **Non-local targets** pass `-Config <file>`. Runner does NOT accept loose `-BaseUrl` / `-ApiKey` (those are config). Acceptable runtime params are *behavioural* knobs: filter · fail-fast · headed/headless · project selector.
3. **Runners are thin** (≤ 40 lines). No baked defaults. Job: load config · preflight reachability · invoke underlying tool · propagate exit code.
4. **No imperative config.** Only literals allowed in a runner: path to default config file + tool-flag names. Never URLs / tokens / fixture data.
5. **Tool bootstrap idempotent + silent.** Browser-driver installs / tool restores run every invocation; no-op after first.
6. **Seeding separate from running.** Runners NEVER re-seed — that's the seed script's job (developer / CI invokes once before suite). Empty store + runner needs corpus → error with hint; never silently seed.
7. **Common runner params:** config-file selector · filter · fail-fast + layer-specific behavioural switches. Document each in help output.
8. **CI uses same runners** with `-Config testing/config/<env>.json`. No duplicated YAML test-execution.

New test layer → ship runner + matching `testing/config/local.json` extension. Runner = imperative shell; JSON config = declarative contract.

## Test data scripts

You own; place under project scripts directory (per `local/bindings.md`):

| Script | Purpose |
|---|---|
| `seed.<ext>` | POSTs prefilled events covering all UI states against `--baseUrl` + `--apiKey`. Idempotent — re-run yields same final state. |
| `cleanup.<ext>` | Deletes test rows by agreed marker (`actor = "qa.bot"` / reserved key prefix). Verifies empty afterwards. |
| `test-notify.<ext>` | Sends one realistic event → verifies success → verifies wire reflects it within documented latency budget. |
| `init-data.<ext>` | One-shot backfill of real baseline state from CSV/JSON. **NEVER** hardcodes domain values. |

All scripts: project's standard HTTP client · accept `--baseUrl` / `--apiKey` / `--dryRun` · structured logs.

**Zero-setup for local dev.** Every script's defaults match local stack from startup. Developer runs startup → immediately runs any script with no `-ApiKey` · no env-var export · no edit-file step. `-BaseUrl` defaults to local gateway URL; `-ApiKey` defaults to startup's fixed fake token. Defaults explicitly local-only — non-`localhost` `-BaseUrl` with default `-ApiKey` warns (not fails). Production hardening (real tokens · secret-vault refs · IP allow-lists) lives in cloud-targeted automation, not these scripts.

## Smoke tests

After every cloud deploy:

1. Health endpoint returns success.
2. Real-time endpoint — open · post tagged event · receive within latency budget · delete row.
3. Application root returns expected shell / response.
4. Persistence-layer schema matches migration (schema diff).

## Script-suite tests

QA scope = QA-owned scripts only (seed · cleanup · smoke · scenario-harness glue under `testing/scripts/`). Devops-owned scripts (build · orchestration · deploy · dev-loop · composite CI) → `devops-engineer.md § Script-quality obligation`. Split is by **file ownership**, not test framework — same Pester / bats tool, different authors per location.

Project's script-test framework (Pester / bats) for non-trivial QA scripting — seed-data idempotency · cleanup marker-scope guard · smoke polling/timeout · harness oracle helpers. Tests fast + hermetic; mock HTTP at the boundary.

## Non-functional checks worth automating

Drive from architecture-doc NFR table:

- **End-to-end live-update latency** — measure write → realtime arrival; alert on regression.
- **Retention** — verify prune job retains documented window (insert data older than retention + run prune).
- **Statelessness** — multi-replica E2E: 2 backend replicas behind LB · subscribe on A · write on B · assert delivery.

## Mockup-visual harness (when project has one)

You own harness (assertions · geometric oracles · runner scripts). You do NOT own the mockup — `frontend-engineer` does. Pattern per `core/protocols/cross-domain-bugs.md`: SA defines invariant in architecture doc → you encode as harness assertion (fails loudly when violated · passes only when holds) → `frontend-engineer` edits mockup CSS/JS/SVG until all-green → SA reviews coherence (no edits).

New mockup surface (view · layout primitive · invariant) → `frontend-engineer` flags in final report; you extend the harness. **You never edit the mockup** (not to make a test pass · demonstrate the bug · add a `data-testid` — request hooks in final report). **`frontend-engineer` never edits the harness** — if an assertion is wrong (encodes invariant incorrectly), they flag, you fix.
