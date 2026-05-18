---
name: ginee-file-bug
description: File a bug report against the primary GitHub repo (the adopter's own project) via the engineering-team framework's D14 workflow. Use when the user asks to 'file a bug', 'report a bug', 'create a bug issue' for the current project. Drafts a structured issue using core/templates/issues/bug-report.md, surfaces the draft for approval, then creates a labelled GitHub issue.
---

# File bug — primary repo

Run the file-an-issue workflow per `.agents/engineering-team/core/github-integration.md § Outbound — file an issue` with target = primary repo.

## Activation

- User asks to "file a bug" / "report a bug" / "create a bug issue" without mentioning the framework upstream.
- User describes a defect and explicitly wants it tracked in their own repo.

## Procedure

1. Load `.agents/engineering-team/core/github-integration.md` and `.agents/engineering-team/core/templates/issues/bug-report.md`.
2. Resolve target repo:
   - Override: `local/framework.config.yaml § github.repo`.
   - Else: `git remote get-url origin` (strip `.git`).
3. Draft the issue body from the bug-report template. Populate every section (`## Summary`, `## Steps to reproduce`, `## Expected behavior`, `## Actual behavior`, `## Affected area`, `## FR / NFR cited`, `## Acceptance criteria`, `## Reporter context`) from user prompt + project context.
4. **Surface the draft for user approval** — issues are externally visible per `.agents/engineering-team/core/process.md § Executing actions with care`.
5. On approval, create the issue:
   - Tool order: `gh issue create` first; GitHub MCP (`mcp__github__create_issue`) second; HTTPS+token third.
   - Labels: `ready-label` from `local/framework.config.yaml § github.ready-label` (default `engineering-team:ready`). PM auto-creates the label if absent.
6. Report URL + number.

## Forbidden

- Never publish silently — always surface the draft first.
- Never target the framework upstream — use `ginee-file-framework-bug` for that.
- Never edit a reporter-authored issue body (this skill only creates new issues).
