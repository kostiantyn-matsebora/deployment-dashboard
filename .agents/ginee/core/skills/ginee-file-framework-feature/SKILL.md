---
name: ginee-file-framework-feature
description: File a feature request against the ginee framework upstream repo (NOT the adopter's own project) via the framework's outbound-issue workflow. Use when the user asks to 'file a framework feature', 'request a framework feature', 'propose a change to ginee itself'. Drafts a structured issue using core/templates/issues/framework-feature-request.md and targets github.framework-repo.
---

# File framework-feature — upstream

Run the file-an-issue workflow per `.agents/ginee/core/protocols/github-integration.md § Outbound — file an issue` with target = framework upstream, template = framework-feature-request.

## Activation

"file a framework feature" / "request a framework feature" / "propose a change to ginee" / "improve the framework"; user proposes new capability · role addition · process change · adapter enhancement. Cheat sheet: `adapters/_shared/install-common.md § Skill cheat sheet`.

## Procedure

1. Load `.agents/ginee/core/protocols/github-integration.md` + `.agents/ginee/core/templates/issues/framework-feature-request.md`.
2. Resolve target — `local/framework.config.yaml § github.framework-repo` REQUIRED; fail fast if unset.
3. Draft body from template (incl. `Affected framework surface` · `Owner-decision impact` · `Backward compatibility` · standard sections).
4. User asked for ideas → present 2–3 candidate design solutions in `## Proposed behavior` with tradeoff bullets. Do NOT pre-decide; let framework owners pick during Phase 2.
5. **Self-lint** against `core/process.md § Mandatory checks before report-as-done` (every section incl. Summary).
6. **Surface draft for approval**; include self-lint findings.
7. On approval: create against `github.framework-repo` with `ready-label` + `framework` label. Tool priority: gh CLI → GitHub MCP → HTTPS.
8. Report URL + number.

## Forbidden

- Never silently create.
- Never fall back to primary repo when `github.framework-repo` is unset.
- Never pre-recommend one design when user asked for ideas.
- Skill-runner per `core/process/dispatch.md § Skill-runner — surface boundary`.
