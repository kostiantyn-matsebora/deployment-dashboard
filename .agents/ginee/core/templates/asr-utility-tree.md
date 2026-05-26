# ASR utility tree — `local/asr-utility-tree.md` template

<!--
  Scope:
  - Per-project.
  - Authored + edited by solution-architect during Phase 1 (derive) + Phase 2 (refine).
  - Records the Architecturally Significant Requirements (ASRs) — the subset of NFRs + Constraints that shapes architecture.
  - ASRs are derived from `local/requirements.md` (NFRs + Constraints) via the ATAM utility-tree technique. They are an **outcome** of requirements, not the same level.

  ATAM utility tree:
  - Root = "system utility".
  - Children = quality attributes (performance, availability, security, modifiability, ...).
  - Each quality attribute branches into specific scenarios.
  - Each scenario is rated:
    - Business value (H / M / L)
    - Architectural impact (H / M / L)
  - High-business-value AND high-architectural-impact scenarios = ASRs.

  Authority:
  - solution-architect owns content (semantics) per `core/roles/solution-architect.md § Design`.
  - ai-engineer owns shape per `core/protocols/doc-roles.md`.
  - ADRs cite the ASR(s) they address.
-->

---

# ASR utility tree — `<project name>`

## How to read this file

Each branch below is a **quality attribute** (performance, availability, security, ...). Each leaf is a **scenario** — a concrete situation that exercises the attribute, rated `(business value, architectural impact)`. Scenarios rated `(H, H)` are **Architecturally Significant Requirements (ASRs)** and drive architecture decisions.

ATAM convention: rate on H / M / L. Per `core/protocols/triage-scoring.md` numeric mapping: `H=3, M=2, L=1` for any cross-tool sorting.

## Utility tree

### `<Quality attribute 1 — e.g. Performance>`

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-001` | `<concrete scenario — stimulus + environment + response + measure>` | `NFR-NNN` | `H` | `H` | ✅ |
| `ASR-002` | `<...>` | `NFR-NNN` | `H` | `M` | ⬜ (not an ASR — low arch impact) |

### `<Quality attribute 2 — e.g. Availability>`

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-003` | `<...>` | `NFR-NNN` / `CON-NNN` | `H` | `H` | ✅ |

### `<Quality attribute 3 — e.g. Security>`

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-004` | `<...>` | `CON-NNN` | `H` | `H` | ✅ |

<!-- Add more quality-attribute branches as the requirements register grows. -->

## ASR summary — quick reference

The architecturally significant scenarios (`(H, H)` only) listed compactly. Each must be addressed by ≥ 1 ADR or by an existing architecture-doc section.

| ASR ID | Scenario (one-line) | Addressed by |
|---|---|---|
| `ASR-001` | `<one-line digest>` | `ADR-NNNN-*.md` or `<architecture-doc § anchor>` |
| `ASR-003` | `<one-line digest>` | `ADR-NNNN-*.md` or `<architecture-doc § anchor>` |
| `ASR-004` | `<one-line digest>` | `ADR-NNNN-*.md` or `<architecture-doc § anchor>` |

## Cross-references

- **Requirements register** — `local/requirements.md` holds the NFRs + Constraints these ASRs derive from.
- **ADRs** — Each `(H, H)` ASR must be addressed by ≥ 1 ADR (or an existing architecture-doc section). SA Phase-7 review verifies coverage per `core/process.md § Phase 7`.
- **Phase 1 design dip** — SA derives this tree at Phase 1 per `core/roles/solution-architect.md § Design`. Updates land at Phase 2 (delta mode → ADR + ASR amendment) or Phase 4 (engineer proposes architectural change → SA review → ASR amendment if scope warrants).
