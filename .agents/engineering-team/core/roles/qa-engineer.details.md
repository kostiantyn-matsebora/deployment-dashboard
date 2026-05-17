# QA Engineer — Domain Elaboration

Companion to `core/roles/qa-engineer.md`. The kernel file holds normative rules; this file holds elaboration, patterns, and stack-specific guidance.

## Functional / API test catalogue (FR & API-section driven)

Drive from the architecture doc:

- Every endpoint × every documented status code. Examples:
  - happy path
  - auth-failure
  - validation-failure
  - not-found
  - conflict
- Every server-side derived view (computed columns, latest-per-key, joined snapshots) covered for the documented null/empty/edge cases.
- Real-time stream:
  - Connects.
  - Receives a fresh event after the write within the documented latency budget.
  - Honours resume-token semantics on reconnect.
- Health endpoint check:
  - Returns success.
  - The underlying-store ping is confirmed.

## E2E test catalogue (mockup driven)

Drive from the mockup. Every documented behaviour. Examples:

- rendering of each UI state
- hover effects
- click → drawer
- real-time update without reload
- filters
- empty state
- stats / summary widgets

## Zero-setup rule for test runners (functional, E2E, smoke)

Same principle as the data scripts:

- A developer must run any test suite against the local dev stack with no arguments.
- Every test-runner entry point lives at a predictable path.
- Runners accept (but do not require) parameters only for non-local targets.

**Configuration is declarative, runners are thin.**

- Test endpoint URLs and the local-dev API token live in a declarative config file.
- NOT in script defaults or test source.

Standard layout:

```
testing/
├── config/
│   ├── local.json        # default config consumed by every runner — { readBaseUrl, writeBaseUrl, apiKey, ... }
│   └── README.md         # how to add a new target (e.g. dev.json, prod-smoke.json)
├── fixtures/
│   └── seed-data.json    # canonical UI-state corpus
├── functional/
│   ├── run-tests.<ext>   # thin wrapper — ≤ 40 lines
│   └── ...
├── e2e/
│   ├── run-tests.<ext>   # thin wrapper — ≤ 40 lines
│   ├── <runner config>
│   ├── scenarios/
│   └── tests/
├── smoke/
│   └── run-smoke.<ext>
├── pester/               # or equivalent script-test directory
│   └── run-pester.<ext>
└── scripts/
    ├── seed.<ext>
    ├── cleanup.<ext>
    └── ...
```

Runner-script rules:

1. **Zero-arg local run.**
   - Running the runner with no parameters loads `testing/config/local.json` and runs the suite.
   - Assumes the local-dev startup ran.
   - If the stack isn't reachable:
     - Emit `"Local stack not reachable at <url> — run the local startup script first."`.
     - Exit non-zero.
2. **Non-local targets pass `-Config <file>`** (or the equivalent flag in the project's scripting language) pointing to another declarative file.
   - Runner does NOT accept loose `-BaseUrl` / `-ApiKey` overrides — those are configuration and belong in the config file.
   - Only acceptable runtime parameters are *behavioural* knobs. Examples:
     - filter
     - fail-fast
     - headed/headless
     - project selector
3. **Runners are thin.**
   - ≤ 40 lines each.
   - No bake-in defaults.
   - Entire job:
     - Load config.
     - Preflight reachability check.
     - Invoke underlying tool.
     - Propagate exit code.
4. **No imperative configuration anywhere.**
   - Test specs, fixtures, and config never live as literals inside runner scripts.
   - Only string literals allowed in a runner are:
     - the path to the default config file
     - tool-flag names
   - Never URLs, tokens, or fixture data.
5. **Tool bootstrap is idempotent and silent.**
   - Browser-driver installs / tool restores run on every invocation.
   - No-ops after first run.
6. **Seeding is separate from running.**
   - Runners do NOT re-seed the database — that's the seed script's job, which developer (or CI) invokes once before the suite.
   - If a runner needs the corpus and the data store is empty:
     - It errors with a hint.
     - It does not silently seed.
7. **Common runner parameters:**
   - config-file selector
   - filter
   - fail-fast
   - plus layer-specific behavioural switches
   - Document each in the runner's help output.
8. **CI uses the same runners** with the appropriate `-Config testing/config/<env>.json` — no duplicated YAML test-execution logic.

When adding a new test layer, ship a runner + a matching `testing/config/local.json` extension alongside.

- The runner is the imperative shell.
- The JSON config is the declarative contract.

## Test data scripts

You own these scripts; place them under the project's scripts directory (per `local/bindings.md`):

- `seed.<ext>` — POSTs prefilled events covering all documented UI states against a target `--baseUrl` with `--apiKey`.
  - Idempotent (re-running yields the same final state).
- `cleanup.<ext>` — deletes test rows by an agreed marker (e.g. `actor = "qa.bot"` or a reserved key prefix).
  - Verifies the data store returns empty for those entries afterwards.
- `test-notify.<ext>` (or equivalent):
  1. Sends one realistic event.
  2. Verifies success.
  3. Verifies the wire reflects it within the documented latency budget.
- `init-data.<ext>` — one-shot, used to backfill real baseline state.
  - Reads input from a CSV/JSON file.
  - **Never** hardcodes domain values.

All scripts:

- Use the project's standard HTTP client.
- Accept arguments:
  - `--baseUrl`
  - `--apiKey`
  - `--dryRun`
- Write structured logs.

**Zero-setup rule for local dev:**

- Every script's defaults must match the local stack produced by the startup script.
- A developer can run startup then immediately run any script with:
  - No `-ApiKey` argument.
  - No env-var export.
  - No edit-this-file step.

Defaults:

- `-BaseUrl` defaults to the local gateway URL.
- `-ApiKey` defaults to the same fixed fake token the startup script bakes in.
- Defaults are explicitly for the local dev stack only.
  - When pointed at cloud or any non-local target, the user must pass a real `-ApiKey`.
  - Script should warn (not fail) when default is used against a non-`localhost` `-BaseUrl`.

Production hardening (real tokens, secret-vault references, IP allow-lists) lives in cloud-targeted automation, not these local scripts.

## Smoke tests

Run after every cloud deploy:

1. Health endpoint returns success.
2. Real-time endpoint check:
   1. Open the real-time endpoint.
   2. Post a tagged test event.
   3. Receive it on the stream within the documented latency budget.
   4. Then delete the row.
3. Application root returns the expected shell / response.
4. The persistence-layer schema matches the migration (run a schema diff).

## Script-suite tests

Use the project's script test framework (Pester / Bats / shellcheck / etc.) for any non-trivial scripting logic — examples:

- Diff calculation in the notification client.
- Composite-action input mapping.
- Webhook receiver translation.

Rules:

- Keep tests fast and hermetic.
- Mock HTTP at the boundary.

## Non-functional checks worth automating

Drive from the architecture-doc NFR table. Common patterns:

- **End-to-end live-update latency.**
  - Measure write → realtime arrival time.
  - Alert on regressions.
- **Retention.**
  - Verify the prune job retains the documented window.
  - Test by inserting data older than retention and running the prune job.
- **Statelessness** — multi-replica E2E:
  1. Run two backend replicas behind a load balancer.
  2. Open a realtime subscription on replica A.
  3. Write on replica B.
  4. Assert delivery.

## Mockup-visual harness (when the project has one)

Ownership:

- You own the harness — assertions, geometric oracles, runner scripts.
- You do NOT own the mockup itself.
  - `frontend-engineer` does.

Collaboration pattern: see `core/cross-domain-bugs.md`. Your role in the cycle:

- `solution-architect` defines an invariant in the architecture doc.
- **You encode it as a harness assertion** under the project's mockup-visual directory.
  - Your assertion is the executable form of the invariant.
  - Must fail loudly when violated.
  - Must pass only when it holds.
- `frontend-engineer` edits the mockup's CSS/JS/SVG until your assertions go all-green.
- `solution-architect` reviews for architecture coherence (governance, no edits).

Rules:

- When `frontend-engineer` adds a new mockup surface (new view, layout primitive, invariant), extend the harness with the new assertion.
  - They flag the need in their final report.
  - You implement.
- **You do not edit the mockup.**
  - Not for any of these reasons:
    - to "make a test pass"
    - to "demonstrate the bug"
    - to add a `data-testid`
  - Request hooks from `frontend-engineer` in your final report.
- **`frontend-engineer` does not edit the harness.**
  - If a harness assertion is genuinely wrong (encodes the invariant incorrectly):
    - They flag it.
    - You fix the harness.
