# Writes without a valid X-Api-Key are rejected and produce no SSE event

**Intent:** an unauthenticated `POST /api/deployments` returns HTTP 401,
no row lands in the database, and the open SSE channel emits no slot-update
event for the rejected attempt.

## Citations

- `docs/architecture.md` §4 FR-10 ("the ingest API
  shall authenticate every write request with an API key; requests with
  a missing or invalid key shall be rejected with HTTP 401").
- `docs/architecture.md` §7 "REST constraints
  observed" - `401 on missing/invalid API key`.
- `backend/shared/Dashboard.Shared/Security/ApiKeyMiddleware.cs` -
  validates `X-Api-Key`, returns 401 with JSON body
  `{"error":"..."}`.
- `backend/write-api/Dashboard.WriteApi/Program.cs` - NOTIFY is only
  invoked after a successful insert, so a 401 must produce no NOTIFY,
  no SSE event.

## Preconditions

- Stack up, fixtures seeded.
- The SPA has an open `EventSource` to `/api/stream` (default behaviour
  on load).
- The unique service identifier `qa-bot-401-reject` is unused elsewhere
  so that a side-channel sighting of it in the matrix is unambiguous
  evidence of a successful write (which should never happen here).

## Steps

1. **Given** the SPA is loaded and the SSE connection is open,
2. **When** the test POSTs a valid-shaped deployment payload to
   `http://localhost:8081/api/deployments` with NO `X-Api-Key` header at
   all (using `request.fetch` from Playwright's API context to bypass
   the SPA's own client),
3. **Then** the HTTP response status is `401`,
4. **And** the response body is JSON `{"error": "Missing X-Api-Key header."}`
   per `ApiKeyMiddleware`.
5. **When** the test POSTs the same payload with `X-Api-Key:
   obviously-wrong`,
6. **Then** the HTTP response status is `401`,
7. **And** the response body is JSON `{"error": "Invalid API key."}`.
8. **And** after waiting 3 seconds (well within NFR-03's 5 s budget) the
   stage box `[data-testid="stage-box-qa-bot-401-reject-e2e-rejected"]`
   is NOT present in the matrix DOM (no fan-out happened),
9. **And** `GET /api/deployments/qa-bot-401-reject/e2e-rejected/history`
   returns `404` (no row was persisted).

## Expected results

- Both unauthorised POSTs return 401 with the documented JSON error body.
- No SSE event is emitted for the rejected attempts.
- No new row appears in the `deployments` table.

## Out of scope

- Validation errors (422) - covered by the functional API suite.
- Successful writes - covered by `realtime-sse-update.md`.

## Coverage

- FR-10: missing/invalid API key returns 401.
- SAD §7 REST constraints: `401 on missing/invalid API key`.
