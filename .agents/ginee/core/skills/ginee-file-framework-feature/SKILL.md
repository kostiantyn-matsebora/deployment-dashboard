---
name: ginee-file-framework-feature
description: File a feature request against the ginee framework upstream repo (NOT the adopter's own project) via the framework's outbound-issue workflow. Use when the user asks to 'file a framework feature', 'request a framework feature', 'propose a change to ginee itself'. Drafts a structured issue using core/templates/issues/framework-feature-request.md and targets github.framework-repo.
---

# File framework-feature — upstream

Run the file-an-issue workflow per `.agents/ginee/core/github-integration.md § Outbound — file an issue` with target = framework upstream, template = framework-feature-request.

## Activation

- User asks to "file a framework feature" / "request a framework feature" / "propose a change to ginee" / "improve the framework".
- User proposes new framework capability, role addition, process change, or adapter enhancement.

## Procedure

1. Load `.agents/ginee/core/github-integration.md` and `.agents/ginee/core/templates/issues/framework-feature-request.md`.
2. Resolve target repo from `local/framework.config.yaml § github.framework-repo`. Fail fast with clear message if unset.
3. Draft the body from the framework-feature-request template. Populate `## Summary`, `## Motivation`, `## Affected framework surface`, `## Proposed behavior`, `## Locked-decision impact` (new D-decision? amends existing?), `## Backward compatibility` (breaks `local/*`? migration note needed?), `## Acceptance criteria`, `## Out of scope`, `## References`.
4. When the user asked for ideas / alternatives → present 2–3 candidate design solutions in `## Proposed behavior` with tradeoff bullets each. Do NOT pre-decide the recommended approach — let framework owners pick during Phase 2.
5. **Self-lint the draft** against `.agents/ginee/core/process.md § Mandatory checks before report-as-done` — **every section, including Summary**. Catch: prose paragraphs > 2 sentence terminators · comma-separated inventories (incl. parenthetical lists) · multi-rule single-line statements · inventories not rendered as tables.
6. **Surface the draft for user approval.** Include any self-lint findings + proposed restructure as part of the approval prompt.
7. On approval, create the issue against `github.framework-repo` with `ready-label` + the `framework` label. Tool priority: gh CLI → GitHub MCP → HTTPS.
8. Report URL + number.

## Forbidden

- Never silently create — surface the draft.
- Never fall back to the primary repo when `github.framework-repo` is unset — fail with a clear message.
- Never pre-recommend one design when the user asked for ideas.
