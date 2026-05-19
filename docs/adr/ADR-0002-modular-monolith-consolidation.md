# ADR-0002 — Modular monolith — single API container hosting two library surfaces

- **Status:** **superseded by [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) (2026-05-19).** ADR-0006 reframes the architectural claim — the system is a **microservices architecture** with **container co-location** of the Write + Read API services, not a "modular monolith." The decision recorded below (co-locate Write + Read in one container image; preserve the future-split affordance via a host-project + gateway-config-only change) **survives unchanged** as the mechanics-of-record; only the framing around it was misleading. Body preserved as historical record so older PRs / commits / cross-refs continue to resolve. New documents should cite ADR-0006 for the architectural framing and ADR-0002 for the co-location mechanics and future-split trigger conditions.

- **Status (historical):** accepted
- **Context:** `TODO` line 8 — "There is no need for now to have separate containers for read and write API… we can split them later if needed, for instance if read API will require more resources than write API, etc. For now we can just have one component with two separate APIs, and we can scale it as a whole, but in the future we can split it into two separate containers if needed. Write API still must require api key.".

  The original SAD shipped the Write API and the Read API as two separate container apps (two Dockerfiles, two ACA container apps, separate scaling envelopes). At MVP scale this duplicates per-app overhead — duplicate database connection pools, duplicate `LISTEN` subscriptions, duplicate ACA fixed-cost tail — for zero functional benefit. The two surfaces share the same `DbContext`, the same EF migrations, the same NOTIFY/LISTEN abstractions; the only architectural reason to keep them in separate processes today is the abstract option to scale them independently. Today, that option is not exercised.

  Constraints:
  - **NFR-02 (≤ $30/month)** — one ACA container app is cheaper than two on the Consumption plan; collapsing the two halves reduces per-app fixed overhead and stays comfortably inside the cap.
  - **NFR-05 (stateless backend)** — co-location must not introduce sticky-session or in-memory-fan-out shortcuts. Each instance still subscribes to PostgreSQL `LISTEN deployments` independently.
  - **§8 Security (FR-10 — write-only auth)** — the API-key boundary MUST persist after consolidation. Read endpoints remain unauthenticated; only `POST /api/deployments` (and `PATCH /api/config/topology`, added by CR-0003) require `X-Api-Key`.
  - **Future split option must remain cheap.** The day a real traffic-shape signal (asymmetric resource needs, divergent release cadence, tightened security boundary, inverted cost-cap) justifies a split, the split must be a host-project + gateway-config change — not a code rewrite.

- **Decision:** Ship **one ASP.NET Core host project** (`backend/api/`) that composes **two library projects** — one per API surface — plus a shared library for cross-cutting concerns.

  ```
  backend/
  ├── api/          # Host project (ASP.NET Core executable) — Program.cs, single Dockerfile,
  │                 # composition root. References write-api/ and read-api/ libraries and
  │                 # maps each library's endpoint group + middleware onto the single host.
  ├── write-api/    # Library project — endpoint group for POST /api/deployments,
  │                 # request DTOs, NOTIFY dispatch. API-key middleware is applied here
  │                 # (scoped to the write surface only — see §"Security Considerations").
  ├── read-api/     # Library project — endpoint groups for matrix / history / discovery /
  │                 # SSE / health / topology config. Unauthenticated. No write paths.
  ├── shared/       # Class library — EF Core DbContext, entities, migrations,
  │                 # NOTIFY/LISTEN abstractions, ApiKeyMiddleware implementation, DTOs.
  └── Dashboard.sln # References api/, write-api/, read-api/, shared/, plus unit tests.
  ```

  Rules:

  | Rule | Enforcement |
  |---|---|
  | Only `api/` references the two surface libraries. `write-api/` and `read-api/` do not reference each other. | Solution-level `ProjectReference` graph; reviewed in PR. |
  | Both surface libraries depend on `shared/`. `shared/` depends on neither. | Same. |
  | Each surface library exposes a single `IEndpointRouteBuilder` extension (e.g. `MapWriteEndpoints`, `MapReadEndpoints`) — the host wires them up. | Public surface enforced by being the only `public` extension method on each library. |
  | API-key middleware is applied **only** to the write endpoint group; the read group is unauthenticated. | `MapGroup("/api").RequireApiKey()` on the write group; no such call on the read group. |
  | One Dockerfile, one image, one ACA container app. | `backend/api/Dockerfile` is the only API Dockerfile. |
  | EF Core entities, `DbContext`, and migrations live in `shared/` — one migration set serves both surfaces. | Existing rule, unchanged. |

  **Auth boundary after consolidation:** the API-key middleware (`ApiKeyMiddleware`, in `shared/`) is applied **only** to the Write endpoint group (`POST /api/deployments`, `PATCH /api/config/topology`). The Read endpoint group (`GET /api/*`, `GET /api/stream`, `GET /health`) is unauthenticated by design (FR-10 — write-only auth — and the read-side auth-delegation decision). The host composition wires this up via `MapGroup("/api").RequireApiKey()` on the write group only — there is no global `UseMiddleware<ApiKeyMiddleware>()` call. Future agents adding endpoints must place each new endpoint in the right group; a write-side endpoint accidentally added to the read group would skip authentication.

- **Consequences:**
  - **NFR-02 — one ACA container app instead of two.** Per-app fixed overhead is halved on the Consumption plan; the cost table (gateway + dashboard + api = 3 apps, 1 environment) replaces the original 4-app layout and the total compute estimate moves from "~$3–7" to "~$2–5".
  - **One OS process → one PostgreSQL connection pool, one `LISTEN deployments` subscription** per instance. Eliminates the duplicate-pool / duplicate-LISTEN tax of the two-container shape.
  - **NFR-05 preserved.** The host is still stateless; SSE fan-out still goes through PostgreSQL NOTIFY/LISTEN; no sticky sessions; reconnects use `Last-Event-ID`.
  - **§8 (Security) auth boundary preserved.** API-key middleware is **scoped** rather than removed — co-location does NOT change the auth surface. The middleware is applied to the write endpoint group only; the read endpoint group remains unauthenticated by design.
  - **Future split is host-project + gateway-config only** — no library code touched. Mechanics:
    1. Add `backend/write-api-host/Program.cs` (calls `MapWriteEndpoints`) and `backend/read-api-host/Program.cs` (calls `MapReadEndpoints`).
    2. Two new Dockerfiles under each host directory.
    3. Gateway `nginx.conf` re-introduces a second upstream (e.g. `write_api`) and the path+method routing matrix points the `POST /api/deployments` row to it.
    4. Two ACA container apps in place of one; everything else is unchanged.

    Triggers that justify the split:

    | Trigger | Why it justifies a split |
    |---|---|
    | Asymmetric resource needs | Sustained CPU/memory profile differs between surfaces (e.g. SSE fan-out under read load saturating the container before write traffic does). Splitting allows independent scaling. |
    | Independent release cadence | One surface requires more frequent restarts / canary windows than the other and the coupling is paying a cost. |
    | Tightened security boundary | An external requirement to run the write surface on a separately-credentialed network segment (e.g. only ingest from the CI/CD VNet; read endpoints in a different subnet). |
    | Cost-cap pressure inverted | If ACA pricing changes and two small apps become cheaper than one larger one. (Today the opposite holds — see §6 of the SAD.) |

  - **Gateway routing matrix kept path+method-discriminated** even though both surfaces resolve to a single `api` upstream today. The matrix continues to discriminate on path + method so that a future re-split is a gateway-config-only change — the row for `POST /api/deployments` simply points at the new write upstream while every other row stays the same.
  - **One Docker image to build, push, and scan.** Halves the CI surface for the backend tier.
  - **Component-level boundaries persist.** The C4 component diagram (Ingest API / Read API / Real-time Hub / Deployment Store) is unchanged by this consolidation — only the host packaging differs. The diagram remains valid.

- **References:**
  - SAD §6 Constraints (NFR-02 budget framing for one-vs-two backend container apps).
  - SAD §7 "Target Architecture" framing — single backend container app composing two library surfaces.
  - SAD §7 "Backend module architecture — single host, two library surfaces".
  - SAD §7 "Future split — trigger conditions".
  - SAD §7 App Gateway (path+method routing matrix; preserved split-seam at the gateway).
  - SAD §7 Infrastructure → Local Development (one API Dockerfile, one ACA container app).
  - SAD §8 Security Considerations (API-key middleware scoped to write endpoint group only).
  - **§10 Decision 11** — original text reproduced verbatim below.

## Decision 11 — verbatim (moved out of the initial SAD into this ADR)

> | 11 | Should the Write API and Read API ship as one container or two? | **One container, two library surfaces — split deferred.** The two API surfaces (`POST /api/deployments` and the read endpoints) ship inside a single ASP.NET Core host project (`backend/api/`) that composes two separate library projects (`backend/write-api/`, `backend/read-api/`) per §7 "Backend module architecture". Rationale: (a) the two surfaces share the same `DbContext`, `LISTEN/NOTIFY` plumbing, and EF migrations — running them as one OS process avoids duplicate database connection pools and duplicate `LISTEN` subscriptions for zero functional benefit at MVP scale; (b) one ACA container app is cheaper than two on the Consumption plan and keeps NFR-02 comfortable; (c) the library boundary preserves the option to split: re-splitting becomes a host-project + gateway-config change, no library code touched (mechanics in §7 "Backend module architecture" → "Future split"). Trigger conditions for splitting are listed there. API-key middleware is scoped to the write endpoint group only (§8) — co-location does not change the auth boundary. |
