---
name: ginee-file-bug
description: File a bug report against the primary GitHub repo (the adopter's own project) via the ginee framework's D14 workflow. Use when the user asks to 'file a bug', 'report a bug', 'create a bug issue' for the current project. Drafts a structured issue using core/templates/issues/bug-report.md, surfaces the draft for approval, then creates a labelled GitHub issue.
---

# File bug — primary repo

Run the file-an-issue workflow per `.agents/ginee/core/github-integration.md § Outbound — file an issue` with target = primary repo.

## Activation

- User asks to "file a bug" / "report a bug" / "create a bug issue" without mentioning the framework upstream.
- User describes a defect and explicitly wants it tracked in their own repo.

## Procedure

1. Load `.agents/ginee/core/github-integration.md` and `.agents/ginee/core/templates/issues/bug-report.md`.
2. Resolve target repo:
   - Override: `local/framework.config.yaml § github.repo`.
   - Else: `git remote get-url origin` (strip `.git`).
3. Draft the issue body from the bug-report template. Populate every section (`## Summary`, `## Steps to reproduce`, `## Expected behavior`, `## Actual behavior`, `## Affected area`, `## FR / NFR cited`, `## Acceptance criteria`, `## Reporter context`) from user prompt + project context.
4. **Self-lint the draft (D26)** against `.agents/ginee/core/process.md § Mandatory checks before report-as-done` — **every section, including Summary**. Catch: prose paragraphs > 2 sentence terminators · comma-separated inventories (incl. parenthetical lists) · multi-rule single-line statements · inventories not rendered as tables. Surface violations as restructure suggestions in step 5; never publish a body that fails self-lint without explicit user override.
5. **Surface the draft for user approval** — issues are externally visible per `.agents/ginee/core/process.md § Executing actions with care`. Include any self-lint findings + proposed restructure as part of the approval prompt.
6. On approval, create the issue:
   - Tool order: `gh issue create` first; GitHub MCP (`mcp__github__create_issue`) second; HTTPS+token third.
   - Labels: `ready-label` from `local/framework.config.yaml § github.ready-label` (default `ginee:ready`). PM auto-creates the label if absent.
7. Report URL + number.

## Forbidden

- Never publish silently — always surface the draft first.
- Never target the framework upstream — use `ginee-file-framework-bug` for that.
- Never edit a reporter-authored issue body (this skill only creates new issues).
