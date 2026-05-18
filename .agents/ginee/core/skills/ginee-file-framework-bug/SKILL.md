---
name: ginee-file-framework-bug
description: File a bug report against the ginee framework upstream repo (NOT the adopter's own project) via the framework's D14 workflow. Use when the user asks to 'file a framework bug', 'report a framework issue', 'file an issue against ginee itself'. Drafts a structured issue using core/templates/issues/framework-bug-report.md and targets github.framework-repo.
---

# File framework-bug — upstream

Run the file-an-issue workflow per `.agents/ginee/core/github-integration.md § Outbound — file an issue` with target = framework upstream, template = framework-bug-report.

## Activation

- User asks to "file a framework bug" / "report an issue against ginee" / "file a bug against the framework".
- User describes a defect in framework files (`core/*`, `adapters/*`, `extras/*`, templates).

## Procedure

1. Load `.agents/ginee/core/github-integration.md` and `.agents/ginee/core/templates/issues/framework-bug-report.md`.
2. Resolve target repo:
   - `local/framework.config.yaml § github.framework-repo` is required.
   - If unset → fail fast: "framework-repo not configured. Set `github.framework-repo: <owner>/ginee` in `local/framework.config.yaml` first." Offer to populate it.
3. Draft the body from the framework-bug-report template. Populate `## Summary`, `## Affected framework artefact` (process / role-kernel / role-details / template / adapter / extras-role / spec), `## Framework version` (from `.agents/ginee/core/VERSION`), `## Adapter in use`, `## Reproduction`, `## Expected framework behavior`, `## Actual framework behavior`, `## Blocking severity`, `## Workaround`, `## Locked decisions referenced` (D1–D14+), `## Acceptance criteria`.
4. **Surface the draft for user approval.**
5. On approval, create the issue against `github.framework-repo` with `ready-label` + the `framework` label. Tool priority: gh CLI → GitHub MCP → HTTPS.
6. Report URL + number.

## Forbidden

- Never silently create — surface the draft.
- Never fall back to the primary repo when `github.framework-repo` is unset — fail with a clear message.
- Never reference framework artefacts the adopter doesn't actually have installed.
