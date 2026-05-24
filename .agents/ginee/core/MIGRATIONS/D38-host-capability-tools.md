# Migration — D38: Host capability tools — adapters expose, specialists discover and leverage

**Target release:** next minor after 2026-05-24.
**Affected adopters:** every adopter on every adapter — opt-in via adapter capability + adopter override.
**Closes:** [#85](https://github.com/kostiantyn-matsebora/ginee/issues/85).

## What changed

Pre-D38, ginee specialists worked from their charter + project context + (post-D35) phase-participation files. They had **no explicit awareness of capability tooling** the host adapter exposes — skills, MCP servers, IDE integrations. Output quality varied based on whether the dispatched agent happened to know about a relevant tool.

Worked motivation: a `frontend-engineer` dispatched today to author a Phase-2 HTML-mockup variant on the Claude adapter has no protocol that nudges it toward the host's `frontend-design` skill. Mockup quality varies by dispatch — purely on chance of which capability tools the model recalls.

D38 adds an **affinity-injection** protocol: adapters declare their available capability tools in `install.md § Specialist-tool affinity`; team-lead consults the active adapter's table during dispatch composition; matching tools surface as a one-line hint in the dispatch prompt. Specialist judgment never overruled — the protocol is *prefer if available*, not *must use*.

## Why

| Failure mode (pre-D38) | Effect |
|---|---|
| `frontend-engineer` mocks HTML without nudging toward `frontend-design` skill | Mockup quality varies; the host has a purpose-built tool the specialist never touches. |
| `solution-architect` Phase-7 review without nudging toward `code-review` skill | SA reviews code by reading rather than running the focused review surface the host provides. |
| `qa-engineer` Phase-5 verification without nudging toward `verify` skill | Manual smoke skipped or hand-rolled instead of running the matched workflow. |
| Security-touching PR review without nudging toward `security-review` skill | NFR-security ASR coverage gaps go unflagged. |

The host has invested in purpose-built tools; ginee should consume them. The principle generalises across every adapter+host pair — each adapter's capability surface differs, and ginee roles should discover whichever ones the host offers.

## Form — Option C (dispatch-time affinity injection)

Three options surfaced in #85; D38 selects **C**:

| Option | Verdict | Reason |
|---|---|---|
| **C — dispatch-time affinity injection** | **Selected** | Decision lives in orchestrator (team-lead loads `core/process/dispatch.md` per D35-process-md-load-topology); specialists need not know the catalog; adapter-side declarative table is the single source per adapter. |
| A — declarative manifest per adapter | Rejected | New YAML schema doesn't fit ginee's markdown-only stack; cross-tool maintenance burden as adapter ecosystems evolve. |
| B — discovery hint in role kernels | Rejected | Kernels are always-loaded; growing them violates D35 / D21 budget; per-adapter tool list bleeds into a generic role kernel and forces per-cardinal duplication. |

Adopt-existing-solution (D30-adopt-existing-solution): each adapter already documents its surface in `install.md § How to invoke` (Claude's cheat-sheet table mapping phrasings → skills). D38 extends that doc with a sibling table — no new file class. `(none viable — host-tool-aware doc lint)` for the lint piece since specialists self-judge whether to invoke. No external library adopted.

## Affinity-table shape (adapter-side)

Each adapter's `install.md` gains a `## Specialist-tool affinity` section. Table shape:

| Tool | Class | Role / task affinity | Invocation hint |
|---|---|---|---|
| `<tool-id>` | Skill / MCP / IDE / etc. | `<role>` doing `<task surface>` | one-line phrasing or call shape |

The Claude adapter's reference example (see `adapters/claude/install.md § Specialist-tool affinity`):

| Tool | Class | Role / task affinity | Invocation hint |
|---|---|---|---|
| `frontend-design` | Skill | `frontend-engineer` authoring or modifying an HTML mockup | "use the `frontend-design` skill to author the mockup variant" |
| `code-review` | Skill | `solution-architect` Phase 7 governance · engineer self-check pre-PR | "run `code-review` on the diff before sign-off" |
| `verify` | Skill | `qa-engineer` Phase 5 manual smoke · engineer Phase 6 fix verification | "use `verify` to confirm the change works end-to-end" |
| `security-review` | Skill | NFR-security ASR coverage · `solution-architect` review on security-touching PRs | "run `security-review` against the changed surface" |

## Dispatch-time injection (team-lead-side)

When team-lead drafts a dispatch contract, it:

1. **Identifies the active adapter** — single non-`_shared` subdir under `<fw>/adapters/` (already established by D27-installer-fetch-on-update).
2. **Reads `<adapter>/install.md § Specialist-tool affinity`** — once per task, cached in team-lead's working context.
3. **Matches affinity** — for each tool, compares the dispatched role + task surface against the table's affinity column. Match → surface; no match → omit.
4. **Surfaces a hint line** in the dispatch prompt:

   ```
   Available capability tool: `<tool-id>` — <invocation-hint>. Use if it fits the work; never required.
   ```

   Multiple matches → one hint line each. Zero matches → no hint section at all (avoid noise).

5. **Specialist judgment.** Specialist reads the hint in its prompt; decides whether to invoke. Framework never mandates use. Specialist's return may cite the tool in `## Verification log` (e.g. `verified via frontend-design skill: <output>`); no schema change required.

## Adopter opt-out / scope-out

`local/framework.config.yaml § capability-tools`:

```yaml
capability-tools:
  enabled: true             # default: true on adapters with a populated affinity table
  disabled:                 # explicit per-tool scope-out — never surfaces this tool
    - frontend-design       # opt out of this specific tool but keep the rest
  required-context:         # explicit force-required for specific tool/role pairs
    - tool: security-review
      role: solution-architect
      task: ".*security.*"  # regex against task description; force-surfaces when matched
```

Default: opt-out empty; affinity surfaces normally. `required-context` is optional and not the default behaviour — D38 stays "prefer if available."

## Decisions affected

- **D9 (skill / command parity)** — D38 must work equally from skill entry points and command dispatch. Both routes hit team-lead's dispatch composition, so the affinity hint is consistent.
- **D25-classical-architect** — unchanged. Doc-authorship principle holds: adapter-team author the adapter's `install.md § Specialist-tool affinity` section; `solution-architect` reviews coherence at PR time.
- **D28-skill-runner-boundary** — unchanged. The affinity-injection logic is team-lead's surface, not skill-runner's. Skill-runner mechanically forwards the dispatch contract verbatim (with whatever hint team-lead included).
- **D29-strict-subagent-return-schema** — unchanged. Specialists may cite tool invocation in `## Verification log` when it shaped the deliverable; the schema's mandatory sections are not modified.
- **D32-claude-adapter-subagent-dispatch** — unchanged. Decision authority split holds; team-lead resolves affinity in its plan-cycle.
- **D35-process-md-load-topology** — the affinity-injection rule lives in `core/process/dispatch.md` (team-lead-only); no impact on per-cardinal load cost.

## Adapter implications

| Adapter | Status | Section to author |
|---|---|---|
| `claude` | **Reference implementation** — 4 skills listed (`frontend-design` · `code-review` · `verify` · `security-review`) with worked affinity rows | `adapters/claude/install.md § Specialist-tool affinity` |
| `copilot-cli` | Document current state — Copilot CLI does not enumerate host capability tools by default; table starts empty + adopter populates if their host exposes any | `adapters/copilot-cli/install.md § Specialist-tool affinity` |
| `agents-md` | Same as copilot-cli — table starts empty + adopter populates | `adapters/agents-md/install.md § Specialist-tool affinity` |
| `generic` | Graceful degradation — table absent; team-lead checks `install.md`, finds no section, skips affinity injection | (no section needed; framework handles absence) |

## Graceful degradation

If the active adapter has no `## Specialist-tool affinity` section (e.g. `generic`, or an adapter not yet updated), team-lead silently skips affinity injection. Dispatches proceed with their normal prompt; no error, no warning, no degradation in specialist output. **D38 is "additive enhancement when the host offers it" — never a precondition.**

## Out of scope

- **Building or shipping the tools themselves** — the framework only references what the host provides.
- **Cross-adapter tool federation** — each adapter's tool surface is independent.
- **Auto-installation of host tools** — adopters install and maintain their host environment.
- **Per-tool quality grading** — the framework nudges toward affinity, never ranks tools.
- **Replacing specialist judgment** — the protocol is "prefer if available", not "must use".
- **Detecting if a tool was actually invoked** — specialists may self-cite in `## Verification log`; no framework-side audit.

## Backward compatibility

- **Breaks existing `local/*` files: no** — new optional `capability-tools` key in `framework.config.yaml`; absent = default behaviour.
- Adapters without an affinity section continue working — graceful degradation, no error.
- Pre-D38 dispatch behaviour is preserved when no affinity match fires.

## Forward-only

Purely additive. No `local/` schema break (new optional key). No script changes. No test changes. Adopter action on upgrade: none required — Claude adopters get the 4 reference rows automatically; other adapters surface no affinity until the adopter or upstream populates the section.
