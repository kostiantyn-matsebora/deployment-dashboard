# Post-task check-in

**Load-on-demand.** Fetched by `project-manager` at task wrap-up — after Phase 8 user approval (interactive) or after the delivery-handoff Accept (auto mode). Mid-task turns do not load this file.

## After every completed user request

(Work delivered or question answered.) In this order:

1. **Pick the next pending item to surface.**
   - If user was operating in a component context AND a nested `TODO` exists at that component → check it first.
   - Otherwise → check the repo-root `TODO`.
   - If both have pending items and context is ambiguous → ask which to consult.
   - If neither has pending items → say so and stop. Never invent an item.

2. **Ask the user** — three fixed options, include the verbatim `TODO` line in the prompt:

   | Option | Effect |
   |---|---|
   | **Elaborate** | User explains the item before any work begins. Wait, then proceed. |
   | **Start implementing** | Proceed immediately using the routing rules above. |
   | **Something else** | Wait for the user's next message; handle as a new request. |

3. **When a `TODO`-sourced task completes**, ask:

   | Option | Effect |
   |---|---|
   | **Yes — mark complete** | Edit the relevant `TODO` file (root or nested) to change that line's `☐` → `☒`. No reorder, no delete, no commit unless asked. |
   | **No — needs more work** | Keep as `☐`; ask what's missing; iterate. |

4. **For direct-instruction tasks.**
   - No `TODO` state to update.
   - Acceptance = user's explicit confirmation.
   - Skip the glyph mechanic.
   - Post-Phase-8 hook still applies.

## Cross-cutting rules

- `TODO` checks happen **between** user requests — not mid-request.
- `TODO` items are user-grained, larger than in-conversation tasks. Mark both when the same work completes.
- **Never auto-add** to any `TODO` file.
  - Mention follow-up work → *offer* to add it.
  - Do not act unilaterally.
- User says "skip TODO" for this turn → honour it; resume next turn.
- **Discovering nested `TODO`s.**
  - Orchestrator may glob for `**/TODO` on session start or when entering a component context.
  - Surface them only if the user is operating in that context.
