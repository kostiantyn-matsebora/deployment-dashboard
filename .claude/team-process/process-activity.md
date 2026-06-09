# Orchestration Process — Activity Diagram

Activity-flow view of [`process.md`](process.md): the **Phases (0–7)** plus the embedded
**Review loop** (Phase 5) and **Fix loop** (Phases 6–7), ending at the autonomy/merge gate.

```mermaid
flowchart TD
    start([Multi-layer change arrives]) --> p0

    p0["Phase 0 — Intake & docs-first<br/>Read owning spec · restate acceptance criteria<br/>Need state of a code area? → delegate REVIEW to owning role"]

    p0 --> q0{Cross-layer<br/>contract change?}
    q0 -- yes --> p1["Phase 1 — Contract<br/>Define/update shared contract → ARTIFACT"]
    q0 -- no --> p2
    p1 --> p2

    p2["Phase 2 — Plan & dispatch<br/>Map work to roles · declare each lane in a BRIEF · surface plan"]
    p2 --> q2{N parallel<br/>members?}
    q2 -- yes --> conf["Get explicit confirmation<br/>(parallelize only disjoint lanes)"]
    q2 -- no --> p3
    conf --> p3

    p3["Phase 3 — Implement<br/>Members edit in-lane (disjoint = parallel, coupled = serial/worktree)<br/>Each self-verifies: build + own unit tests + lint → RESULT"]
    p3 --> p4["Phase 4 — Integrate<br/>Orchestrator merges lanes into the branch<br/>(verify repo state after every wave)"]

    p4 --> p5["Phase 5 — Cross-review (Review loop)<br/>One reviewer per touched competency (reviewer ≠ implementer)<br/>Walk role's full bar per symbol → REVIEW"]
    p5 --> q5{All competencies<br/>pass?}
    q5 -- "changes-requested" --> fix5["Route remark → owning implementer fixes<br/>Re-review full unit (not delta)"]
    fix5 --> p5

    q5 -- "all pass" --> p6["Phase 6 — Verify<br/>testing runs wider net: API / integration / e2e + regression<br/>Re-verify against phase-0 spec"]
    p6 --> q6{Green?}
    q6 -- "red → FINDING" --> fix6["Orchestrator diagnoses to ROUTE → FIX to owning role<br/>(role does the deep dig in its own context)"]
    fix6 --> p6

    q6 -- "green" --> p7["Phase 7 — Ship<br/>Commit in logical groups · push to branch · open/update PR · watch CI"]
    p7 --> q7{CI green?}
    q7 -- no --> fix6
    q7 -- yes --> gate

    gate{Autonomous<br/>mode?}
    gate -- yes --> endA([PR open + CI green + awaiting user acceptance<br/>— never auto-merge to default branch])
    gate -- no --> endB([Await approval, then merge])

    endA --> done([Done = user-accepted AND merged AND default branch green])
    endB --> done
```

## Modeling notes

- **Phase 1 is gated** — the contract phase runs only for cross-layer changes; single-lane work skips to planning.
- **Two feedback loops** — the *Review loop* (Phase 5 → fix → re-review until all `pass`) and the *Fix loop* (Phase 6/7 red → `FIX` → re-verify until green).
- **The merge gate is outside Ship** — autonomous mode stops at "PR open + CI green"; only user acceptance + merge reaches *Done*.
