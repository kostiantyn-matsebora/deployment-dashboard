# Phase 2 — Design & architecture

**Load triggers** — any cardinal whose `phase-participation:` includes `2`. Per-role roster: `team-lead` (work breakdown) · `solution-architect` (architecture / ADRs) · mockup-owning role · service-owning role.

- **Goal.** Lock contracts before any code — system, API, visual, work breakdown.
- **Dispatch.** Owning role per `local/bindings.md`:

  | Surface | Owner |
  |---|---|
  | Target architecture (system / infrastructure / security / data / integration) | `solution-architect` per `core/roles/solution-architect.md § Design` |
  | ADRs + diagrams + requirements / ASR updates | `solution-architect` |
  | Mockup | mockup-owning role |
  | Wire contract | service-owning role |
  | Work breakdown | `team-lead`; each engineer contributes their slice |
  | Engineer-proposed architectural deltas | originating engineer drafts; `solution-architect` reviews per `§ Review` (APPROVE / REJECT / REQUEST-CHANGES) |

  Parallel where independent. **Mode-aware** — greenfield mode authors the architecture doc; delta mode produces ADRs + CRs and never rewrites the doc wholesale.
- **Option-shape rule.** Every design proposal MUST surface ≥ 1 adopt-existing-solution candidate **or** an explicit `(none viable — <reason>)` cite. Full schema · 5 mandatory checks · enforcement: `core/protocols/options-protocol.md` (load-on-demand).
- **Acceptance.**
  - Fixed wire shape + mockup behaviour + work breakdown.
  - Visual / contract harness green (where one exists).
  - Cross-references resolved.
  - Artefacts presentable as a coherent whole.
  - ASRs traceable to ADRs (each ASR is addressed by ≥ 1 ADR OR an existing architecture-doc section).
  - Option lists pass `core/protocols/options-protocol.md § 5 mandatory checks`.

## Cross-phase rule

- Artefact classes do not cross phases.
- A change needing both design and code:
  1. Phase 2 — land design artefacts in docs.
  2. Phase 4 — land code artefacts in solution.
