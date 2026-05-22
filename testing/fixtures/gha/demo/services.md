# Demo-mode service inventory

> Companion to [`README.md`](./README.md). Documents the six demo services, the four demo environments, and the three `needs:` chains the demo bundle is designed to render once the follow-up demo-mode issue wires it.

## Services

| GHA `owner/repo` source-id | Service name | Deployment id range | Envs covered | `needs:` upstream |
|---|---|---|---|---|
| `demo-org/demo-frontend` | `frontend` | 1–25 | dev, qa, staging, prod | `backend` |
| `demo-org/demo-backend`  | `backend`  | 26–50 | dev, qa, staging, prod | — |
| `demo-org/demo-gateway`  | `gateway`  | 51–75 | dev, qa, staging, prod | `backend` |
| `demo-org/demo-mobile`   | `mobile`   | 76–100 | dev, qa, staging, prod | `backend` |
| `demo-org/demo-worker`   | `worker`   | 101–125 | dev, qa, staging, prod | — |
| `demo-org/demo-database` | `database` | 126–150 | dev, qa, staging, prod | — |

Six services × four environments = 24 matrix slots.

## Environments

| name | role |
|---|---|
| `dev`     | Lowest, churns fastest, mix of every box state. |
| `qa`      | One step up — last terminal usually success; occasional running. |
| `staging` | Pre-prod gate; mostly stable. |
| `prod`    | Highest; mostly success with occasional running-with-last. |

## `needs:` chains

Three services advertise `needs:` upstream dependencies in their workflow YAML:

```
frontend → backend
gateway  → backend
mobile   → backend
```

When the demo-mode issue lands, the topology pane will render these as inbound edges into `backend` (one per consumer).

## Wire-up status

**NONE of these mappings are loaded by any current entrypoint** — see [`README.md`](./README.md) for the verbatim disclaimer. The integration test runner explicitly resets the mock-gha mappings between scenarios and never targets this bundle.
