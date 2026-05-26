---
name: ginee-file-bug
description: File a bug report against the primary GitHub repo (the adopter's own project) via the ginee framework's GitHub-integration workflow. Use when the user asks to 'file a bug', 'report a bug', 'create a bug issue' for the current project. Drafts a structured issue using core/templates/issues/bug-report.md, surfaces the draft for approval, then creates a labelled GitHub issue.
---

# File bug — primary repo

Run the file-an-issue workflow per `.agents/ginee/core/protocols/github-integration.md § Outbound — file an issue` with target = primary repo.

## Activation

"file a bug" / "report a bug" / "create a bug issue" without mentioning framework upstream; user describes a defect to track in their own repo. Cheat sheet: `adapters/_shared/install-common.md § Skill cheat sheet`.

## Procedure

1. Load `.agents/ginee/core/protocols/github-integration.md` + `.agents/ginee/core/templates/issues/bug-report.md`.
2. Resolve target repo — `local/framework.config.yaml § github.repo` override OR `git remote get-url origin` (strip `.git`).
3. Draft body from template; populate every section from user prompt + project context.
4. **Self-lint** against `core/process.md § Mandatory checks before report-as-done` (every section incl. Summary). Surface violations as restructure suggestions in step 5; never publish failing without explicit override.
5. **Surface draft for approval** (externally visible per `core/process.md § Executing actions with care`); include self-lint findings.
6. On approval: `gh issue create` (priority) / GitHub MCP / HTTPS+token. Labels: `ready-label` from `github.ready-label` (default `ginee:ready`); auto-create label if absent.
7. Report URL + number.

## Forbidden

- Never publish silently — always surface draft first.
- Never target framework upstream — use `ginee-file-framework-bug`.
- Never edit a reporter-authored issue body (this skill creates new only).
- Skill-runner per `core/process/dispatch.md § Skill-runner — surface boundary`.
