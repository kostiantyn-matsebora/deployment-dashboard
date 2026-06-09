---
description: Contract activity of .claude/team-process/process.md. Define or update the shared contract (endpoint, verb, payload, wire format) as an ARTIFACT; all code targets the agreed artifact. The contract role may settle the interface directly with consumers.
argument-hint: <the cross-layer change whose interface must be agreed>
---

# /contract

The **Contract** activity of the orchestration process
([`.claude/team-process/process.md`](../team-process/process.md)).

- **Contract-first.** Define or update the shared contract (endpoint, verb, payload, wire format)
  **before any code** → emit an `ARTIFACT`. All code targets the agreed artifact.
- **Owned by the `contract` role** (`api-architect`). For API features the contract artifact is the
  source of truth.
- **Peer negotiation is allowed here.** The `contract` role may settle the interface directly with
  its consumers — the outcome is recorded in the `ARTIFACT`, **never left as chat**.

**Output:** the agreed contract `ARTIFACT`.
