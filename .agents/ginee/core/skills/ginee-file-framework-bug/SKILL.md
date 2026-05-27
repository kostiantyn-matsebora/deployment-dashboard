---
name: ginee-file-framework-bug
description: File a bug report against the ginee framework upstream repo (NOT the adopter's own project) via the framework's outbound-issue workflow. Use when the user asks to 'file a framework bug', 'report a framework issue', 'file an issue against ginee itself'. Drafts a structured issue using core/templates/issues/framework-bug-report.md and targets github.framework-repo.
---

# File framework-bug — upstream

Run the file-an-issue workflow per `.agents/ginee/core/protocols/github-integration.md § Outbound — file an issue` with target = framework upstream, template = framework-bug-report.

## Activation

"file a framework bug" / "report an issue against ginee" / "file a bug against the framework"; defect in `core/*` · `adapters/*` · `extras/*` · templates. Cheat sheet: `adapters/_shared/install-common.md § Skill cheat sheet`.

## Procedure

1. Load `.agents/ginee/core/protocols/github-integration.md` + `.agents/ginee/core/templates/issues/framework-bug-report.md`.
2. Resolve target — `local/framework.config.yaml § github.framework-repo` REQUIRED. Unset → fail fast: *"framework-repo not configured. Set `github.framework-repo: <owner>/ginee` in `local/framework.config.yaml` first."* Offer to populate.
3. Draft body from template (incl. `Affected framework artefact` · `Framework version` from `core/VERSION` · `Adapter in use` · `Reproduction` · `Expected/Actual` · `Blocking severity` · `Workaround` · optional `Owner-history pointers` · `Acceptance criteria`).
4. **Self-lint** against `core/process.md § Mandatory checks` + `core/protocols/doc-authoring-protocol.md § Audience check` (every section incl. Summary) — title user-facing (no D-IDs / file paths / fix mechanics) · 2-4 sentence human Summary · numbered Reproduction steps · framework-internal sections after Summary.
5. **Surface draft for approval**; include self-lint findings.
6. On approval: create against `github.framework-repo` with `ready-label` + `framework` label. Tool priority: gh CLI → GitHub MCP → HTTPS.
7. Report URL + number.

## Forbidden

- Never silently create.
- Never fall back to primary repo when `github.framework-repo` is unset — fail with clear message.
- Never reference framework artefacts the adopter doesn't have installed.
- Skill-runner per `core/process/dispatch.md § Skill-runner — surface boundary`.
