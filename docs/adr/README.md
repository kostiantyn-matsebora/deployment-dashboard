# Architecture Decision Records

Records of architecture decisions (Architecture Decision Records — component shape, packaging, algorithm, persistence, wire-contract addition) after the initial SAD was frozen. Append-only — superseded entries are never edited in place. The triggering requirement change (if any) lives in a paired CR under `docs/cr/`. See CLAUDE.md → "Source of truth" for the SAD-freeze rule.

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
