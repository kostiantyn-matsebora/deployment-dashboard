---
title: "ADR-0001: Topology Derivation Five-Pass"
parent: ADRs
nav_order: 1
---

# ADR-0001 — Per-service topology derivation — five-pass algorithm on the read side

- **Status:** accepted
- **Context:** The tree-shaped per-service topology requirement (FR-13) added two new payload fields — `deployment_id` (required, CI/CD-side identifier) and `parent_deployments` (optional list of explicit parent references inside the same service). The matrix wire shape now carries a sibling `topology.edges` array per service. The architecture must answer:
  - **Where is topology computed — write-side or read-side?**
  - **What is the algorithm — purely explicit, purely correlated, or a merge?**
  - **What happens to out-of-order references (parent not yet ingested)?**
  - **What happens to cycles?**
  - **What attribute drives the correlation fallback, and where is that choice expressed?**

  Constraints:
  - **NFR-05 (stateless backend)** — every instance must compute topology independently from the same database; no shared state.
  - **Historical Decision 7 (three-tier correlation-attribute precedence)** — the attribute that drives the fallback varies per request (server default vs. ops-managed per-service override vs. per-user query parameter). The algorithm must read it at request time, not bake it into stored rows.
  - **Historical Decision 8 (SSE topology semantics)** — SSE carries slot updates only; topology is fetched via a follow-up `GET /api/deployments?correlationAttribute=…`. The derivation runs on every matrix read.
  - **Historical Decision 9 (dangling references accepted at ingest)** — references to not-yet-ingested deployments must contribute no edge in the current read but must reconcile automatically on the next read after the missing source lands.

- **Decision:** Topology is derived **on the read side** by a **five-pass algorithm** applied to all deployment rows for the requested service. The Write API persists raw rows including `parent_deployments`; the Read API recomputes the topology on every matrix read (and on every NOTIFY-triggered slot recompute). **No topology rows are stored.**

  Inputs:

  | Input | Source |
  |---|---|
  | All deployments for `service` | `deployments` table. |
  | Correlation attribute (active for this service, per request) | Resolved in this precedence order: (1) `Topology.PerServiceOverrides[service]` if present (ops-managed, server-side); (2) the request's `correlationAttribute` query parameter if supplied and valid; (3) `Topology.CorrelationAttribute` (server-side default, default `version`). |
  | User override (if any) | Sent as a `correlationAttribute` query parameter on read endpoints — a per-request hint only. Stored client-side in `localStorage`; never persisted server-side. The SPA does not invoke `PATCH /api/config/topology`. |

  Algorithm:

  1. **Bucket by env.** Group all deployments for `service` by `environment`, ordered within each bucket by `deployed_at DESC`. (The DAG is per-service, not global; an env may appear in the DAG even if it has only one deployment.)
  2. **Explicit-first pass.** For each deployment `D` with non-empty `parent_deployments`, resolve each id to its source deployment `P` (same `service`, looked up by `deployment_id`). For each successful resolution, emit one directed edge `P.environment → D.environment` with `source: "explicit"`. Skip self-edges (`P.environment === D.environment`). Skip duplicate `(from, to)` pairs within the explicit pass.
  3. **Correlation fallback pass.** For each deployment `D` *without* `parent_deployments` (NULL or empty array), find candidate parent deployments `P` such that:
     - `P.service === D.service`
     - `P.environment !== D.environment`
     - `P.<correlation-attribute>` equals `D.<correlation-attribute>` (case-sensitive string equality of the source field; e.g. `version`, `ref`, `sha`, `run_number` stringified)
     - `P.deployed_at < D.deployed_at`
     - The "closest in time" candidate per parent env wins — for each candidate env, keep only the `P` with the greatest `deployed_at` strictly less than `D.deployed_at`.

     Emit one edge `P.environment → D.environment` per parent env match with `source: "correlated"`.
  4. **Merge.** Union the explicit edges and the correlated edges keyed by `(from, to)`. When both produce the same `(from, to)` pair, `source: "explicit"` wins (so the SPA can render explicit edges distinctly from correlated ones).
  5. **Dangling references.** If `parent_deployments[i]` references a `deployment_id` not yet ingested, the reference is held verbatim on the row (already accepted at ingest per the data-model topology constraints). It contributes no edge in the explicit pass for this read. The next read after the missing source lands automatically picks it up — no reconciliation job, no NOTIFY-replay needed.

  Cycle handling at read time:

  > The DAG should already be acyclic (write-time check), but the read-side builder runs a defensive topological sort and drops any edge that would close a cycle, logging a `WARN` with the offending `(from, to)` pair. Defence-in-depth: a race between two writes — both passing their independent cycle checks — could theoretically commit a cycle, and the SPA must not loop forever.

  Output (per service):

  ```json
  {
    "edges": [
      { "from": "dev",  "to": "qa-1", "source": "explicit" },
      { "from": "qa-1", "to": "uat",  "source": "correlated" }
    ]
  }
  ```

- **Consequences:**
  - **Topology is always current with respect to the user's correlation-attribute preference.** Two viewers with different picker values see different topologies for the same underlying data; this is by design (three-tier correlation-attribute precedence — see historical Decision 7 in Context).
  - **No stored topology rows → no migration churn when the algorithm or precedence rules change.** Replacing the correlation algorithm in a future revision is a backend-only redeploy.
  - **Read cost grows linearly with deployments per service.** For the dashboard's scale (10s of services × 10s of envs × 10s of deployments per env over the retention window), the cost is negligible and stays inside NFR-03's 5 s budget by orders of magnitude. If a future scale forces a change, the algorithm can be moved to a materialised view without altering the wire shape (output is identical).
  - **The explicit pass strictly wins over the correlated pass** when both produce the same `(from, to)`. This is the contract the SPA relies on to distinguish operator-stated edges from inferred edges (`source: "explicit"` vs `source: "correlated"`).
  - **Dangling references self-heal** on the next read after the missing source lands — no compensating job is needed (consequence of the dangling-references-accepted-at-ingest rule — see historical Decision 9 in Context — and the algorithm's pass 5).
  - **Cross-instance consistency holds without coordination.** Every Read API instance applies the same algorithm to the same database state and the same per-request inputs, so all viewers see the same topology for the same request (NFR-05 preserved).

- **References:**
  - SAD §7 "Data Model → `deployments` table" — `deployment_id` and `parent_deployments` columns and write-time constraints.
  - SAD §7 "API Contract → Matrix response shape — per service" — the `topology.edges` block.
  - SAD §7 "API Contract → `correlationAttribute` query parameter" — the per-request attribute.
