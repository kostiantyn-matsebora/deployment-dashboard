---
description: Compose a pull-request body per the framework template — schema-bound sections, source cite, verification log.
argument-hint: <one-line PR title>
---

Author the PR body per `core/templates/pr-description.md`. Fill required sections; drop empty; cite the source (no source → no PR).

Title: $ARGUMENTS

Skeleton:

```
## What                                              (1–2 sentences, imperative)
## Why                                               (trigger: TODO · CR · defect · explicit request — reference source)

## Cites
| Source | Reference |
|---|---|
| Requirement / NFR | `<FR-NN-slug | NFR-NN-slug>` |
| Architecture-doc / Mockup / CR / ADR / Hand-off | `<cite>` |

## Issue linkage
- Closes #<N> — <title>
- Related #<N> — <context, no auto-close>

## Domain breakdown                                  (cross-domain only)
| Domain | Role | Files | Verification |
|---|---|---|---|

## Cross-domain sign-offs                            (cross-domain only)
- [ ] solution-architect / backend / frontend / devops / qa — <one-line each>

## Cost impact                                       (DevOps SKU bumps)
| Item | Before | After | Delta |
|---|---|---|---|

## Verification log
| Command | Outcome |
|---|---|

## CI status                                         (automatic-mode only)
## Open issues / follow-ups
## Out of scope (explicit)
```

Submit via `gh pr create --title "<title>" --body "$(cat <<'EOF'\n<body>\nEOF\n)"`. Never `--body-file -`; HEREDOC preserves multi-line escaping.
