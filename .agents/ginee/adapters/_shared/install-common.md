# Adapter install — shared sections

Common content cited by every per-adapter `install.md`. Each adapter overrides only adapter-specific specifics (subagent path · skill-discovery path · subagent-tool affinity · warm-reuse availability · compliance hooks).

## Skill cheat sheet

Every adapter that supports the AgentSkills standard exposes the same workflow phrasings. The skill auto-activates on description match:

| Phrasing | Activates |
|---|---|
| "Run initial discovery" | `ginee-discovery` |
| "Rediscover the project" | `ginee-rediscover` |
| "File a bug titled X" | `ginee-file-bug` |
| "File a feature request titled X" | `ginee-file-feature` |
| "File a framework bug titled X" | `ginee-file-framework-bug` |
| "File a framework feature titled X" | `ginee-file-framework-feature` |
| "Pick up #N" / "Work on the TODO about X" / "Start on Y" | `ginee-pick-up` (unified — issues · TODO lines · freeform) |
| "Triage" / "List ready work" / "Show the backlog" / "Triage framework" / "Triage todos" | `ginee-triage` (unified) |
| "Promote discussion #N" / "Promote framework discussion #N" | `ginee-promote-discussion` |
| "Reindex" / "Reindex `<file>`" / "Reindex `<class>`" / "Reconcile the index" | `ginee-reindex` |
| "Update ginee" / "Upgrade the framework" / "Bump ginee to `v<X>`" / "Pull the latest ginee" | `ginee-update` |
| "Address review on PR #N" / "Respond to review on #N" / "Handle review feedback on #N" | `ginee-address-review` |

Framework's `@<role>` notation in `core/*` docs is vendor-neutral shorthand; per-client realisation differs (literal `@` on Cursor; natural-language dispatch on Claude / Codex / Gemini / generic).

## Phase-file loading

Phase files under `core/process/` load per-cardinal via `phase-participation:` frontmatter declared in each role kernel.

| Step | Behaviour |
|---|---|
| Read each subagent / pointer frontmatter | Lift `phase-participation: [N, M, …]` |
| For each `N` in the list | Cite `.agents/ginee/core/process/phase-<N>-<name>.md` in that role's load section |
| `team-lead` only (and skill-runner main thread on `ginee-*` skill entry) | Additionally cite `.agents/ginee/core/process/dispatch.md` |
| Empty list (`ai-engineer`) | Load no phase files; common `core/process.md` only |

Non-participating phase files are never surfaced to a role.

## Model tier

Per-role model routes reasoning-heavy roles to capable models and execution-heavy roles to cheaper ones. Tier names are vendor-neutral in `core/`; concrete model IDs live in the per-adapter map in `local/framework.config.yaml § model-tier.adapters.<adapter>`.

| Tier | Default for |
|---|---|
| `reasoning` | `team-lead` · `solution-architect` |
| `standard` | `ai-engineer` · `backend-engineer` · `frontend-engineer` · `devops-engineer` · `qa-engineer` |
| `fast` | (none by default — opt-in for adopter-defined mechanical work) |

**Resolution per dispatch** (stop at first match):

1. Per-task prefix `model:<tier>` on the dispatch line.
2. Phase-3 user answer.
3. `local/framework.config.yaml § model-tier.per-role.<role>`.
4. `core/roles/<role>.md` frontmatter `default-tier:`.

Adapters where the host doesn't expose programmatic per-role model selection (agents-md baseline · copilot-cli · generic) treat the field as a documented user-facing hint; the install step writes a vendor-neutral tier into the role pointer regardless, ready for when host capability lands.

## Updates

**Recommended.** `/ginee-update` (or "update ginee" / "upgrade the framework"). The skill fetches the installer from upstream at the target ref and drives `--update-only`. Performs every adapter-specific copy / sync step automatically.

**Manual fallback — bootstrap one-liner** (installer is intentionally NOT inside `.agents/ginee/`):

```powershell
$env:GINEE_UPDATE_ONLY='1'; $env:GINEE_ADAPTER='<adapter-id>'; iwr -useb https://raw.githubusercontent.com/kostiantyn-matsebora/ginee/main/install.ps1 | iex
```

```bash
GINEE_UPDATE_ONLY=1 GINEE_ADAPTER=<adapter-id> bash -c "$(curl -fsSL https://raw.githubusercontent.com/kostiantyn-matsebora/ginee/main/install.sh)"
```

Substitute `<adapter-id>` ∈ `claude` · `agents-md` · `copilot-cli` · `generic`.

**Step-by-step equivalent** (when bypassing the installer):

1. Re-fetch `.agents/ginee/core/` + `.agents/ginee/adapters/` + `.agents/ginee/extras/` (your `local/` survives).
2. Re-run the adapter-specific copy step (subagent pointers · skills · CLAUDE.md pointer-block · etc.) — see the adapter's own `install.md § Steps`.
3. **Pre-2026-05-18 upgrades only.** Run `core/scripts/migrate-engineering-team-to-ginee.{ps1,sh}` once. Rewrites legacy `engineering-team` references under `local/*`. Idempotent.
