# POSTed event reaches the open dashboard within 5 seconds with no reload

**Intent:** the dashboard receives a freshly ingested event over the
`/api/stream` SSE channel and updates the matrix without a page reload,
end-to-end, within the NFR-03 5-second budget.

## Citations

- `docs/deployment-dashboard-architecture.md` §4 FR-08 ("all connected
  browser clients shall receive live updates...no page reload required").
- `docs/deployment-dashboard-architecture.md` §5 NFR-03 ("live updates...
  within 5 seconds of a successful ingest event").
- `docs/deployment-dashboard-architecture.md` §7 "Real-time path" -
  `LISTEN/NOTIFY` -> SSE pipeline.
- `frontend/shared/src/lib/sse.service.ts` - browser-native `EventSource`
  client.
- `backend/read-api/Dashboard.ReadApi/Endpoints/StreamEndpoint.cs` - SSE
  endpoint, frame format from
  `backend/shared/Dashboard.Shared/Realtime/SseWriter.cs`.

## Preconditions

- Stack up, fixtures seeded.
- Write API at `http://localhost:8081` accepts `POST /api/deployments`
  with header `X-Api-Key: local-dev-token-not-for-production`.
- The Read API SPA opens an `EventSource` connection on load.
- A previously-unused (service, environment) tuple to avoid polluting any
  other scenario's assertions. The test suffixes both the service id and
  the environment id with a fresh `runSuffix()` (e.g.
  `service = qa-bot-realtime-<run-suffix>`,
  `environment = e2e-live-<run-suffix>`) so each invocation inserts a
  brand-new slot and the test stays idempotent without a cleanup pass.
  These names are intentionally outside the seeded corpus, so other
  scenarios remain stable.

## Steps

1. **Given** the SPA is loaded against `http://localhost:8080` and the
   pipeline matrix is rendered,
2. **And** there is no stage box for
   `qa-bot-realtime-<run-suffix> / e2e-live-<run-suffix>` initially
   (this slot has never been ingested - the suffix guarantees freshness
   on every re-run),
3. **When** the test POSTs the following event to
   `http://localhost:8081/api/deployments` with the local-dev API key:
   ```json
   {
     "service":     "qa-bot-realtime-<run-suffix>",
     "environment": "e2e-live-<run-suffix>",
     "version":     "v0.0.<run-suffix>",
     "status":      "in-progress",
     "run_url":     "https://example.com/runs/e2e-live",
     "run_number":  90001,
     "actor":       "qa.bot"
   }
   ```
   (The `<run-suffix>` is a fresh millisecond+random token so re-runs of
   this scenario insert distinct rows AND a distinct (service,
   environment) slot, so the "slot must not exist before the POST"
   precondition holds without manual cleanup.)
4. **Then** within 5 seconds the SPA renders a stage box with
   `data-testid="stage-box-qa-bot-realtime-<run-suffix>-e2e-live-<run-suffix>"`
   and the test measures wall-clock latency from POST to box visible,
5. **And** the box's
   `current-version-qa-bot-realtime-<run-suffix>-e2e-live-<run-suffix>`
   text matches the posted version,
6. **And** the page was never navigated / reloaded during the test
   (Playwright tracks no extra `framenavigated` events on the main frame).

## Expected results

- Stage box for the new slot appears within `< 5000 ms` of the POST.
- Box shows the exact version, status (`in-progress`), and actor from the
  ingest payload.
- No `framenavigated` event on the main frame after the initial load.

## Out of scope

- `Last-Event-ID` reconnect semantics - functional test covers this.
- Multi-replica fan-out (NFR-05) - separate scenario, not MVP-required.

## Coverage

- FR-08: live updates without page reload.
- NFR-03: 5-second end-to-end latency budget.
