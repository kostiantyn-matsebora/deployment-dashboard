# Real-time SSE — Reconnection via Last-Event-ID

## Title + intent

Verify that the SPA's SSE client reconnects after a dropped connection, sends a `Last-Event-ID` header matching the last received event, and that events POSTed while the connection was down are replayed to the client on reconnect — all within the documented NFR-03 constraint.

## Citations

- `docs/architecture.md` §5 NFR-03 (live updates ≤5 s after ingest)
- `docs/architecture.md` §5 NFR-05 (stateless backend; SSE clients reconnect via `Last-Event-ID`)
- `docs/features.md` § Real-time updates ("SSE clients reconnect via `Last-Event-ID`; backend is stateless per replica")
- `docs/architecture.md` §7 SSE wire contract (`GET /api/stream`, per-slot delta payloads)
- `testing/e2e/scenarios/realtime-sse-update.md` (companion — tests the forward POST-to-DOM path)

## Preconditions

- Stack running at `DASHBOARD_READ_BASE_URL` / `DASHBOARD_WRITE_BASE_URL`.
- Canonical seed corpus loaded (standard pre-suite step).
- The SPA bootstraps an `EventSource` (or `fetch`-based SSE stream) at `/api/stream` on page load.
- The SSE implementation includes the `Last-Event-ID` header on reconnect as required by the EventSource protocol (RFC-compatible behaviour).

## Steps

### Part 1 — `Last-Event-ID` header sent on reconnect

1. **Given** the browser navigates to `/` and the matrix is visible.
2. **Given** a `page.route()` intercept is installed on `/api/stream` to capture SSE requests.
3. **When** the SPA's SSE connection has established and received at least one event (a data event carrying an `id:` field).
4. **When** the SSE connection is aborted via route intercept (`route.abort('connectionreset')`).
5. **Then** on the SPA's next reconnect attempt to `/api/stream`, the outgoing request carries a `Last-Event-ID` header whose value is non-empty.
6. **Then** the `Last-Event-ID` value matches the last event id received before the abort.

### Part 2 — catchup delivery after reconnect

1. **Given** a fresh (service, environment) pair unique to this run.
2. **Given** the SPA is loaded and the matrix is visible.
3. **Given** the SSE connection is dropped via route abort.
4. **When** a deployment event is POSTed to `POST /api/deployments` while the SSE connection is down.
5. **When** the route intercept is released so the SPA can reconnect.
6. **Then** the SPA displays the new stage box within 5 s of the POST (NFR-03 budget measured from POST time, not from reconnect time).

## Expected results

- The reconnect request carries `Last-Event-ID: <last-event-id>` (non-empty; matches the last received id).
- The POST returns 201.
- The new slot appears in the matrix within the NFR-03 5 s budget.
- No full page navigation occurs.

## Out of scope

- Testing SSE backpressure or burst delivery.
- Asserting the exact replay window (server-side retention is ≥90 days per NFR-07, not under test here).
- WebSocket or polling fallbacks (the project uses SSE only per `docs/features.md` § Real-time updates).
- Latency measurement for the reconnect phase itself (only the POST-to-DOM leg is budgeted by NFR-03).

## Coverage footer

- NFR-03: live updates ≤5 s after ingest
- NFR-05: stateless backend; SSE reconnects via `Last-Event-ID`
- `docs/features.md` § Real-time updates → reconnection row
- NFR-QA-01: feature-coverage completeness gate
