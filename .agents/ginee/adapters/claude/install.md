# Claude Code adapter — install

Shared sections (skill cheat sheet · phase-file loading · model tier · updates): `adapters/_shared/install-common.md`.

## Prerequisites

- `.agents/ginee/` present at the project root.
- `.claude/agents/` directory (Claude Code creates it; create manually if absent).

## Steps

1. **Copy shared pointer subagents** — `.agents/ginee/adapters/_shared/agents/*.md` → `.claude/agents/`:

   ```powershell
   New-Item -ItemType Directory -Force .claude\agents | Out-Null
   Copy-Item .agents\ginee\adapters\_shared\agents\*.md .claude\agents\
   ```

   ```bash
   mkdir -p .claude/agents
   cp .agents/ginee/adapters/_shared/agents/*.md .claude/agents/
   ```

2. **Bridge framework skills** — Claude Code searches `.claude/skills/` (project) + `~/.claude/skills/` (global), NOT the cross-tool `.agents/skills/` path other clients accept:

   ```powershell
   New-Item -ItemType Directory -Force .claude\skills | Out-Null
   Copy-Item -Recurse .agents\ginee\core\skills\ginee-* .claude\skills\
   ```

   ```bash
   mkdir -p .claude/skills
   cp -r .agents/ginee/core/skills/ginee-* .claude/skills/
   ```

   POSIX symlinks preferred — `ln -s .agents/ginee/core/skills/ginee-* .claude/skills/` (auto-update; copies need re-running on upgrade).

3. **Update `CLAUDE.md`.** Append the block from `.agents/ginee/adapters/claude/CLAUDE-pointer.md` to the project's `CLAUDE.md` (create the file if absent).

4. **Run discovery.** Open the project in Claude Code; prompt `Run initial discovery.` (Claude auto-routes to `team-lead` via subagent description match).

5. **Verify.** Ask Claude for the status of each cardinal — each should report its charter (from `.agents/ginee/core/roles/<role>.md`) + confirm bindings + surface any `.agents/ginee/local/roles/<role>.md` extension.

## How to invoke

Claude Code has no literal `@<agent-name>` chat syntax. Three working paths:

| Path | When |
|---|---|
| **AgentSkills (recommended)** — Claude auto-activates the matching skill from `.claude/skills/ginee-*/`. Type natural language matching the description. | File / pick-up / triage / promote / discovery / reindex / address-review. |
| **Natural-language subagent dispatch** — describe what you want; Claude routes to the matching subagent via description match. | Specialist dispatches. |
| **Explicit `Task` call** — Claude uses the `Task` tool internally to spawn a subagent. | Long-running parallel work. |

Skill cheat sheet: `adapters/_shared/install-common.md § Skill cheat sheet`. Framework's `@<role>` notation is vendor-neutral shorthand.

## Specialist-tool affinity

Host capability tools the Claude Code adapter exposes. Team-lead consults this table during dispatch composition (see `core/process/dispatch.md § Host capability-tool affinity injection`) and surfaces matching tools as a one-line hint (prefer if available; never required).

| Tool | Class | Role / task affinity | Invocation hint |
|---|---|---|---|
| `frontend-design` | Skill | `frontend-engineer` authoring or modifying an HTML mockup | "use the `frontend-design` skill to author the mockup variant" |
| `code-review` | Skill | `solution-architect` Phase 7 governance · engineer self-check pre-PR | "run `code-review` on the diff before sign-off" |
| `verify` | Skill | `qa-engineer` Phase 5 manual smoke · engineer Phase 6 fix verification | "use `verify` to confirm the change works end-to-end" |
| `security-review` | Skill | NFR-security ASR coverage · `solution-architect` review on security-touching PRs | "run `security-review` against the changed surface" |

**Opt-out:** `local/framework.config.yaml § capability-tools.disabled: [<tool-id>, …]` or `capability-tools.enabled: false`. Defaults: `enabled: true`, `disabled: []`. Append rows as the ecosystem grows.

## Subagent dispatch limitation

Claude Code's `Agent` / `Task` tool is **top-level only** — subagents do not inherit it, so the standard skill-runner → `@team-lead` → specialists hand-back silently degrades on Claude (team-lead-as-subagent has no `Agent` tool). On this adapter the skill-runner boundary narrows: **decision authority** (team-lead, re-invoked each cycle) splits from **mechanical dispatch execution** (skill-runner, verbatim).

| Step | Surface |
|---|---|
| Plan drafting · synthesis · gate text · routing · defaults · `local/bindings.md` lookup | `team-lead` (re-invoked) |
| User approval of the plan | user |
| Mechanical dispatch of approved specialists (parallel where independent) · pass-through of returns | **skill-runner** (verbatim, no discretion, no synthesis) |

**Loop.** `skill-runner batch → @team-lead (plan) → user approve → skill-runner (verbatim dispatch) → collect returns → @team-lead (synthesis + next decision) → loop` until phase complete.

**Self-check.** During a skill run — mechanical op OR verbatim execution of an approved contract? → proceed. Anything else (synthesize · pick next specialist · draft reply · answer routing question) → re-invoke `@team-lead`. No "fast" / "trivial" exception; origination ban holds even when team-lead is a subagent.

## Model tier

Per `adapters/_shared/install-common.md § Model tier`. Claude exposes programmatic per-role + per-task selection — each `.claude/agents/<role>.md` ships with `model: <id>` in YAML frontmatter pre-resolved from the role's `default-tier:`. Adopter override map:

```yaml
# local/framework.config.yaml § model-tier.adapters.claude
adapters:
  claude:
    reasoning: claude-opus-4-7
    standard:  claude-sonnet-4-6
    fast:      claude-haiku-4-5-20251001
```

Re-run the installer (or `/ginee-update`) to apply overrides; the Claude branch rewrites each pointer's `model:` line. Per-task `model:<tier>` prefix routes via the `Task` tool's `model` field.

## Phase-file loading

Per `adapters/_shared/install-common.md § Phase-file loading`. Subagent source = `.claude/agents/<role>.md`. The shared pointer subagents render the contract; no per-adapter loader change required.

## Warm specialist reuse

Resume the same specialist (not fresh-spawn) on 2nd+ dispatch within one Phase 1–8 task AND within `phase-participation:` window. Typical saving: 15–50 k tokens of duplicated reload per task.

**Prerequisite.** Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (gates `SendMessage`, the resume tool):

```json
// .claude/settings.json (project) or ~/.claude/settings.json (global)
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

Env vars resolve at boot — **restart Claude Code**. Refs: `anthropics/claude-code#36196` · `#42737` · `#35240`. Organisational opt-out: `local/framework.config.yaml § warm-reuse.enabled: false` → fresh-spawn fallback.

**Architecture.** Claude `Agent` / `Task` is top-level only — warm registry cannot live in team-lead's context. Skill-runner (main thread, durable across one task) holds registry; team-lead reads it as dispatch input + writes decisions into its plan; skill-runner executes verbatim.

| Surface | Owns |
|---|---|
| skill-runner | Warm registry · team-lead bootstrap (`Agent` `run_in_background: true` + record id + `SendMessage` every later cycle) · specialist agent-id round-trip (capture on `Agent`, pass registry to team-lead, execute team-lead's `SendMessage` lines verbatim) |
| team-lead (re-invoked) | All warm-vs-fresh decisions · `mode: warm-resume \| fresh-spawn` field on every plan line · `agent-id: <id>` when `warm-resume` · forced-fresh trigger evaluation per `migrations/warm-specialist-reuse.md § Forced-fresh triggers` |

Carve-out is mechanical — skill-runner never reads `mode:` to second-guess · never picks an agent-id when team-lead omits · never spawns/releases outside an approved plan-line. Full: `migrations/warm-reuse-claude-plumbing.md`.

**Plan-line shape.** `role:` · `mode: fresh-spawn | warm-resume` · `agent-id:` (required on `warm-resume`) · standard dispatch contract + drift advisory per `migrations/warm-specialist-reuse.md § Drift advisory`. Skill-runner: `fresh-spawn` → `Agent run_in_background: true` + capture id · `warm-resume` → `SendMessage` to the named id.

**Loop.** (1) First skill-runner batch parses task + spawns team-lead via `Agent run_in_background: true` · (2) team-lead authors plan · (3) user approves (Phase 3; elided per auto) · (4) skill-runner verbatim-executes lines + captures new ids · (5) `SendMessage` team-lead with returns + updated registry · (6) repeat 2–5 until phase complete · (7) Phase 8 / abandonment → send `## Phase 8 close — release` to every recorded id; clear registry.

**Known caveats** (upstream, outside ginee's control):

| Caveat | Reference |
|---|---|
| Friendly-name `SendMessage` resume fails — raw `agent-id` only | `anthropics/claude-code#42999` |
| First resume incurs cache miss | `anthropics/claude-code#44724` |

## Compliance hooks + statusline (per playbook #135)

PreToolUse hooks under `adapters/claude/hooks/` + statusline at `adapters/claude/statusline.{ps1,sh}` gate adopter edits at the tool-call layer.

**Wiring is automatic.** `/ginee-update` invokes `core/scripts/sync-claude-settings.{ps1,sh}` to idempotently merge entries into `.claude/settings.json`. Adopter customisations preserved; re-runs no-op. Bash branch needs `jq` on PATH (warns + skips if absent).

**Manual snippet** (skip-installer adopters):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "pwsh -NoProfile -File .agents/ginee/adapters/claude/hooks/pre-tool-use-edit.ps1", "timeout": 10 }] },
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "pwsh -NoProfile -File .agents/ginee/adapters/claude/hooks/pre-tool-use-bash.ps1", "timeout": 10 }] }
    ]
  },
  "statusLine": { "type": "command", "command": "pwsh -NoProfile -File .agents/ginee/adapters/claude/statusline.ps1" }
}
```

Bash equivalents — substitute `bash .agents/ginee/adapters/claude/hooks/pre-tool-use-{edit,bash}.sh` + `bash .agents/ginee/adapters/claude/statusline.sh`.

**Edit / Write / MultiEdit (T2)** — 5 block conditions:

| # | Block | Source |
|---|---|---|
| 1 | Hot-spec edit lacking frontmatter post-edit | `core/protocols/hot-spec-format.md` |
| 2 | File > `cap-bytes` without `Optimized-By: ai-engineer` trailer | `core/protocols/doc-size-caps.md` + frontmatter |
| 3 | Edit on `core/**` introducing bare `D<N>` token | runtime D-free invariant |
| 4 | New content using `always` / `never` / `binding` / `mandatory` as rule modifier | `core/protocols/rfc2119-keywords.md` |
| 5 | Always-loaded surface bloat (> 50 lines) without `Optimized-By` trailer | context-economy gate |

**Bash (T3)** — 4 block conditions:

| # | Block | Why |
|---|---|---|
| 1 | `git commit --no-verify` (or `-n`) | Bypasses pre-commit + context-economy gate |
| 2 | `git push --force` (or `-f` / `--force-with-lease`) targeting `main` / `master` | Always block trunk history rewrites |
| 3 | `git reset --hard` | Block unless `SKIP_GINEE_COMPLIANCE=1` |
| 4 | `gh pr create` without `--body` / `--body-file` / `--draft` | Per ginee PR conventions |

**Statusline (T4)** — `[ginee] #<N> · phase: ? · warm: ? · trailer: <ok|needed> · cap: <N>%` (≤ 100 chars):

| Field | Source |
|---|---|
| `#<N>` | Current branch (`#<N>` token or `/t<N>` convention) |
| `phase: ?` · `warm: ?` | Placeholders until skill-runner-side warm-registry writes state to file |
| `trailer:` | `ok` when commit in `origin/main..HEAD` carries `Optimized-By: ai-engineer`; else `needed` |
| `cap:` | Tightest cap-bytes headroom across hot-spec files in branch diff |

**Bypass per invocation:** `SKIP_GINEE_COMPLIANCE=1`. **Opt out per tactic:** `local/framework.config.yaml § compliance.disabled: [pretooluse-edit-hook | pretooluse-bash-hook | compliance-statusline | subagent-tools-whitelist]`.

Full specs: [`migrations/pretooluse-edit-hook.md`](https://github.com/kostiantyn-matsebora/ginee/blob/main/migrations/pretooluse-edit-hook.md) · [`migrations/pretooluse-bash-hook.md`](https://github.com/kostiantyn-matsebora/ginee/blob/main/migrations/pretooluse-bash-hook.md) · [`migrations/compliance-statusline.md`](https://github.com/kostiantyn-matsebora/ginee/blob/main/migrations/compliance-statusline.md). Statusline never blocks host — uncaught errors fall back to bare `[ginee]` or no output.

## Updates

Per `adapters/_shared/install-common.md § Updates`. Claude-specific addenda:

- **`/ginee-update`** automates the CLAUDE.md pointer-block sync (Step 3 above).
- **Step-by-step path** — re-copy `_shared/agents/*.md` → `.claude/agents/`; re-copy `ginee-*` → `.claude/skills/` (skip if symlinked); replace the pointer-block body in `CLAUDE.md` between `## Engineering team framework` and the next `---`.

## Uninstall

1. Delete the 7 cardinal files from `.claude/agents/` (and any custom roles you copied).
2. Delete `.claude/skills/ginee-*` (or remove symlinks).
3. Remove the pointer block from `CLAUDE.md`.
4. Optionally delete `.agents/ginee/`.
