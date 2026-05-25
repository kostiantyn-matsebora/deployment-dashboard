---
name: ginee-promote-discussion
description: Promote a GitHub discussion to a labelled issue via the ginee framework. Use when the user asks to 'promote discussion #N', 'turn discussion N into an issue', 'convert discussion N to issue'. Fetches the discussion + top comments, drafts an issue using the appropriate template (bug/feature; primary or framework target), surfaces for approval, then creates the issue and links it back on the discussion.
---

# Promote discussion → issue

Run the promote workflow per `.agents/ginee/core/github-integration.md § Promote — discussion → issue`.

## Activation

- User asks "promote discussion #N" / "turn discussion N into an issue" / "convert discussion N to issue".
- Optional 'framework' positional arg or `framework#N` syntax → target framework upstream.

## Procedure

1. Load `.agents/ginee/core/github-integration.md § Promote`.
2. **Mechanical ops only (skill-runner).** Resolve target repo:
   - Default: primary repo.
   - With 'framework' / `framework#N`: `github.framework-repo` — fail fast if unset.
3. Fetch the discussion: `gh api repos/<target>/discussions/<N>` (or MCP Discussions API equivalent). Read body + top comments verbatim.
4. **Hand to `team-lead`.** Skill-runner dispatches `@team-lead` with the fetched discussion payload + target repo. team-lead owns: classification of bug-vs-feature, template selection, draft authoring (the discussion may need restructuring doc-authoring rules), source-section linkage, surfacing the draft to the user, post-approval issue creation + discussion comment. Per `.agents/ginee/core/process.md § Skill-runner — surface boundary`.
5. Under team-lead: choose template — `feature-request.md` (primary) / `framework-feature-request.md` (framework) by default; switch to bug-report template if the discussion is clearly about a defect.
6. Draft the issue body. Title prefix: `Promoted from discussion #<N>: <title>`. Body includes a `## Source` section linking the discussion.
7. **Surface the draft for user approval.** Doc-authoring self-lint runs before publish.
8. On approval:
   - Create the issue against the target repo with `ready-label` (+ `framework` label for framework target). Tool priority: gh CLI → GitHub MCP → HTTPS.
   - Comment on the original discussion: "Promoted to issue #<M>" with the issue URL.
9. Report both URLs (new issue + original discussion).

## Forbidden

- Never silently create — surface the draft.
- Never close the discussion as part of the promotion — discussions stay open for continued conversation.
- Never edit the discussion body — comment only.
- **Skill-runner forbiddens.** After Step 4 hand-off the skill-runner must not classify bug-vs-feature in the main thread · author the draft body · paraphrase the discussion content · decide on the title shape. Every authoring decision dispatches `@team-lead`. Full boundary: `.agents/ginee/core/process.md § Skill-runner — surface boundary`.
