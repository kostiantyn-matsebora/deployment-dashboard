# Migration — D36: Warm specialist reuse across dispatches within a task lifecycle

**Target release:** next minor after 2026-05-24.
**Affected adopters:** every adopter on every adapter — opt-in via adapter capability; no breaking change.
**Closes:** [#90](https://github.com/kostiantyn-matsebora/ginee/issues/90).

## What changed

Pre-D36, every `@<role>` dispatch within a Phase 1–8 task spawned a fresh subagent — even when the same role had been dispatched earlier in the same task. Each fresh spawn reloads the role kernel, the role's `phase-participation:` files, `core/process.md`, and the role's `local/index/` reads — identical context, paid every time.

D36 adds a **warm-specialist-reuse** contract: when team-lead re-dispatches the same role within the same task **AND** within that role's `phase-participation:` window (per D35-process-md-load-topology), it resumes the existing specialist via the adapter's native mechanism instead of fresh-spawning. The specialist's kernel + process + index reads survive in its conversation; the resume payload carries only the new instruction + phase context + a drift advisory.

## Why

Pre-D36 measurement of a typical Phase 1–8 task with 3–5 re-dispatches of the same specialist:

| Reload cost item | Approx tokens per fresh spawn |
|---|---|
| Adapter-side role kernel (`.claude/agents/<role>.md`) | 0.5–1 k |
| `core/roles/<role>.details.md` | 2–4 k |
| `core/process.md` + role's phase files (per D35) | 4–6 k |
| `local/bindings.md` + `local/project-profile.md` | 1–3 k |
| Index / manifest hot reads | 1–3 k |
| Dispatch payload prompt itself | 0.5–2 k |

Multiplied across 3–5 dispatches per role per task → 15–50 k tokens of duplicated reload per task. Warm reuse drops every row except the final one (dispatch payload) on each repeat dispatch.

D21-context-economy-gates already classifies always-loaded surfaces as the strictest tier; D35 made role context cost proportional to participation; D36 amortises that cost across the repeated dispatches a single task naturally generates.

## Reuse contract

**Scope.** Warm reuse is bounded to:

1. **One Phase 1–8 task lifecycle.** A task starts when team-lead picks one up (TODO line · GitHub issue · direct instruction); ends at Phase 8 acceptance OR explicit abandonment. The warm registry is cleared at task close — new task starts cold.
2. **One role's `phase-participation:` window.** Per D35-process-md-load-topology, each cardinal declares which phases it participates in. The same warm specialist serves any dispatch within its window during this task; dispatches outside the window are out-of-contract.

**Team-lead behaviour.**

1. **First dispatch of role `R` within task `T`:** spawn fresh via the adapter's native subagent call. Record `{role: R, agent-id: X, task: T, last-phase: P}` in an in-conversation warm registry (team-lead's own context).
2. **Second+ dispatch of role `R` within task `T`, where the new phase is within `R`'s `phase-participation:` window:** resume the existing agent via the adapter's native resume mechanism — for the Claude adapter, `SendMessage` to the recorded agent-id. Resume payload carries:
   - The new instruction.
   - The new phase identity (e.g. "Phase 4 — implementation").
   - Drift advisory (see below).
3. **On task close (Phase 8 accept OR abandonment):** clear the warm registry. Any background-spawned agents are torn down; future tasks start cold.

**Adapter capability.**

| Adapter | Native resume mechanism | D36 effect |
|---|---|---|
| `claude` | `SendMessage` to a background-spawned agent (Claude Code) | Warm reuse honoured (see `adapters/claude/install.md § Warm specialist reuse (D36)`) |
| `copilot-cli` | None standardised at this writing | Fallback — fresh-spawn (current behaviour) |
| `agents-md` | Adapter-host-defined; varies | Fallback unless host exposes a resume mechanism |
| `generic` | None | Fallback |

Adapters without a native resume mechanism see **no behavioural change** — team-lead falls back to fresh-spawn on every dispatch (the pre-D36 default).

## Forced-fresh triggers

Even within the same task + within the role's `phase-participation:` window, team-lead spawns fresh (does NOT warm-resume) when any of the following holds:

| Trigger | Why |
|---|---|
| Prior dispatch returned `Status: Blocked` / `Status: Hand-off` and the user resolved the blocker externally | Specialist's in-context state is stale — it doesn't know how the blocker resolved. |
| Worktree-isolated dispatch in a different worktree than the prior warm agent | Working-tree mismatch — the specialist would consume wrong file content. |
| `local/bindings.md` / `local/project-profile.md` / `local/index/manifest.yaml` rewritten materially since the warm agent last interacted | Specialist's setup context is stale; safer to reload. |
| User explicitly requests fresh-spawn (`fresh:` per-task prefix) | Authority override. |
| Adapter cannot deliver a `SendMessage` to the recorded agent-id (agent died · session restart · adapter bug) | Resume is impossible; spawn fresh transparently. |

Forced-fresh is not a regression — it's the safety carve-out. Team-lead never silently warm-resumes through one of these.

## Drift advisory

The resume payload includes a one-block advisory listing any `local/index/manifest.yaml` entries with new SHAs since the warm agent's last interaction. The warm specialist then re-reads only what changed, instead of trusting stale in-context content. Mirrors the pre-dispatch SHA-drift sweep already specified in `core/protocols/index-protocol.md § Pre-dispatch staleness check`. Reuses that mechanism; no new tooling.

Shape:

```
## Drift since your last interaction

| Index entry | Old SHA | New SHA |
|---|---|---|
| local/index/architecture.idx | a1b2c3d… | e4f5a6b… |

Re-read these before proceeding. Other entries are unchanged.
```

Empty case: `(no drift)`. The advisory always appears so the specialist sees an explicit signal — never inferred from absence.

## Decisions affected

- **D28-skill-runner-boundary** — unchanged. The warm registry is team-lead's surface, not skill-runner's. Skill-runner still mechanically forwards dispatch contracts verbatim; warm-vs-fresh resolution happens in team-lead's plan.
- **D29-strict-subagent-return-schema** — unchanged. Returns from warm-resumed specialists honour the same schema. A warm-resume marker (e.g. `warm-resume: true` in `## Notes`) is optional for audit purposes but not required by the schema.
- **D32-claude-adapter-subagent-dispatch** — unchanged. The decision-authority split holds. Warm reuse runs in team-lead's plan-cycle phase, not in the skill-runner's mechanical-execution phase.
- **D35-process-md-load-topology** — D36 is the natural follow-through. D35 minimised per-dispatch context; D36 minimises per-task repeated-dispatch context. Reuse is bounded to `phase-participation:` windows so the warm specialist has already loaded everything it needs.

## Adapter implications

Each `adapters/*/install.md` gains a short "Warm specialist reuse (D36)" section noting how (or if) the adapter supports the contract. Concretely:

- **Claude adapter:** team-lead spawns the specialist with `run_in_background: true` on first dispatch; records the agent-id; uses `SendMessage` to resume. On task close, sends a `## Phase 8 close — release` signal so the background agent terminates cleanly.
- **Adapters without resume capability:** ship the section saying "Warm reuse falls back to fresh-spawn on this adapter; no behavioural change." Update if/when the host gains a resume mechanism.

## Opt-out

Adopters can disable warm reuse via `local/framework.config.yaml`:

```yaml
warm-reuse:
  enabled: false  # default: true on adapters with resume capability
```

Default is `true` on adapters that support it; the opt-out exists for adopters who hit a specific failure mode (e.g. context-bleed across phases that they want to audit fresh each time).

## Out of scope

- **Cross-task agent persistence.** Each task starts cold. Cross-task is a separate proposal.
- **Cross-session persistence.** Conversation history doesn't survive a session restart.
- **Pre-warming speculatively** before the role is first dispatched.
- **Heuristic-driven forced-fresh** beyond the explicit triggers listed above.
- **Adapter-portability shims** for adapters lacking a resume mechanism — they fall back to fresh-spawn, no shim required.

## Forward-only

Purely additive. No `local/` schema change beyond the optional `warm-reuse.enabled` override (default `true`). Adopters who do nothing on upgrade simply get the warm-reuse savings on capable adapters; adopters with capability-less adapters see no change.
