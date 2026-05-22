# Requirements register — `local/requirements.md` template

<!--
  Scope:
  - Per-project.
  - Authored + edited by solution-architect during Phase 1 (elicit) + Phase 2 (refine).
  - Inputs to the ASR utility tree (`local/asr-utility-tree.md`); ASRs are the architecturally-significant subset of NFRs + Constraints derived via ATAM, not the same level.

  Usage:
  - Replace bracketed placeholders.
  - Drop empty sections.
  - Numbering: zero-padded per family (FR-001, NFR-001, CON-001); never reused; superseded entries keep their number + reference the replacement.
  - Status values: `Proposed | Accepted | Deprecated | Superseded by <ID>`.

  Authority:
  - solution-architect owns content (semantics) per `core/roles/solution-architect.md § Design`.
  - ai-engineer owns shape (file splits, structure) per `core/doc-roles.md`.
  - team-lead's CRs (`<cr-directory>/CR-NNNN-*.md`) propose modifications to entries here; SA accepts the CR + applies the diff.
-->

---

# Requirements register — `<project name>`

## Functional Requirements (FRs)

What the system must do — user-visible behaviour, business logic, integration contracts.

| ID | Requirement | Source | Status |
|---|---|---|---|
| `FR-001` | `<one-sentence imperative-voice statement>` | `<user / stakeholder / discovery>` | `Accepted` |
| `FR-002` | `<...>` | `<...>` | `Accepted` |

## Non-Functional Requirements (NFRs)

Quality attributes the system must satisfy — measurable, with explicit targets.

| ID | Quality attribute | Statement | Measure | Target | Source | Status |
|---|---|---|---|---|---|---|
| `NFR-001` | `<e.g. Latency>` | `<full-text NFR statement, measurable>` | `<e.g. p95 round-trip latency, sustained>` | `<e.g. ≤ 200 ms>` | `<NFR origin>` | `Accepted` |
| `NFR-002` | `<e.g. Availability>` | `<...>` | `<...>` | `<...>` | `<...>` | `Accepted` |
| `NFR-003` | `<e.g. Cost>` | `<...>` | `<...>` | `<e.g. ≤ $30 USD / mo>` | `<...>` | `Accepted` |

**Quality-attribute categories** (ATAM convention — extend per project): performance · availability · security · modifiability · usability · testability · interoperability · scalability · cost · operability.

## Constraints

External or contextual limits the architecture must respect — technical, regulatory, organizational.

| ID | Type | Constraint | Rationale | Source | Status |
|---|---|---|---|---|---|
| `CON-001` | `<technical | regulatory | organizational>` | `<one-sentence imperative statement>` | `<why it exists; what it prevents>` | `<origin>` | `Accepted` |
| `CON-002` | `<...>` | `<...>` | `<...>` | `<...>` | `Accepted` |

## Cross-references

- **Architecturally Significant Requirements (ASRs)** — the subset of NFRs + Constraints that shapes architecture lives in `local/asr-utility-tree.md` (derived via ATAM utility tree per `core/templates/asr-utility-tree.md`). ASR-001 / -002 / ... cite the source `NFR-NNN` / `CON-NNN` here.
- **ADRs** — `<adr-directory path>/ADR-NNNN-*.md` cite the FR / NFR / Constraint they realize or amend.
- **CRs** — `<cr-directory path>/CR-NNNN-*.md` propose additions / modifications / retirements to entries above. Reporter / engineer / team-lead drafts; team-lead authors the record; SA applies the requirements-register diff per `core/roles/solution-architect.md § Architecture-doc freeze`.
