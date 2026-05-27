---
name: ginee-file-feature
description: File a feature request against the primary GitHub repo (the adopter's own project) via the ginee framework's GitHub-integration workflow. Use when the user asks to 'file a feature', 'request a feature', 'create a feature request' for the current project. Drafts a structured issue using core/templates/issues/feature-request.md, surfaces the draft for approval, then creates a labelled GitHub issue.
---

# File feature — primary repo

Run the file-an-issue workflow per `.agents/ginee/core/protocols/github-integration.md § Outbound — file an issue` with target = primary repo, template = feature-request.

## Activation

"file a feature" / "request a feature" / "create a feature request" for the current project. Cheat sheet: `adapters/_shared/install-common.md § Skill cheat sheet`.

## Procedure

1. Load `.agents/ginee/core/protocols/github-integration.md` + `.agents/ginee/core/templates/issues/feature-request.md`.
2. Resolve target repo (same as `ginee-file-bug`).
3. Draft body from template; populate all sections from user prompt + project context. Present alternatives when user requested ideas.
4. **Self-lint** against `core/process.md § Mandatory checks` + `core/protocols/doc-authoring-protocol.md § Audience check` (every section incl. Summary) — title outcome-shaped · 2-4 sentence human Summary · framework-internal sections after Summary · forbidden-identifier list scrubbed from title.
5. **Surface draft for approval**; include self-lint findings.
6. On approval: `gh issue create` (priority) / GitHub MCP / HTTPS+token. Label: `ready-label`; auto-create if absent.
7. Report URL + number.

## Forbidden

- Never publish silently.
- Never target framework upstream — use `ginee-file-framework-feature`.
- Never pre-commit to one design when user asked for ideas — present alternatives in `## Proposed behavior`.
- Skill-runner per `core/process/dispatch.md § Skill-runner — surface boundary`.
