# Migration — D37: Adapter pointers auto-load `local/roles/<role>.md` as cardinal extension

**Target release:** next minor after 2026-05-24.
**Affected adopters:** every adopter on every adapter — opt-in; no breaking change.
**Closes:** [#94](https://github.com/kostiantyn-matsebora/ginee/issues/94).

## What changed

Pre-D37, a `local/roles/<cardinal>.md` file authored by an adopter to extend the cardinal charter with project-specific craft notes was **orphaned** — no adapter pointer in `adapters/_shared/agents/<role>.md` read it. The pattern was already in use in adopter projects (e.g. `local/roles/devops-engineer.md` carrying cross-OS PowerShell craft + gh-CLI probe rules + EOL safety-net) but silently broken: the dispatched subagent never loaded those rules.

D37 adds `local/roles/<role>.md` as the **final read** in every cardinal pointer's read chain — load if present; absence is a no-op. The extension augments the cardinal charter; it never replaces.

## Why

Adopter needs:

- A sanctioned place to add project-specific craft notes that **augment** (not replace) the cardinal charter without forking `core/roles/<role>.md`.
- Auto-loading so the dispatched subagent actually consumes the extension on every dispatch.
- The same load surface across every adapter, since the pointer files in `adapters/_shared/agents/` are reused by Claude / Copilot CLI / AGENTS.md / generic adapter renders.

Pre-D37 fix-shape:

- Adopter authored `local/roles/<cardinal>.md` per the documented pattern.
- Pointer file never referenced it.
- Subagent ran without the project-specific rules.
- Silent regression — nothing told the adopter the file was being ignored.

D37 fixes this with one line per shared pointer.

## Form

Each shared pointer at `adapters/_shared/agents/<role>.md` gains a final numbered read:

```
N. `.agents/ginee/local/roles/<role>.md` — project-local extension (D37 — load if present; augments this charter with project-specific craft notes; never replaces)
```

Where `N` is the next number in the role's existing read list. Examples post-D37:

| Pointer | Pre-D37 read list | Post-D37 |
|---|---|---|
| `ai-engineer.md` | 1–4 | 1–5 (5 = extension) |
| `backend-engineer.md` | 1–4 | 1–5 |
| `devops-engineer.md` | 1–4 | 1–5 |
| `frontend-engineer.md` | 1–4 | 1–5 |
| `qa-engineer.md` | 1–4 | 1–5 |
| `solution-architect.md` | 1–6 | 1–7 (7 = extension) |
| `team-lead.md` | 1–4 | 1–5 |

## Load semantics

| Condition | Behaviour |
|---|---|
| `local/roles/<role>.md` present | Loaded **after** the standard read chain. Augments charter + bindings + profile already consumed. |
| `local/roles/<role>.md` absent | No-op. Cardinal proceeds with the standard chain. No error, no warning. |
| File present but malformed (frontmatter parse error · empty body) | Subagent surfaces a one-line advisory: `"local/roles/<role>.md unreadable: <reason>; proceeding without extension."` Cardinal continues normally. |

## Conventions for `local/roles/<role>.md`

- **Frontmatter shape** same as the cardinal pointer (`name` · `description` · optional `aliases`). Tools that scan frontmatter behave consistently.
- **Body augments — never replaces.** The cardinal kernel + bindings already encode the canonical contract; the extension layers **project-specific** rules on top (stack-specific lint commands · OS-specific shell craft · domain-specific patterns · gh-CLI probe rules · etc.).
- **Existing pattern** in `local/roles/devops-engineer.md` (adopter projects authored against the documented `local/roles/` pattern) is the reference example.
- **Custom-new-role registration** — the original `local/roles/` use case — remains a separate concern. New roles still need an adapter-specific pointer entry or `team-lead` registration step. D37 covers **extension of existing cardinals**, not new-role registration.

## Decisions affected

- **D21-context-economy-gates** — watched-paths table extended. `local/roles/*.md` joins the "other watched" tier (50-line / 2 KB net-added) since extension files become always-loaded per cardinal that has one. Adopters who never author extensions see no D21 impact (file absent).
- **D25-classical-architect** — D25 established per-role doc authorship. The extension file is a natural artefact for each role to author its own project-local craft notes — same authorship principle, different file.
- **D35-process-md-load-topology** — unchanged. Extensions are always-loaded by the role's pointer; they sit outside the phase-participation contract.

## Adapter implications

| Adapter | Change | Notes |
|---|---|---|
| `claude` | Pointer files under `adapters/_shared/agents/` already host the new read line; Claude reads them on every subagent activation. | `adapters/claude/install.md § Verify` notes that local extensions auto-load when present. `adapters/claude/CLAUDE-pointer.md` clarifies dual use of `local/roles/`. |
| `agents-md` | AGENTS.md render is responsible for surfacing the new read line per role section. | Adapter installer copies the updated pointer on `update ginee`. |
| `copilot-cli` | Same — pointer files render with the new line. | Same as Claude. |
| `generic` | Pointer text appears verbatim in `INSTRUCTIONS.md`; adopter must include it. | Generic adapter is the fallback. |

## Out of scope

- **Custom-new-role registration** (the original `local/roles/` use case before this feature). Stays a separate concern — new roles still register via the per-adapter pointer entry / `team-lead` discovery flow.
- **Per-adapter overrides** beyond `_shared/agents/` — out of scope for this proposal.
- **Enforcing extension file structure** beyond frontmatter shape — adopters author extensions per their project's needs.
- **Auto-generating extension stubs** at discovery time — adopter authors them when needed.
- **Cross-cardinal extension chaining** (e.g. `local/roles/backend-engineer.md` referencing `local/roles/_shared.md`) — single-file extension only.

## Backward compatibility

- **Breaks existing `local/*` files: no** — file is read only if present; absence is a no-op.
- Adopters who already author `local/roles/<cardinal>.md` files **gain auto-loading on next upgrade** without any change on their side. This is the silent-regression fix for the use case the issue documents.
- Adopters who don't author extensions see no behavioural change.

## Forward-only

Purely additive. No `local/` schema change. No installer change. No core/roles change. No tests change. Adopter action on upgrade: none required; extensions just start working.
