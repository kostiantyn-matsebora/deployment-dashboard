# Tests for the `notify` composite action

**Owner:** `qa-engineer` (per CLAUDE.md routing table - "Pester tests
for any non-trivial PowerShell or composite-action logic").

This directory is intentionally left as a placeholder by the devops
agent. The composite action at
[`../action.yml`](../action.yml) commits to the **stable input contract
and deterministic exit-code surface** described below so the Pester
suite can attach to a fixed interface.

Implements WBS MVP §1.4.3 / "CI/CD Integration" §1.4 of
[`docs/deployment-dashboard-architecture.md`](../../../../docs/deployment-dashboard-architecture.md).

## What this action commits to

### Input contract

The action declares these inputs (see `action.yml`):

- `dashboard_url`, `api_token`, `service`, `environment`, `version`,
  `status` - required.
- `run_url`, `run_number`, `actor` - optional, defaulted from the
  `github.*` context.
- `fail_on_error` - optional, defaults to `"true"`.

### Validation rules

1. Each required input is rejected with `::error::` + exit 1 when
   empty or whitespace.
2. `status` must be one of `success`, `failure`, `in-progress`. Any
   other value fails with `::error::` + exit 1.
3. `run_number` must parse as a 32-bit integer. Non-integer fails with
   `::error::` + exit 1.

### Outgoing HTTP

1. Method: `POST`. URL: `<dashboard_url with trailing slash stripped>/api/deployments`.
2. Headers (case-insensitive):
   - `X-Api-Key: <api_token>`
   - `Content-Type: application/json`
   - `User-Agent: deployment-dashboard-notify/1.0 (+github-actions)`
3. Body: a single JSON object with **exactly** these keys, in this
   order, matching SAD §7 "API Contract" + "CI/CD Notify Step":
   `service`, `environment`, `version`, `status`, `run_url`,
   `run_number`, `actor`.
4. `run_number` is serialised as a JSON number, not a string.

### Response handling

| Response                | `fail_on_error=true`               | `fail_on_error=false`                  |
|-------------------------|------------------------------------|----------------------------------------|
| 2xx                     | Step succeeds                      | Step succeeds                          |
| non-2xx                 | Step fails (`::error::`, exit 1)   | Step succeeds, emits `::warning::`     |
| Transport error/timeout | Step fails (`::error::`, exit 1)   | Step succeeds, emits `::warning::`     |

### Outputs

- `status_code` is set to the HTTP status string on any HTTP response
  (including non-2xx); empty string on transport error.

### Masking

- The action calls `::add-mask::` with the value of `api_token` before
  any logging that could expose it. The Pester suite should verify
  that the literal token never appears in step output.

## Suggested Pester coverage

The QA agent should land tests in this folder (e.g.
`notify.Tests.ps1`) covering:

1. **Input validation matrix** - one test per required input being
   empty; assert non-zero exit and `::error::` marker.
2. **Status enum** - parameterised over `success`, `failure`,
   `in-progress` (pass) and bogus values like `ok`, `running`, `""`
   (fail).
3. **`run_number` parsing** - integer strings pass; non-integer
   strings fail with `::error::`.
4. **Payload shape** - capture the body sent to a local HTTP listener;
   assert the seven keys are present, no extra keys, `run_number` is a
   JSON number, and field values round-trip the inputs.
5. **Headers** - assert `X-Api-Key`, `Content-Type`,
   `User-Agent: deployment-dashboard-notify/1.0` are sent.
6. **HTTP error handling** - listener returns 401, 422, 500; assert
   non-zero exit with `fail_on_error=true`; assert zero exit with
   `fail_on_error=false` and a `::warning::` marker on stdout.
7. **Transport error** - point at a closed port; assert the same
   matrix of behaviour.
8. **URL normalisation** - `dashboard_url` with and without trailing
   slash both resolve to a single `/api/deployments` path (no
   `//api/deployments`).
9. **Token masking** - run with a known token; assert the token value
   does not appear in captured stdout, and that `::add-mask::<token>`
   was emitted.
10. **Idempotency note** - send the same payload twice; assert both
    calls succeed (the dashboard side handles append-only - this is a
    contract reminder, not a server assertion).

## How to invoke the action under test from Pester

The script body inside `action.yml` runs under `pwsh`. The Pester
tests can either:

- Extract the inline `pwsh` block into a wrapper script and invoke it
  with the documented env vars (`DD_URL`, `DD_TOKEN`, `DD_SERVICE`,
  ...), then assert on stdout, exit code, and the captured HTTP
  request, or
- Drive the composite action via `act` or a real GitHub Actions
  matrix run and parse the resulting log.

The first option is simpler and is the recommended baseline.

## Out of scope for this folder

- Integration tests that hit a real ingest API live in
  `testing/functional/` (qa-engineer).
- Smoke tests that run post-deploy live in `testing/` smoke suite
  (qa-engineer).
- The composite action itself - if a test requires a behaviour change,
  the qa-engineer must open a PR against `action.yml` co-signed by
  the devops-engineer (the input contract is a wire contract).
