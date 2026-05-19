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
| [ADR-0002](./ADR-0002-modular-monolith-consolidation.md) | Modular monolith — single API container hosting two library surfaces | **superseded by ADR-0006** (2026-05-19) — co-location mechanics + future-split trigger conditions survive as historical record |
| [ADR-0003](./ADR-0003-theme-persistence-and-foit-safe-bootstrap.md) | Theme persistence in `localStorage` with FOIT-safe inline bootstrap | accepted |
| [ADR-0004](./ADR-0004-opaque-per-progress-reporter-cursor.md) | Opaque per-`progress_reporter` cursor; backend-held; out-of-process fetcher; plug-in adapter shape | accepted |
| [ADR-0005](./ADR-0005-release-install-migration-actuation.md) | Release-install migration actuation via tag-pinned `migration.sql` release asset | accepted |
| [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) | Microservices architecture with container co-location of Write + Read API services | accepted (2026-05-19) — supersedes ADR-0002 |
