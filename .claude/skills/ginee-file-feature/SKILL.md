---
name: ginee-file-feature
description: File a feature request against the primary GitHub repo (the adopter's own project) via the ginee framework's GitHub-integration workflow. Use when the user asks to 'file a feature', 'request a feature', 'create a feature request' for the current project. Drafts a structured issue using core/templates/issues/feature-request.md, surfaces the draft for approval, then creates a labelled GitHub issue.
---

# File feature — primary repo

Run the file-an-issue workflow per `.agents/ginee/core/github-integration.md § Outbound — file an issue` with target = primary repo, template = feature-request.

## Activation

- User asks to "file a feature" / "request a feature" / "create a feature request" without mentioning the framework upstream.
- User describes new functionality and wants it tracked.

## Procedure

1. Load `.agents/ginee/core/github-integration.md` and `.agents/ginee/core/templates/issues/feature-request.md`.
2. Resolve target repo (same as `ginee-file-bug`).
3. Draft the body from the feature-request template. Populate `## Summary`, `## Motivation`, `## Proposed behavior`, `## Affected area`, `## FR / NFR`, `## Acceptance criteria`, `## Out of scope`, `## References` from user prompt + project context. Present multiple design options when the user requested ideas / alternatives.
4. **Self-lint the draft** against `.agents/ginee/core/process.md § Mandatory checks before report-as-done` — **every section, including Summary**. Catch: prose paragraphs > 2 sentence terminators · comma-separated inventories (incl. parenthetical lists) · multi-rule single-line statements · inventories not rendered as tables.
5. **Surface the draft for user approval.** Include any self-lint findings + proposed restructure as part of the approval prompt.
6. On approval, create the issue with `ready-label`. Tool priority: gh CLI → GitHub MCP → HTTPS.
7. Report URL + number.

## Forbidden

- Never publish silently.
- Never target the framework upstream — use `ginee-file-framework-feature`.
- Never pre-commit to one design approach when the user asked for ideas — present alternatives in `## Proposed behavior`.
