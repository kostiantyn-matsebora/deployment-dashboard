# Claude Code adapter — install

## Prerequisites

- `.agents/ginee/` directory present at the project root.
- `.claude/agents/` directory:
  - Claude Code creates it.
  - Create manually if absent.

## Steps

1. **Copy the shared pointer subagents** — from `.agents/ginee/adapters/_shared/agents/*.md` into `.claude/agents/`.

   ```powershell
   New-Item -ItemType Directory -Force .claude\agents | Out-Null
   Copy-Item .agents\ginee\adapters\_shared\agents\*.md .claude\agents\
   ```

   ```bash
   mkdir -p .claude/agents
   cp .agents/ginee/adapters/_shared/agents/*.md .claude/agents/
   ```

2. **Bridge the framework skills** — copy (or symlink) framework skills into `.claude/skills/` so Claude Code's skill discovery picks them up.

   Skills follow the [AgentSkills standard](https://agentskills.io). Source: `.agents/ginee/core/skills/ginee-*/`. Each is a directory containing `SKILL.md`. Per [Claude Code skills docs](https://code.claude.com/docs/en/skills), Claude Code only searches `.claude/skills/` (and `~/.claude/skills/`) at the project level — it does **not** currently honor the cross-tool `.agents/skills/` path that other clients (e.g. Copilot) accept. Once it does, this bridge can collapse.

   ```powershell
   New-Item -ItemType Directory -Force .claude\skills | Out-Null
   Copy-Item -Recurse .agents\ginee\core\skills\ginee-* .claude\skills\
   ```

   ```bash
   mkdir -p .claude/skills
   cp -r .agents/ginee/core/skills/ginee-* .claude/skills/
   ```

   Symlinks work too on POSIX shells (`ln -s .agents/ginee/core/skills/ginee-* .claude/skills/`) — preferred for auto-update; copies need re-running on upgrade.

3. **Update `CLAUDE.md`.**
   - Append the block from `.agents/ginee/adapters/claude/CLAUDE-pointer.md` to the project's `CLAUDE.md`.
   - No existing `CLAUDE.md` — create one with that block as the content.

4. **Run discovery.**
   - Open the project in Claude Code.
   - In chat, ask Claude to run initial discovery — Claude auto-routes to `team-lead` via subagent description match. Equivalent phrasings:

     ```
     Run initial discovery.
     ```
     ```
     @team-lead run initial discovery     (works in Cursor; in Claude Code @ is not literal — see "How to invoke" below)
     ```

5. **Verify.** Ask Claude for the status of each cardinal. Each should:
   - Report its charter (read from `.agents/ginee/core/roles/<role>.md`).
   - Confirm the project's bindings.
   - If a `.agents/ginee/local/roles/<role>.md` extension is present, surface its project-specific craft notes as part of the status report.

## How to invoke

Claude Code has no literal `@<agent-name>` chat syntax. Three working invocation paths (pick whichever fits the workflow):

| Path | When |
|---|---|
| **AgentSkills (recommended for framework workflows)** — Claude auto-activates the matching skill from `.claude/skills/ginee-*/`. Just type natural language matching the skill's description (e.g., "file a bug report titled X"). | File / pick-up / triage / promote / discovery / reindex. |
| **Natural-language subagent dispatch** — describe what you want; Claude routes to the matching subagent in `.claude/agents/` via description match. | Specialist dispatches (`solution-architect`, `backend-engineer`, etc.). |
| **Explicit Task call** — Claude may use the `Task` tool internally to spawn a subagent in an isolated session. No user-visible invocation; it happens automatically when delegation is warranted. | Long-running parallel work. |

Cheat sheet for the 12 framework workflows (AgentSkills auto-activates from these phrasings):

| Phrasing | Activates |
|---|---|
| "Run initial discovery" | `ginee-discovery` |
| "Rediscover the project" | `ginee-rediscover` |
| "File a bug titled X" | `ginee-file-bug` |
| "File a feature request titled X" | `ginee-file-feature` |
| "File a framework bug titled X" | `ginee-file-framework-bug` |
| "File a framework feature titled X" | `ginee-file-framework-feature` |
| "Pick up #N" / "Work on the TODO about X" / "Start on Y" | `ginee-pick-up` (unified — issues, TODO lines, freeform) |
| "Triage" / "List ready work" / "Show the backlog" / "Triage framework" / "Triage todos" | `ginee-triage` (unified — issues + framework + TODOs) |
| "Promote discussion #N" / "Promote framework discussion #N" | `ginee-promote-discussion` |
| "Reindex" / "Reindex `<file>`" / "Reindex `<class>`" / "Reconcile the index" | `ginee-reindex` |
| "Update ginee" / "Upgrade the framework" / "Bump ginee to `v<X>`" / "Pull the latest ginee" | `ginee-update` |
| "Address review on PR #N" / "Respond to review on #N" / "Handle review feedback on #N" | `ginee-address-review` |

The framework's own `core/process.md` and role kernels use `@<role>` notation as vendor-neutral shorthand — Claude Code adopters read that as "the orchestrator routes here," not as a literal command.

## Specialist-tool affinity

Host capability tools the Claude Code adapter exposes, with the role / task surfaces they help. Team-lead consults this table during dispatch composition (see `core/process/dispatch.md § Host capability-tool affinity injection`) and surfaces matching tools as a one-line hint in the dispatch prompt (prefer if available; never required).

| Tool | Class | Role / task affinity | Invocation hint |
|---|---|---|---|
| `frontend-design` | Skill | `frontend-engineer` authoring or modifying an HTML mockup | "use the `frontend-design` skill to author the mockup variant" |
| `code-review` | Skill | `solution-architect` Phase 7 governance · engineer self-check pre-PR | "run `code-review` on the diff before sign-off" |
| `verify` | Skill | `qa-engineer` Phase 5 manual smoke · engineer Phase 6 fix verification | "use `verify` to confirm the change works end-to-end" |
| `security-review` | Skill | NFR-security ASR coverage · `solution-architect` review on security-touching PRs | "run `security-review` against the changed surface" |

**Adopter opt-out** — `local/framework.config.yaml § capability-tools.disabled: [<tool-id>, …]` scopes out a specific tool while keeping the rest. `capability-tools.enabled: false` disables affinity injection repo-wide. Defaults: `enabled: true`, `disabled: []`.

**Adding more tools** — append rows to this table as the Claude Code ecosystem grows. The affinity column drives matching (`grep`-style regex against the role + task description in the dispatch contract); update the migration spec only if the matching semantics change.


## Subagent dispatch limitation

Claude Code's `Agent` / `Task` tool is **top-level only** — subagents do not inherit it, so the standard skill-runner → `@team-lead` → specialists hand-back silently degrades on Claude (team-lead-as-subagent has no `Agent` tool). On this adapter the skill-runner boundary is narrowed: split **decision authority** (team-lead, re-invoked each cycle) from **mechanical dispatch execution** (skill-runner, verbatim).

| Step | Surface |
|---|---|
| Plan drafting · synthesis · gate text · routing · defaults · `local/bindings.md` lookup | `team-lead` (re-invoked) |
| User approval of the plan | user |
| Mechanical dispatch of approved specialists (parallel where independent) · pass-through of returns | **skill-runner** (verbatim, no discretion, no synthesis) |

**Loop.** `skill-runner batch → @team-lead (plan) → user approve → skill-runner (verbatim dispatch) → collect returns → @team-lead (synthesis + next decision) → loop` until phase complete.

**Self-check before any main-thread reasoning during a skill run** — mechanical op OR verbatim execution of an approved contract? → proceed. Anything else (synthesize · pick next specialist · draft reply · answer routing question) → re-invoke `@team-lead`. No "fast" / "trivial" exception; the origination ban (skill-runner never originates orchestration) holds even when team-lead is a subagent.

## Model tier

Per-role model selection routes reasoning-heavy roles to capable models and execution-heavy roles to cheaper ones.

| Tier | Default model | Default for |
|---|---|---|
| `reasoning` | `claude-opus-4-7` | `team-lead` · `solution-architect` |
| `standard` | `claude-sonnet-4-6` | `ai-engineer` · `backend-engineer` · `frontend-engineer` · `devops-engineer` · `qa-engineer` |
| `fast` | `claude-haiku-4-5-20251001` | (none by default — opt-in for adopter-defined mechanical work) |

**Out of the box.** Each `.claude/agents/<role>.md` ships with `model: <id>` in its YAML frontmatter, pre-resolved from the role's `default-tier:` per `core/roles/<role>.md`.

**Adopter override.** Edit `local/framework.config.yaml § model-tier`:

```yaml
model-tier:
  per-role:
    ai-engineer: reasoning  # bump from standard
    qa-engineer: fast       # downshift mechanical test harness work
  adapters:
    claude:
      reasoning: claude-opus-4-7
      standard:  claude-sonnet-4-6
      fast:      claude-haiku-4-5-20251001
```

Re-run the installer (`@team-lead update` or the bootstrap one-liner with `GINEE_UPDATE_ONLY=1`) to apply overrides. The Claude branch reads the config and rewrites each pointer's `model:` line accordingly.

**Per-task prefix.** Prefix any dispatch with `model:<tier>` to override for one call (combinable with `auto:` / `branch:` / `wt:` / `commit:`). Claude routes via the `Task` tool's `model` field for that dispatch.

```
model:reasoning Add the new ASR utility-tree leaves for the latency NFR.
auto: model:fast Re-label stale issues with ginee:blocked.
```

Resolution order — stop at first match: (1) per-task prefix, (2) Phase-3 user answer, (3) `local/framework.config.yaml § model-tier.per-role.<role>`, (4) `core/roles/<role>.md` frontmatter `default-tier:`.


## Phase-file loading

The 8 lifecycle phases + orchestration content live under `core/process/` and load per-cardinal via `phase-participation:` frontmatter declared in each role kernel.

| Step | Behaviour |
|---|---|
| Read each `.claude/agents/<role>.md` frontmatter | Lift `phase-participation: [N, M, …]` |
| For each `N` in the list | Surface `.agents/ginee/core/process/phase-<N>-<name>.md` as a load reference in the rendered kernel body |
| `team-lead` only (and skill-runner main thread on `ginee-*` skill entry) | Additionally surface `.agents/ginee/core/process/dispatch.md` |
| Cardinals with empty list (`ai-engineer`) | Load no phase files; common `.agents/ginee/core/process.md` only |

Non-participating phase files are not surfaced to that role. The shared pointer subagents under `.agents/ginee/adapters/_shared/agents/*.md` render this contract; no per-adapter loader change is required on Claude (the kernel body itself cites the load paths).

## Warm specialist reuse

The same specialist is resumed (not fresh-spawned) on 2nd+ dispatch within one Phase 1–8 task AND within that role's `phase-participation:` window. Saves 15–50 k tokens of duplicated reload per task on a typical 3–5-dispatch workload.

### Prerequisite — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

Claude Code gates `SendMessage` (the resume tool) behind an experimental flag. Without it the tool is genuinely absent from the session and warm reuse silently falls back to fresh-spawn on every dispatch. Set the flag once per project (or globally) and **restart Claude Code**:

```json
// .claude/settings.json (project) or ~/.claude/settings.json (global)
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }
}
```

Env vars resolve at boot — Claude Code must restart for the change to take effect. After restart, `SendMessage` appears in the deferred-tool registry. References: `anthropics/claude-code#36196` · `#42737` · `#35240`.

Adopters who cannot enable the flag (organisational policy, etc.) set `local/framework.config.yaml § warm-reuse.enabled: false` and accept the fresh-spawn cost — team-lead falls through to the capability-less-adapter behaviour transparently.

### Architecture — skill-runner owns the plumbing; team-lead owns the decision

The Claude `Agent` / `Task` tool is top-level only — subagents do not inherit it (see `§ Subagent dispatch limitation` above). On Claude that means team-lead is itself a subagent without `Agent` / `SendMessage`, and its conversation does not survive across dispatches — so the warm registry cannot live in team-lead's context as it does on adapters where team-lead has the resume tool.

The skill-runner (main thread; durable across one Phase 1–8 task) holds the registry; team-lead reads it back as dispatch input + writes warm-vs-fresh decisions into its plan; the skill-runner executes those decisions verbatim. Decision authority is unchanged — only mechanical plumbing moves.

| Surface | Owns |
|---|---|
| skill-runner (main thread) | Warm registry holder · team-lead bootstrap (`Agent` with `run_in_background: true` on first dispatch · record team-lead agent-id · `SendMessage` to team-lead for every later cycle in the task) · specialist agent-id round-trip (capture on first `Agent` call · pass registry as input to team-lead's next dispatch · execute team-lead's `SendMessage` instructions verbatim) |
| team-lead (re-invoked via `SendMessage` each cycle) | All warm-vs-fresh decisions · `mode: warm-resume \| fresh-spawn` field on every plan line · `agent-id: <id>` on `warm-resume` lines (from the registry the skill-runner passed in) · forced-fresh trigger evaluation per `migrations/warm-specialist-reuse.md § Forced-fresh triggers` |

The carve-out is mechanical — skill-runner never reads `mode:` and second-guesses it; never picks an agent-id when team-lead omitted the field; never spawns or releases an agent outside an approved plan-line. Full boundary: `migrations/warm-reuse-claude-plumbing.md`.

### Plan-line shape

Every team-lead plan line for a dispatch carries:

- `role: <cardinal>`
- `mode: fresh-spawn` (first dispatch of `role` in the task, or any forced-fresh trigger fires) **or** `mode: warm-resume`
- `agent-id: <id>` (required when `mode: warm-resume`; absent on `fresh-spawn`)
- Standard dispatch contract — phase · scope · acceptance · drift advisory per `migrations/warm-specialist-reuse.md § Drift advisory`

Skill-runner reads the line and: `mode: fresh-spawn` → `Agent` with `run_in_background: true` + capture new agent-id into registry · `mode: warm-resume` → `SendMessage` to the named `agent-id` with the payload.

### Loop

1. **First skill-runner batch** — parse · label / sticky ops · branch ops · `Agent` `run_in_background: true` to spawn team-lead · record team-lead's agent-id · pass parsed task + registry as input.
2. **team-lead** authors the plan (per-line `mode:` + `agent-id:` as above).
3. **User approves** (Phase 3; elided per `core/automatic-mode.md` in `auto:` mode).
4. **skill-runner verbatim-executes** each plan line; captures new agent-ids into registry; updates registry.
5. **skill-runner `SendMessage`s team-lead** with collected returns + updated registry → team-lead synthesises + plans next cycle.
6. **Repeat** 2–5 until phase complete.
7. **Phase 8 acceptance / abandonment** — skill-runner sends `## Phase 8 close — release` to every recorded agent-id (including team-lead's); registry cleared.

### Known caveats

| Caveat | Reference |
|---|---|
| Friendly-name `SendMessage` resume fails — raw `agent-id` only | `anthropics/claude-code#42999` |
| First resume incurs a cache miss (the resumed agent reads its history afresh) | `anthropics/claude-code#44724` |

Both are upstream issues outside ginee's control. The registry stores raw agent-ids exclusively. The first-resume cache miss is amortised across warm-reuse savings for the rest of the task.

### Worked round-trip

```
skill-runner (Claude main thread)
  ├─ ginee-pick-up batch — parse #115; checkout branch; create dispatch-map sticky
  ├─ Agent(team-lead, run_in_background: true)            → captures team-lead-id = "tl-abc"
  ├─ SendMessage(tl-abc, "Plan Phase 4 for #115")
  │
  │  team-lead replies with plan:
  │    1. {role: backend-engineer, mode: fresh-spawn,  scope: ...}
  │    2. {role: qa-engineer,      mode: fresh-spawn,  scope: ...}
  │
  ├─ user approves
  ├─ Agent(backend-engineer, ...)                          → captures be-id = "be-xyz"
  ├─ Agent(qa-engineer, ...)                               → captures qa-id = "qa-pqr"
  ├─ (returns collected)
  ├─ SendMessage(tl-abc, "Returns + registry: {be: be-xyz, qa: qa-pqr}")
  │
  │  team-lead replies with next plan:
  │    1. {role: backend-engineer, mode: warm-resume, agent-id: be-xyz,
  │       scope: "address QA finding F-03", drift-advisory: (no drift)}
  │
  ├─ SendMessage(be-xyz, "address QA finding F-03 ...")    ← no fresh spawn; kernel + process + index reads survive
  ├─ ... loop until phase complete
  └─ Phase 8: SendMessage(tl-abc, be-xyz, qa-xyz, "## Phase 8 close — release"); registry cleared
```

### Adopter opt-out

`local/framework.config.yaml § warm-reuse.enabled: false`. Default on Claude is `true` (capability present when the env-var prerequisite is set). With `enabled: false`, every dispatch fresh-spawns — identical to capability-less-adapter behaviour.

## Updates

**Recommended — `/ginee-update`** (or "update ginee" / "upgrade the framework"). The skill fetches the installer from upstream at the target ref and drives `--update-only` for you — no local installer needed. Performs all steps below automatically, including the pointer-block sync in step 5.

**Manual fallback — bootstrap one-liner** (the installer is intentionally NOT inside `.agents/ginee/`):

```powershell
$env:GINEE_UPDATE_ONLY='1'; $env:GINEE_ADAPTER='claude'; iwr -useb https://raw.githubusercontent.com/kostiantyn-matsebora/ginee/main/install.ps1 | iex
```

```bash
GINEE_UPDATE_ONLY=1 GINEE_ADAPTER=claude bash -c "$(curl -fsSL https://raw.githubusercontent.com/kostiantyn-matsebora/ginee/main/install.sh)"
```

**Step-by-step equivalent:**

1. Re-fetch `.agents/ginee/core/` + `.agents/ginee/adapters/` + `.agents/ginee/extras/` (your `local/` survives).
2. Re-copy `.agents/ginee/adapters/_shared/agents/*.md` to `.claude/agents/` (pointers may have been refined).
3. Re-copy `.agents/ginee/core/skills/ginee-*` to `.claude/skills/` (skill bodies / descriptions may have been refined). Skip if you used symlinks in step 2 above.
4. **Re-sync the pointer block in `CLAUDE.md`** — pointer blocks evolve across releases. Find the existing block (between `## Engineering team framework` and the next `---`) and replace its body with the current `.agents/ginee/adapters/claude/CLAUDE-pointer.md` content. The installer's `-UpdateOnly` path does this automatically.
5. **For previously (pre-2026-05-18) upgrades** — run the rename migration script once:
   - `.\.agents\ginee\core\scripts\migrate-engineering-team-to-ginee.ps1` (or `.sh`).
   - Rewrites legacy `engineering-team` references under `local/*`.
   - Idempotent; safe to run on already-migrated installs.

## Uninstall

1. Delete the 7 cardinal files from `.claude/agents/` (and any custom roles you copied).
2. Delete `.claude/skills/ginee-*` (or remove the symlinks).
3. Remove the pointer block from `CLAUDE.md`.
4. Optionally delete `.agents/ginee/`.
