---
title: ADRs
nav_order: 6
has_children: true
---

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
| [ADR-0005](./ADR-0005-release-install-migration-actuation.md) | Release-install migration actuation via tag-pinned `migration.sql` release asset | **superseded by ADR-0009** (2026-05-21) — external one-shot model retired; original decision retained for historical context |
| [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) | Microservices architecture with container co-location of Write + Read API services | accepted (2026-05-19) — supersedes ADR-0002 |
| [ADR-0007](./ADR-0007-vendor-adapters-emit-parent-deployments.md) | Vendor adapters convert vendor correlation signals into `parent_deployments` edges; read-side five-pass remains backstop | accepted (2026-05-20) — paired with issue #19; amends CR-0009 §3d endpoint list |
| [ADR-0008](./ADR-0008-leaky-bucket-cap-and-republish-on-tick.md) | Leaky-bucket cap on observed remaining; re-publish-on-tick (no persistence); per-token cap with per-(adapter, source-id) reporting | accepted — paired with CR-0011 |
| [ADR-0009](./ADR-0009-startup-applied-ef-migrations.md) | API host applies EF migrations on startup; external `migrations` service + `migration.sql` release asset retired | accepted (2026-05-21) — paired with issue #22; supersedes ADR-0005 |
| [ADR-0010](./ADR-0010-dev-env-compose-derives-from-release.md) | `dev_env/docker-compose.local.yml` layered on `install/docker-compose.release.yml` via Compose merge | accepted (2026-05-22) — paired with issue #21 |
