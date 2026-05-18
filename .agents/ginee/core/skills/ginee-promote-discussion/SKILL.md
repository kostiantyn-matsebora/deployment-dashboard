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
2. Resolve target repo:
   - Default: primary repo.
   - With 'framework' / `framework#N`: `github.framework-repo` — fail fast if unset.
3. Fetch the discussion: `gh api repos/<target>/discussions/<N>` (or MCP Discussions API equivalent).
4. Read body + top comments — extract:
   - Proposed change.
   - Open questions raised in comments.
   - Rough acceptance criteria mentioned.
5. Choose template — `feature-request.md` (primary) / `framework-feature-request.md` (framework) by default; switch to bug-report template if the discussion is clearly about a defect.
6. Draft the issue body. Title prefix: `Promoted from discussion #<N>: <title>`. Body includes a `## Source` section linking the discussion.
7. **Surface the draft for user approval.**
8. On approval:
   - Create the issue against the target repo with `ready-label` (+ `framework` label for framework target). Tool priority: gh CLI → GitHub MCP → HTTPS.
   - Comment on the original discussion: "Promoted to issue #<M>" with the issue URL.
9. Report both URLs (new issue + original discussion).

## Forbidden

- Never silently create — surface the draft.
- Never close the discussion as part of the promotion — discussions stay open for continued conversation.
- Never edit the discussion body — comment only.
