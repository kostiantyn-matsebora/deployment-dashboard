# Orchestration — dispatch, skill-runner, automatic mode, task model

**Load triggers** — `team-lead` (always; orchestration is its surface) · skill-runner main thread on entry to any `ginee-*` skill body (per D28-skill-runner-boundary). Other cardinals do NOT load this file.

## Skill-runner — surface boundary (D28-skill-runner-boundary)

**Skill-runner.** Thin mechanical surface running a `ginee-*` skill body (Claude main thread · Cursor main loop · Copilot CLI main loop · AGENTS.md-driven shell). Not a role; not an orchestrator.

| Op | Surface |
|---|---|
| Parse prompt + identify task source · label / sticky / audit-comment ops · branch ops per resolved mode · **one** named first-batch dispatch · report mechanical result | skill-runner (allowed) |
| Plan drafting · synthesis of parallel returns · Phase 3/7/8 gate text · re-dispatch · routing reconciliation · default selection · `local/bindings.md` lookup to settle routing | **dispatch `@team-lead`** (forbidden in skill-runner) |

**Hand-back rule.** Every `ginee-*` skill dispatches `@team-lead` after its first mechanical batch; from the second decision onwards every orchestration decision flows through team-lead; mid-flight routing / governance question from user → skill-runner dispatches `@team-lead`, never answers by reading project files.

**Self-check before main-thread reasoning during a skill run.** Ask: *"Mechanical op in the allowed row, or orchestration decision?"* Latter → dispatch `@team-lead`. No "fast" / "trivial" exception.

**D29-strict-subagent-return-schema / D33-d29-enforcement-hardening interaction — never "clean up" a non-compliant return.** When a cardinal return arrives missing the `<!-- D29 self-lint: pass -->` marker or otherwise breaching the schema, the skill-runner forwards it as-is. Restructuring the return into a tidier summary table before passing it to team-lead crosses the D28 boundary (synthesis is team-lead's surface). Surface the one-line advisory per `core/templates/phase-report.md § Orchestrator behaviour on non-compliant returns`; never auto-rewrite.

**Worked counter-example + full procedure shape:** `core/MIGRATIONS/D28-skill-runner-boundary.md` + `core/roles/team-lead.details.md § Common failure modes`.

**Adapter-specific carve-out (D32-claude-adapter-subagent-dispatch).** On the **Claude Code adapter** subagents do not inherit the `Agent` / `Task` tool, so team-lead-as-subagent cannot fan out further. The skill-runner there additionally executes team-lead's user-approved dispatch contract **verbatim** (mechanical-only — no synthesis, no routing, no defaults), then re-invokes team-lead with the collected returns. Decision authority is unchanged — team-lead still owns every plan / synthesis / next-decision. Other adapters honour the original D28 rule. Full spec: `core/MIGRATIONS/D32-claude-adapter-subagent-dispatch.md` + `adapters/claude/install.md § Subagent dispatch limitation (D32)`.

## Dispatch & parallelism rules

| Rule | Action |
|---|---|
| Independent work (no shared contract change) | Dispatch specialists in parallel in ONE message. |
| N independent specialists in one phase | ONE message with N dispatch calls. Never serialize across messages. |
| Cross-phase overlap (e.g. quality authoring tests while client implements) | ONE message with all overlapping specialists; each prompt names the shared contract surface (architecture-doc §X, mockup behaviour Y, wire shape Z). |
| Parallel-by-default for cross-domain Phase 2 | Default for Phase 2 of the cross-domain cycle is parallel. Justify any sequential Phase 2 dispatch in the dispatch prompt itself (one sentence). Habitual serialization is the failure mode. |
| Doc-only changes | `solution-architect` only (architecture-family) or mockup-owning role only (UI-only edit with no architecture implication). |
| Infrastructure changes affecting application config (env var, secret, endpoint URL) | Coordinate `devops-engineer` + affected service-owning role; service-owner first to confirm the app reads the new value, devops second. |
| Surface owns the dispatch decision | Routing is determined by the touched surface per `local/bindings.md` — never by estimated task size. "Looks fast" is not grounds to self-execute or assign to a non-owning role. |
| Warm specialist reuse (D36-warm-specialist-reuse) | On 2nd+ dispatch of the same role within the same task AND within that role's `phase-participation:` window, resume the existing specialist via the adapter's native mechanism instead of fresh-spawning. Team-lead maintains an in-conversation warm registry per task; clears on Phase 8 acceptance or abandonment. Forced-fresh on stale state · worktree mismatch · `local/*` drift · explicit `fresh:` prefix · resume-failure. Adapters lacking a resume mechanism fall back to fresh-spawn (no behavioural change). Full spec: `core/MIGRATIONS/D36-warm-specialist-reuse.md`. |
| Host capability-tool affinity injection (D38-host-capability-tools) | Before drafting any specialist dispatch, team-lead reads the active adapter's `install.md § Specialist-tool affinity` table (once per task; cached). For each tool whose `Role / task affinity` column matches the dispatched role + task surface, team-lead appends a one-line hint to the dispatch prompt: `Available capability tool: <tool-id> — <invocation-hint>. Use if it fits the work; never required.` Multiple matches → one hint each; zero matches → no hint section. Adapter without an affinity section → silently skip. Adopter opt-out via `local/framework.config.yaml § capability-tools.disabled: [<tool-id>, …]`. Specialist judgment never overruled — protocol is *prefer if available*, not *must use*. Full spec: `core/MIGRATIONS/D38-host-capability-tools.md`. |

**Per-task model tier (D31-model-tier).** Each dispatch resolves a `<tier>` (`reasoning` / `standard` / `fast`); adapters translate tiers → vendor-specific model IDs. Resolution order — stop at first match:

1. Per-task prefix `model:<tier>` in the dispatch line (combinable with `auto:` / `branch:` / `wt:` / `commit:`).
2. Phase-3 user answer.
3. `local/framework.config.yaml § model-tier.per-role.<role>`.
4. `core/roles/<role>.md` frontmatter `default-tier:`.

Full spec: `core/MIGRATIONS/D31-model-tier.md` (load-on-demand).

**Overlap patterns** — next phase starts when its contract surface is fixed, not when prior phase's code lands:

- **Test authoring overlaps implementation.**
  - Trigger: Phase 2 fixes wire shape / mockup behaviour.
  - `qa-engineer` authors specs and fixtures in parallel with implementation.
  - Both reference the contract — not each other's source.
- **Bug fix overlaps continued testing.**
  - QA reports a defect.
  - Owning engineer fixes immediately.
  - QA continues exercising other scenarios in parallel.
- **Doc update overlaps implementation.**
  - `solution-architect` hands engineers the contract context.
  - Engineers proceed.
  - SA updates architecture doc / project-instruction files / ADRs in parallel.
  - The doc commit is a paper trail, not a gate.

## Automatic mode

- **Trigger.** Task prefixed `auto:`, OR `team-lead`-proposed and user-accepted.
- **Effect.** Lifecycle runs end-to-end without per-phase user gates; presents a single final delivery handoff.
- **Default.** Interactive (no auto mode).
- **Full definition** — activation triggers, gates elided/respected, forced-interactive triggers, delivery handoff procedure: `core/automatic-mode.md`. `team-lead` loads on activation.
- **Invariant preserved.** Phase 8 user-approval = the single delivery-handoff gate.

## Task model

Phase 1–8 applies to any task. A task originates from one of four sources:

| Source | Scope | State mechanic |
|---|---|---|
| Repo-root `TODO` (file name per `local/framework.config.yaml` → `todo`) | Project-wide | Glyphs `☐` / `☒`; orchestrator updates the line on completion |
| Nested `TODO` (e.g., `client/TODO`, `service/api/TODO`) | Component-scoped | Same glyph mechanic, scoped to that component file |
| Direct user instruction | Ad hoc; scope inferred from the instruction | No `TODO` file; no glyph mechanic |
| GitHub issue (per `local/framework.config.yaml § github.repo`) | Project-wide; routed via `## Affected area` field in issue body | Native `open`/`closed` + configurable labels (`ginee:ready` / `:in-progress` / `:blocked`); PM swaps labels per phase; closes on Phase 8 acceptance. Full spec: `core/github-integration.md`. |

**TODO file rules.**

- User-curated at any location — never auto-generated, never auto-extended.
- Glyphs:
  - `☐` = open.
  - `☒` = completed.
- Optional priority marker `[v:H c:L]` between glyph and description (H / M / L, case-insensitive); ranked by `ginee-triage` per `core/triage-scoring.md`.

**GitHub issue rules.**

- Reporter-authored (user or anyone with repo access) — never auto-created without explicit user approval.
- Pickup is always explicit (`@team-lead pick up #<N>` / `triage`). Never auto-picked on session start.
- Issue body is reporter-owned; PM may add comments + swap framework labels but does not edit the body.
- PR descriptions for issue-sourced tasks include `Closes #<N>` so GitHub auto-closes the issue on merge.
- Priority signals via `value:high|medium|low` + `complexity:high|medium|low` labels (ATAM convention); ranked by `ginee-triage` per `core/triage-scoring.md`.

## Team-lead-only load-on-demand specs

The kernel summaries below are orchestration-only — relocated from `core/process.md § Load-on-demand specs` because the load triggers are all team-lead-driven. Specialists never load this file, so they never pay for these summaries; cross-references from specialist outputs resolve directly to the full-spec paths.

### GitHub integration — issues + discussions

- `team-lead` files / picks up / triages / closes GitHub issues as a task source alongside TODO files + direct instructions; promotes discussions to issues on user request; threads phase progress as issue comments; links resulting PRs via `Closes #N`.
- Full spec — tool surface (gh CLI / MCP / HTTPS) · repo discovery (origin inference + override) · label scheme · state mapping · outbound/inbound/triage/promote workflows · forbidden actions: **`core/github-integration.md`**.
- **Load triggers:** `team-lead` dispatched to file (`file bug` / `file feature`) · pick up / triage (`pick up #<N>` / `triage`) · promote (`promote discussion #<N>`) · specialist posts phase-transition progress on a tracking issue mid-task.

### Triage scoring — value × complexity priority

- `ginee-triage` ranks ready work by `score = value / complexity` (default WSJF formula; `H=3, M=2, L=1`).
- Two label namespaces (ATAM convention): `value:high|medium|low` + `complexity:high|medium|low`; TODO equivalent `☐ [v:H c:L] …`.
- On pickup: `team-lead` asks user (H/M/L) for missing `value`; dispatches `solution-architect` for missing `complexity`.
- Full spec (axes · formula · label provisioning · auto-estimate hook · TODO parser · sort contract · adopter overrides): **`core/triage-scoring.md`**.
- **Load triggers:** `team-lead` runs `triage` and needs the sort contract · `team-lead` picks up an issue and needs to evaluate / record scoring labels · `ginee-triage` / `ginee-pick-up` skills sort or auto-estimate.

### Post-task check-in

- After every completed user request, orchestrator runs a check-in: pick next pending TODO item, ask the user a fixed set of options, mark `☐` → `☒` on Yes.
- Full procedure (4-step check-in · TODO option tables · cross-cutting rules · nested-TODO discovery): **`core/post-task-check-in.md`**.
- **Load triggers:** a user request just completed (work delivered or question answered) · Phase 8 user-approval is about to fire (interactive mode), OR delivery handoff Accept fires (auto mode). Mid-task turns do not load this file.

## Relation to the cross-domain bugs cycle

- Source: `core/cross-domain-bugs.md` — specific instantiation of the lifecycle for bugs cutting across 2+ domains.
- **Phase mapping:**

  | Cross-domain phase | Lifecycle phase |
  |---|---|
  | 1 — contract change | 2 (design) |
  | 2 — domain implementations | 4 (implementation) |
  | 3 — integration + bug fixing | 5–6 (test + fix) |
  | 4 — compliance review | 7 (SA review) |

- Lifecycle Phase 3 (design review) still applies when the bug requires user-visible behaviour change.
