# Doc-authoring examples — paired bad / good (D22)

**Load-on-demand.** Fetched when:

- Role is authoring a doc class for the first time and unfamiliar with the default shape.
- User explicitly requests examples (`@<role> show doc-style examples`).
- `solution-architect` references during Review activity to point out a regression.

Default tasks do not load this file. The shape rules + mandatory checks (always-loaded in `core/process.md § Documentation style`) are sufficient once internalized.

Six paired examples cover the most common adopter doc classes: **component inventory · design properties · ADR rationale · runbook procedure · API endpoint table · scenario doc**.

---

## 1. Component inventory

**Bad** — prose paragraph:

> The system is a microservices architecture with container co-location of the Write + Read API services. Four container images: deployment-dashboard-api, deployment-dashboard-fetcher (optional pull-mode worker), deployment-dashboard-frontend (Angular SPA on nginx), and deployment-dashboard-gateway (nginx routing + SSE pass-through, the only host-published service).

**Good** — table:

| Image | Tier | Role | Host-published |
|---|---|---|---|
| `deployment-dashboard-api` | service | Write + Read API (co-located per ADR-0002) | no |
| `deployment-dashboard-fetcher` | worker | Optional pull-mode adapter | no |
| `deployment-dashboard-frontend` | client | Angular SPA on nginx | no |
| `deployment-dashboard-gateway` | edge | nginx routing + SSE pass-through | **yes** |

Framing decision in ADR-0006; co-location mechanics in ADR-0002.

---

## 2. Design properties (README intro)

**Bad** — paragraph stating 3 design rules:

> The system is read-only / notification-only: it tracks deployments, it does not trigger them. Tool-agnostic by design — the backend never talks to a CI/CD tool directly; integrators POST to `/api/deployments` from a pipeline step. An optional Dashboard.Fetcher worker can translate pull → push for tools without notify steps.

**Good** — bullets:

- **Read-only / notification-only** — tracks deployments; never triggers them.
- **Tool-agnostic** — backend never talks to CI/CD directly. Integrators POST `/api/deployments` from a pipeline step.
- **Pull→push adapter** — optional `Dashboard.Fetcher` worker for tools without notify steps.

---

## 3. ADR rationale

**Bad** — comma-joined drivers:

> We chose Postgres over MySQL because we need rich JSONB support for the events table, we already operate Postgres in production for the auth service, and the team is more familiar with Postgres tooling, plus the cost difference is negligible at our scale.

**Good** — driver-comparison table:

| Driver | Postgres | MySQL |
|---|---|---|
| JSONB ergonomics | native, indexable | bolt-on |
| Existing ops experience | auth service already on PG | new operational surface |
| Team familiarity | high | low |
| Cost at our scale | negligible delta | negligible delta |

**Decision:** Postgres. Drivers 1–3 dominate; driver 4 is neutral.

---

## 4. Runbook procedure

**Bad** — comma-chained steps:

> If the deployment fails, first check the logs in CloudWatch, then look at the recent deploys in the dashboard, then if you see a pattern of timeouts you should roll back via the deploy CLI, otherwise file an incident in PagerDuty.

**Good** — numbered steps + explicit decision:

1. Read failing-deploy logs — `awslogs get /ecs/<service> --start='-15m'`.
2. Open the deploys dashboard — `<dashboard-url>`.
3. **Decision.**
   - Timeout pattern (≥ 3 of last 5 deploys) → roll back: `deploy rollback <service> <prev-rev>`.
   - Other → file PagerDuty incident with the log link.

---

## 5. API endpoint table

**Bad** — endpoint described in prose:

> The `/api/deployments` endpoint accepts POST with a JSON body containing service, environment, version, status (succeeded/failed), and an optional commit SHA, returning 202 on accept or 422 on validation failure.

**Good** — endpoint contract table:

| Method + Path | `POST /api/deployments` |
|---|---|
| Request | `{ service, environment, version, status, commitSha? }` |
| Response 202 | `{ id, receivedAt }` |
| Response 422 | `{ field, error }[]` |
| Auth | bearer (`X-Integrator-Token`) |

---

## 6. Scenario doc

**Bad** — long conditional sentence:

> When the user clicks the deploy button, if they are authenticated and have the deploy role and the target environment is not locked, then the system should create a new deployment, log the event, and update the dashboard in real time; otherwise it should show an error.

**Good** — Given/When/Then bullets + explicit negatives:

- **Given** authenticated user with `role:deploy`.
- **And** target environment is not locked.
- **When** user clicks `Deploy`.
- **Then** new deployment created.
- **And** event logged to audit-trail.
- **And** dashboard updates within 500 ms (NFR-04).

Negative paths:

- Missing role → 403, no deployment created.
- Locked environment → 409, no deployment created.
