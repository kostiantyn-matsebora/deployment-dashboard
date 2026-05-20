---
name: ginee-pick-up
description: Pick up a task from any source and run it through the ginee Phase 1–8 lifecycle. Task source can be a GitHub issue (`#N`), a TODO line in any TODO file (root or nested), or a freeform description. Use when the user asks to 'pick up #N', 'work on issue N', 'pick up the TODO about X', 'start working on Y', or otherwise explicitly invokes the lifecycle on a specific task.
---

# Pick up task — unified

Single entrypoint for all task sources defined in `.agents/ginee/core/process.md § Task model`. Detects the source from the user's prompt and routes to the matching workflow.

## Activation

User asks "pick up X" / "work on X" / "start on X" / "begin X" where X is one of:

- A GitHub issue: `#<N>`, `issue #<N>`, `issue N`.
- A TODO line: file path + line (`TODO:12`), quoted line text, or "the TODO about Y".
- Freeform: a description with no issue/TODO reference.

## Procedure

### Step 1 — identify task source

- `#<N>` or `issue N` → GitHub issue (primary repo).
- TODO reference → TODO line.
- Otherwise → freeform.

### Step 2 — per source

**GitHub issue** — per `.agents/ginee/core/github-integration.md § Inbound — pick up an issue`:

1. Fetch + parse the issue.
2. Validate `OPEN` state + `ready-label`.
3. **Scoring labels + sticky comment** per `.agents/ginee/core/triage-scoring.md § Score comment + audit trail`:
   - Missing `value:*` → ask user (H / M / L); add `value:high|medium|low` label; post `<!-- ginee:value-prompt -->` audit comment.
   - Missing `complexity:*` → dispatch `solution-architect` for H / M / L estimate; post `<!-- ginee:complexity-estimate by=solution-architect value=H at=<ISO> -->` audit comment + add `complexity:high|medium|low` label.
   - Post / update the sticky `<!-- ginee:score v=1 -->` comment (one per issue; find via marker; never duplicate). `Reasoning` column populated only for ginee-set rows.
4. Swap labels: `ready-label` → `in-progress-label`.
5. Run Phase 1–8.
6. Post structured comments at major transitions (Phase 3 design review / Phase 7 SA review / Phase 8 acceptance / stoppable intermediate).
7. Close on Phase 8 acceptance with final summary comment + PR/commit links.

**TODO line** — per `.agents/ginee/core/process.md § Task model § TODO file rules`:

1. Read the TODO line at the cited path + line; parse optional `[v:N c:M]` marker per `.agents/ginee/core/triage-scoring.md`.
2. Confirm with the user this is the intended task.
3. Run Phase 1–8.
4. On Phase 8 acceptance, flip `☐` → `☒` on the source line.

**Freeform user request** — per `.agents/ginee/core/process.md § Task model` (direct-instruction source):

1. Treat the prompt as the task description.
2. Run Phase 1–8. No per-source artefact to update.

### Step 3 — common lifecycle

- Dispatch specialists per `local/bindings.md`.
- Run iteration protocol per `.agents/ginee/core/iteration-protocol.md` when total scope > 15 min — estimation-first dispatch.
- Honour gates at Phase 3 (design review), Phase 7 (SA review), Phase 8 (user approval).

## Forbidden

- Never pick up without identifying the source first — rules differ per source.
- GitHub issue: never edit the reporter-authored body — comments only.
- TODO item: never auto-add new TODO lines (`§ TODO file rules` — never auto-generated, never auto-extended).
- Never silently close out — Phase 8 acceptance is always surfaced.
- Never run the framework-upstream variant from an adopter project — addressing a framework issue requires working in the framework repo (where origin = framework; plain `pick up #<N>` works).
