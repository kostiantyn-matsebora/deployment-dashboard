---
audience: all-cardinals
load: always
triggers: []
cap-bytes: 18432
reads-before-applying: []
---

# Engineering Process

## Purpose

- Generic, project-agnostic process model for a small multi-agent engineering team.
- Authoritative spec for every role.
- **Project-specific knowledge lives in `local/bindings.md` + `local/project-profile.md`** — never in this file (stack · repo layout · role roster · forbidden role-crossings · owned-paths bindings).

## Reading order

| File | Role | Owner |
|---|---|---|
| `core/process.md` (this file) | Common process — principles · doc style · reporting · load-on-demand index | framework |
| `core/process/phase-<N>-<name>.md` | One per lifecycle phase (1–8); load only phases in this role's `phase-participation:` | framework |
| `core/process/dispatch.md` | Orchestration — skill-runner boundary · dispatch · parallelism · automatic mode · task model · cross-domain mapping | framework |
| `core/roles/*.md` | Generic role charters (7 cardinals) — `phase-participation:` declares phase loads | framework |
| `local/bindings.md` | Per-project role → owned paths/concerns | adopter |
| `local/project-profile.md` | Per-project stack · domain · architecture artefacts | adopter (`team-lead` writes on discovery) |
| `local/framework.config.yaml` | Concept → file-path mapping (architecture doc · mockup · API contract · ADR dir · TODO file) | adopter |

**Conflict resolution.** Per-project routing → `local/bindings.md` wins. Generic process rule → `core/process.md` (or relevant `core/process/<file>.md`) wins. Bindings may NOT override generic process.

**Invocation.** Spec uses `@<role>` as vendor-neutral shorthand for "dispatch to that role". Literal `@<agent>` works on some clients (Cursor) but not others (Claude). Per-client surfaces (AgentSkills · natural-language routing) ship via adapters — `adapters/<x>/install.md § How to invoke`. Framework workflows auto-activate as Skills in any AgentSkills-capable client; specialist dispatches route via subagent description match.

## Lifecycle — load topology

- 8 phases, one file each (`core/process/phase-<N>-<name>.md`) declaring Goal + Acceptance.
- Specialists within a phase run in parallel; phases overlap wherever a contract surface decouples them.
- Per-role loading via `phase-participation:` frontmatter — `team-lead [1-8]` · `solution-architect [1, 2, 4, 5, 6, 7]` · backend / frontend / devops [2, 4, 5, 6] · `qa-engineer [5, 6]` · `ai-engineer []` (between-phase).
- Orchestration (`core/process/dispatch.md`) loaded by `team-lead` always + skill-runner main thread on `ginee-*` skill entry; other cardinals do NOT load.

## Engineering principles — apply across all roles

### Configuration vs. data — declarative over imperative

Binds every role. Signal a value belongs in a declarative file: "hard to change without editing imperative code".

- **Configuration** (URLs · ports · env vars · flags · retention windows · defaults) lives in declarative files per tier; never as literals inside controllers / components / scripts / test specs.

  | Tier | File |
  |---|---|
  | Service runtime | Environment file / app-settings config |
  | Client runtime | Environment file / build-config |
  | Container orchestration | `docker-compose.*.yml` / Helm values |
  | IaC | `*.tfvars` / Pulumi config / etc. |
  | Scripting / tooling | `*.json` / `*.yaml` config files |

- **Data** (fixtures · seed sets · snapshot baselines · expected payloads · scenarios) lives in dedicated declarative files; never inline literals in test code.
- **Imperative code stays thin** — scripts / runners / wrappers read declarative files + call the underlying tool; exceptions require a doc update before they land.

### Test oracles can be wrong

- A passing test against broken software is a defect in the oracle, not a green light.
- Test results contradicting observed behaviour → trust observed behaviour; route to the test owner to tighten the assertion.
- Weak-oracle examples — harness anchored to wrapper not inner element · POST asserting status without response shape · UI element opened without exercising its action.
- Tightening is `qa-engineer`'s job; respecting the signal is everyone's.

## Documentation style — structure over prose

**Binding** for framework-self-dev (per `CLAUDE.md § Framework authoring`) + adopter outputs by any role. Protocol + 6 paired examples + discovery-driven enforcement: `core/protocols/doc-authoring-protocol.md`. Scope: project-instruction files · role definitions · skills · architecture doc + mockup + ADRs · per-component READMEs · GitHub issue bodies via `ginee-file-*` · framework-authored GitHub comments (Phase-transition · sticky `ginee:score` / `ginee:review-cycle` · audit comments · review-replies).

| Rule | Application |
|---|---|
| **Default to structure** | Bullets · numbered lists · tables · headings — not prose paragraphs. |
| **Steps / actions / instructions** | Bullet list; never a multi-sentence paragraph. |
| **Pairs · mappings · choices** | Table (`Before/After` · `concern→owner` · `endpoint→status`). |
| **One idea per bullet** | A bullet wanting 3 sentences → promote to sub-list or table. |
| **Headings carry weight** | `##` / `###` to chunk; never bury rules in prose. |
| **Code shapes** | Fenced code blocks — wire formats · env vars · paths · commands. |
| **Cross-reference** | Cite section (`per architecture-doc §X`); don't restate. |
| **Drop filler** | No "It is important to note…", "Please ensure…", "In general…". Lead with verb/noun. |
| **Prose** | Narrative exposition only (explaining *why*); keep tight. |
| **Framework-self-dev gate** | `scripts/context-economy-check.ps1` (Claude Code hook + git hooks + CI). Threshold breach without `Optimized-By: ai-engineer` trailer fails the gate. |
| **Per-class doc size caps** | ADR 4 KB · CR 6 KB · UI 4 KB (override per `local/framework.config.yaml § doc-size-caps`). Same trailer bypass. Full: `core/protocols/doc-size-caps.md`. |

### Default-shape map

| Artefact | Shape |
|---|---|
| Component / service / image / endpoint / env-var inventory | Table |
| Design properties · invariants · NFRs | Bullet list — one rule per bullet |
| Sequence / workflow / runbook steps | Numbered list |
| Term definitions | `**Term.** Gloss.` lines |
| Trade-off / decision-rationale | Two-column table (option / consequence) |
| Narrative *why* (rationale only) | Prose — tight, < 4 sentences |

### Mandatory checks before report-as-done

1. No paragraph contains > 2 rules (sentence terminators: `. ` `! ` `? `).
2. No table cell holds a multi-sentence sub-paragraph.
3. No bullet runs > 25 words unless it carries nested sub-bullets.
4. Inventories (services · components · endpoints · env vars) are tables, not prose.
5. Cross-references cite anchors (`§Name`, `#anchor`); cite rules by file path + section, not opaque identifier.
6. Binding-strength signal uses RFC 2119 — MUST · MUST NOT · SHOULD · SHOULD NOT · MAY. Never `always` / `never` / `binding` / `mandatory` / `required` as modifiers. Imperative inside numbered procedures is implicitly MUST.

**Enforcement + attestation:** `core/protocols/doc-authoring-protocol.md` (load at Phase 5 / report-as-done). **Paired bad/good examples:** `core/protocols/doc-authoring-examples.md` (load on first-time authoring).

## Reporting — schema-bound

Every cardinal-dispatch return is schema-bound per `core/templates/phase-report.md`. Same machinery as doc-authoring, scoped to the subagent-return surface.

- **Mandatory sections** — `## Files touched` · `## Decisions made` · `## Verification log` · `## Open issues` · `## Next dispatch needed` · `## Source reads (this dispatch)`. Empty: `(none)`. `## Hand-off` on forced-handoff. `## Stop-state` when `Status: In-progress`. `## Time spent` in sub-issue mode.
- **Optional** `## Notes` for narrative rationale (≤ 200 words; code-snippet ≤ 5 lines).
- **Forbidden** — narrative preamble · restated dispatch context · code snippets outside the carve-out · verbose rationale outside Notes · parenthetical comma-soup.
- **Self-lint** — 6 mandatory checks + "no narrative preamble" (7 total); LLM self-review. No external linter.
- **Mandatory marker** — every return ends with literal `<!-- self-lint: pass -->`. Absence = advisory only; orchestrator consumes the return + carries the rule forward.
- **Orchestrator on non-compliance** — one-line advisory · consume · never re-dispatch for format · never auto-rewrite · skill-runner forbidden from cleanup per `core/process/dispatch.md`.

Full schema: `core/templates/phase-report.md`.

## Change governance — pre-authorship gating

CR (requirement / scope change) + ADR (architectural decision) authorship gated BEFORE drafting; skip → doc never drafted. Ownership: `team-lead` owns CRs · `solution-architect` owns ADRs (per `core/protocols/doc-roles.md § Authorship`).

| Surface | Gate-branch table |
|---|---|
| CR (team-lead) | `core/roles/team-lead.md § CR-gate` |
| ADR (solution-architect) | `core/roles/solution-architect.md § ADR-gate` |

Both resolve against `local/framework.config.yaml § change-governance` + per-task prefixes (`core/process/dispatch.md § Per-task prefix grammar`); skip-reasons log under `## Decisions made` per per-role enum.

## Coordination protocol

| Trigger | Rule |
|---|---|
| Any PR | Cite requirement / NFR / architecture-doc section / mockup section implemented or validated. Template: `core/templates/pr-description.md`. |
| Wire-contract breaking change (API shape · event format · env-var names) | Flag in PR title. Service owner + client owner + `devops-engineer` confirm before merge. |
| Cost-relevant change (new resource · larger SKU) | Fresh estimate vs cost cap in PR description. `devops-engineer` owns. |

### Load-on-demand specs

Each spec carries its own load triggers in frontmatter. Default short tasks load none.

| Spec | Full file | Loaded by |
|---|---|---|
| Project-doc + code-derived index | `core/protocols/index-protocol.md` (`.idx` grammar: `core/protocols/index-syntax.md`) | `team-lead` (discovery / rediscover / SHA drift) · `ai-engineer` (extract / re-extract) · role's index lookup needing the protocol contract (rare) |
| GitHub integration · Triage scoring · Post-task check-in | `core/protocols/github-integration.md` · `core/protocols/triage-scoring.md` · `core/protocols/post-task-check-in.md` (team-lead-only — see `core/process/dispatch.md § Team-lead-only load-on-demand specs`) | `team-lead` + skill-runner main thread on `ginee-*` skill entry |
| Delivery modes — branch+PR / wt / commit-no-push | `core/protocols/delivery-modes.md` | `team-lead` (resolve mode pre-dispatch) · specialist Phase 4 commit cadence · Phase 8 finalize · auto-mode handoff Accept |
| Doc roles — author owns semantics; ai-engineer owns shape | `core/protocols/doc-roles.md` | new role-owned doc · doc past size threshold · cross-ref repair after split · structure dispute |
| Iteration protocol — propose → review → implement | `core/protocols/iteration-protocol.md` | Phase 4–7 dispatch > 15 min · doc-roles pass · user-supplied timeframe |
| Cross-domain bugs — 2+ domains | `core/protocols/cross-domain-bugs.md` | cross-domain bug detected. Lifecycle mapping: `core/process/dispatch.md § Relation to the cross-domain bugs cycle`. |
| Cross-agent handoff — diagnose ≠ fix | `core/protocols/cross-agent-handoff.md` | specialist final report flags root cause outside their domain |

#### Strict-domain rule — no specialist works outside its domain

- Bug in domain X is fixed by the engineer who owns X — never by an adjacent specialist "while they're in the area". Cross-domain bugs require collaboration, not single-specialist heroics.
- Project-specific forbidden role-crossings: `local/bindings.md § Project role boundaries`. Each row is a hard stop; propose a hand-off in the final report.
- **Size is not an exemption.** "5-min fix" / "tiny tweak" does not override surface ownership. Dispatch the owning specialist; if scope is ≤ 15 min, flag explicitly so iteration-protocol load is skipped.
- Regression-grade failure modes: `team-lead.details.md § Common failure modes`.

