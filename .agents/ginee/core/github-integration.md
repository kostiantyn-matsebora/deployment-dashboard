# GitHub integration — issues + discussions

**Load-on-demand.** Fetched when:

- `team-lead` is dispatched to **file** an issue (`@team-lead file bug` / `file feature`).
- `team-lead` is dispatched to **pick up** an issue (`@team-lead pick up #<N>`).
- `team-lead` is dispatched to **triage** ready issues (`@team-lead triage`).
- `team-lead` is dispatched to **promote** a discussion to an issue (`@team-lead promote discussion #<N>`).
- A specialist needs to post phase-transition progress on a tracking issue mid-task.

Default short tasks (TODO / direct instruction sources) do not load this file.

## Why

Two-way bridge between an adopter's GitHub repo and the framework's task model:

- Adopters file work in the platform they already use (issues, discussions).
- Framework picks issues up, runs them through the standard Phase 1–8 lifecycle, and closes the loop with issue comments + PR linkage.
- TODO files remain a valid task source — both coexist.

## Tool surface

Framework spec is tool-agnostic. Roles use whichever GitHub access is available in the current session, in this priority:

1. **`gh` CLI** — baseline; expected on most adopter dev environments.
2. **GitHub MCP server** — when connected; better tool-use ergonomics in supporting clients.
3. **Generic HTTPS + token** — fallback for environments lacking either.

Commands referenced below use `gh` syntax. Substitute equivalents as needed; never invent a third mechanism.

## Repo discovery — two repos

Framework tracks two repo handles:

| Handle | Purpose | Source |
|---|---|---|
| **primary** (`github.repo`) | Adopter's own project. Default target for issue ops. | Inferred from `git remote get-url origin`; override in `local/framework.config.yaml § github.repo`. |
| **framework** (`github.framework-repo`) | Upstream ginee framework. Lets adopters file feedback against the framework. | Set at install time by the curl/tarball script (or hand-set after copy-paste install). Leave unset to disable framework-targeted ops. |

Resolution rules:

1. **Primary repo.**
   - `github.repo` override wins.
   - Else infer from `git remote get-url origin` (strip `.git`).
   - Multi-remote: use `origin` unless overridden.
   - No remote / detached: PM surfaces the gap; offers to add the override key.
2. **Framework repo.**
   - `github.framework-repo` value wins if set.
   - Absent → framework-targeted operations are disabled. PM surfaces this and offers to populate the key.
3. **Same-repo case.** When working IN the framework repo (rare for the framework's own development), primary == framework. Target-based template selection (see below) naturally picks framework templates. Explicit `framework-` prefix on commands is accepted but redundant.

## Command targeting — primary vs framework

Default target is the primary repo. The `framework-` prefix routes **metadata-only** operations (file / triage / promote) to the framework repo:

| Default (primary) | Framework-targeted variant |
|---|---|
| `@team-lead file bug <title>` | `@team-lead file framework-bug <title>` |
| `@team-lead file feature <title>` | `@team-lead file framework-feature <title>` |
| `@team-lead triage` | `@team-lead triage framework` |
| `@team-lead promote discussion #<N>` | `@team-lead promote discussion framework#<N>` |

`pick up` has **no `framework-` variant.** Addressing an issue requires the source — that means working in the framework repo, where target = origin = framework and standard `@team-lead pick up #<N>` applies. From an adopter project (no framework source available), PM rejects framework-issue pickup attempts with: *"Clone `<framework-repo>` separately, cd into it, then `@team-lead pick up #<N>`."*

If `github.framework-repo` is unset, framework-targeted commands fail fast with a one-line "framework-repo not configured" message + an offer to populate the key. No silent fallback to primary.

## Template selection

Driven by **target repo**, not command shape:

| Target | Bug template | Feature template |
|---|---|---|
| primary repo | `core/templates/issues/bug-report.md` | `core/templates/issues/feature-request.md` |
| framework repo | `core/templates/issues/framework-bug-report.md` | `core/templates/issues/framework-feature-request.md` |

When working IN the framework repo (primary == framework), the framework-* templates apply for every file/pick-up — no special command needed.

## Label scheme (configurable)

Defaults declared under `local/framework.config.yaml § github`:

| Config key | Default | Meaning |
|---|---|---|
| `ready-label` | `ginee:ready` | Pickup candidate (`☐` equivalent). |
| `in-progress-label` | `ginee:in-progress` | PM has dispatched; phases 1–7 in flight. |
| `blocked-label` | `ginee:blocked` | Stoppable intermediate state; waiting on user / external. |

PM creates any missing label on first use via `gh label create <name>` (default color). "Done" is implicit — issue closed.

## State mapping

| GitHub state | Framework phase | TODO equivalent |
|---|---|---|
| Open, no framework labels | Unpicked-up — sits in adopter's idea/triage queue | n/a |
| Open + `ready-label` | Phase 1 pickup candidate | `☐` |
| Open + `in-progress-label` | Phase 1–7 in flight | mid-task |
| Open + `blocked-label` | Stoppable intermediate; awaiting user/external | mid-task, paused |
| Closed | Phase 8 accepted | `☒` |

## Outbound — file an issue

Trigger: `@team-lead file bug <title>` / `file feature <title>` (→ primary) or `file framework-bug <title>` / `file framework-feature <title>` (→ framework upstream).

1. PM resolves target repo (primary unless `framework-` prefix) and picks the template per § Template selection.
2. PM drafts the body — populates the template's structured sections from user input + project context.
3. **PM surfaces the draft to the user for approval.** Issue creation is externally visible — per `core/process.md § Executing actions with care`, always confirm before publishing.
4. On approval, PM runs:
   ```
   gh issue create --repo <repo> --title <T> --body <B> --label <ready-label>
   ```
   (or MCP equivalent).
5. PM reports the issue URL + number in the final response.

## Inbound — pick up an issue

Trigger: `@team-lead pick up #<N>` — always targets the primary repo (= the working tree's origin). **Never auto-picks.** **No `framework-` variant** — see § Command targeting.

1. Fetch:
   ```
   gh issue view <N> --repo <primary-repo> --json title,body,labels,state,comments
   ```
2. Validate:
   - State must be `OPEN`.
   - Labels include `ready-label` — if absent, PM offers to add it before pickup.
3. Parse the structured body per the template sections. Map `affected area` → routing per `local/bindings.md`.
4. Swap labels:
   ```
   gh issue edit <N> --remove-label <ready-label> --add-label <in-progress-label>
   ```
5. Run Phase 1 analysis treating the parsed issue body as the task description. Standard Phase 1–8 dispatch from here.
6. **Comment cadence** — PM posts a structured comment at each major transition:

   | Trigger | Comment shape |
   |---|---|
   | Phase 3 design review surfaced | Architecture-doc diff link + mockup link + work-breakdown + "awaiting approval" |
   | Phase 7 SA review outcome | APPROVE / RETURN-TO-engineer + findings list |
   | Phase 8 acceptance | Summary + PR/commit links + "closing on accept" |
   | Stoppable intermediate state (user paused) | Current phase + done/in-progress/not-started lists |

   Comments are structured summaries, not chatty. One per transition.
7. On Phase 8 acceptance, PM closes the issue:
   ```
   gh issue close <N> --repo <repo> --comment "<final summary + PR links>"
   ```

## Triage — list ready issues

Trigger: `@team-lead triage` (→ primary) or `@team-lead triage framework` (→ framework upstream).

1. Resolve target repo. List:
   ```
   gh issue list --repo <target-repo> --label <ready-label> --state open --json number,title,labels,createdAt
   ```
2. Surface as a table — number / title / age / labels.
3. Propose a pickup order based on:
   - Age (older first, modulo new urgent items).
   - Apparent scope (bug-fixes typically shorter than feature work).
   - Cross-references with active TODO work (avoid context-switch thrash).
4. User picks one (or several). PM runs the pickup flow for each.

Triage **never picks**. It only enumerates and proposes.

## Promote — discussion → issue

Trigger: `@team-lead promote discussion #<N>` (→ primary) or `@team-lead promote discussion framework#<N>` (→ framework upstream).

1. Resolve target repo. Fetch the discussion:
   ```
   gh api repos/<target-repo>/discussions/<N>
   ```
   (or MCP Discussions API equivalent).
2. Read body + top comments — extract:
   - The proposed change.
   - Open questions raised in comments.
   - Any rough acceptance criteria mentioned.
3. Draft an issue using the appropriate template. Title links to the discussion: `Promoted from discussion #<N>: <title>`. Body includes a `## Source` section: `Discussion: https://github.com/<owner>/<repo>/discussions/<N>`.
4. Surface the draft for user approval.
5. On approval, create the issue **and** comment on the discussion linking to the new issue:
   ```
   gh issue create ...                        # → issue #M
   gh api repos/<owner>/<repo>/discussions/<N>/comments \
      --field body="Promoted to issue #<M>"
   ```

## PR linkage

When a task is issue-sourced, every resulting PR description includes a `Closes #<N>` line (or `Fixes #<N>` for bug-report issues). GitHub auto-closes the issue on merge. PM verifies this line is present before approving Phase 8.

Template carries this: `core/templates/pr-description.md § Issue linkage`.

## Forbidden actions

- **Never silently create / close / re-open an issue.** Each requires explicit user approval per `core/process.md § Executing actions with care` — issues are externally visible.
- **Never bulk-close stale issues.** Stale-issue cleanup is an adopter-owned policy, not framework work.
- **Never assign issues to GitHub users.** Specialists aren't GitHub users; assignment stays manual.
- **Never edit another author's issue body.** PM may add comments and labels; the body is reporter-owned.
- **Never auto-pick up issues on session start.** Pickup is always explicit (`pick up #<N>` or `triage` → user selects).
- **Never federate across repos.** One repo per `github.repo` config; cross-repo coordination is out of scope.

## Out of scope

- Pull requests as a task source (PRs are work output, not work input).
- Webhook / event-driven pickup. Pickup is explicit on user invocation.
- Issue auto-labelling on body keywords. Adopters use GitHub's own automation for that.
- Auto-creating custom-coloured labels. Framework creates labels with default color when absent; recolouring is an adopter task.
- Cross-repo issue federation.
- Issue assignment to specialists (specialists aren't GitHub users).
- Discussions as a direct task source. They must be promoted to an issue first.
