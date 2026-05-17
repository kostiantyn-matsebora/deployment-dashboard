# Environment and service lists are discovered from API, not hardcoded

**Intent:** prove that `/api/environments` and `/api/services` are derived
from stored data, and that the SPA's environment headers reflect that
discovery rather than a fixed list. A previously-unknown service or
environment seeded through `POST /api/deployments` must show up in those
endpoints and in the matrix header.

## Citations

- `docs/architecture.md` §4 FR-09 ("the system shall
  support any set of services and environments without hardcoded values;
  the service and environment lists shall be derived from stored data").
- `docs/architecture.md` §7 "API Contract" -
  `GET /api/environments`, `GET /api/services`.
- `backend/read-api/Dashboard.ReadApi/Endpoints/DiscoveryEndpoints.cs` -
  the `Distinct().OrderBy()` query backing both endpoints.
- `frontend/matrix/src/lib/matrix-header.component.ts` - renders one
  `data-testid="env-header-<env-id>"` per environment from the store's
  signal.

## Preconditions

- Stack up, fixtures seeded.
- The seeded corpus already contains environments
  `{ dev, qa, uat }` and services
  `{ service-a, service-b, service-c, service-d }`.

## Steps

1. **Given** the SPA is loaded against `http://localhost:8080`,
2. **When** the test issues `GET /api/environments`,
3. **Then** the JSON response is a JSON array of strings containing
   (at minimum) every distinct `environment` from the seeded corpus
   (`dev`, `qa`, `uat`),
4. **When** the test issues `GET /api/services`,
5. **Then** the JSON response is a JSON array containing (at minimum)
   every distinct `service` from the seeded corpus
   (`service-a`, `service-b`, `service-c`, `service-d`),
6. **And** the rendered matrix header contains a
   `[data-testid="env-header-<env-id>"]` element for each of the
   environments in step 3 (case-insensitive match against the discovered
   environment id).
7. **When** the test POSTs a deployment for a brand-new
   `(service, environment)` pair — `qa-bot-discovery` /
   `e2e-discovery-env` — at `http://localhost:8081/api/deployments`,
8. **And** waits up to 5 seconds for the SSE-driven re-render,
9. **Then** `GET /api/environments` now contains `e2e-discovery-env`,
10. **And** `GET /api/services` now contains `qa-bot-discovery`,
11. **And** the matrix header now contains
    `[data-testid="env-header-e2e-discovery-env"]`.

## Expected results

- The endpoints return arrays derived from `SELECT DISTINCT ... FROM
  deployments` (cf. `DiscoveryEndpoints.cs`), not from a hardcoded enum.
- A fresh environment / service appears in the discovery endpoints and
  the SPA header after a single POST.
- No code change, configuration toggle, or restart is required to add a
  new environment.

## Out of scope

- Display order of environments - the discovery endpoint orders
  alphabetically; the SPA may apply its own ordering (mockup uses a
  promotion-flow order: dev -> qa -> qahotfix -> uat -> prod). Either is
  acceptable as long as the new environment is rendered.
- `/api/services` consumption in the SPA - the SPA does not currently
  render a service list separately; presence in the endpoint is enough.

## Coverage

- FR-09: services and environments discovered from stored data.
- SAD §7 API Contract: `/api/environments`, `/api/services`.
