# Architecture Decision Records

Records of architecture decisions after the initial SAD was frozen.

The SAD (`docs/deployment-dashboard-architecture.md`) defines the **initial architecture only**. Every subsequent architectural decision (component shape, packaging choice, algorithm choice, persistence strategy, wire-contract addition, etc.) lands here as a numbered ADR. ADRs are append-only — once accepted they are never edited in place; a superseding ADR is added instead.

An ADR records the **decision** and its **consequences**. The triggering requirement change (if any) lives in a paired CR under `docs/cr/`.

## Template

### ADR-NNNN — \<title>

- **Status:** proposed / accepted / superseded
- **Context:** (situation; what forces this decision)
- **Decision:** (the chosen approach)
- **Consequences:** (trade-offs, follow-ups, risks)
- **References:** (SAD sections, related CRs/ADRs)

## Index

| ADR | Title | Status |
|---|---|---|
| [ADR-0001](./ADR-0001-topology-derivation-five-pass.md) | Per-service topology derivation — five-pass algorithm on the read side | accepted |
| [ADR-0002](./ADR-0002-modular-monolith-consolidation.md) | Modular monolith — single API container hosting two library surfaces | accepted |
| [ADR-0003](./ADR-0003-theme-persistence-and-foit-safe-bootstrap.md) | Theme persistence in `localStorage` with FOIT-safe inline bootstrap | accepted |
