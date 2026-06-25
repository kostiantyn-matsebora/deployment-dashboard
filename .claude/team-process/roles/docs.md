# Role: Docs (plugin-provided — opt-in)

The **docs** role is provided by the external **docs-keeper** plugin, not by this repo.
It is an **opt-in integration slot** in team-process:

- **Plugin installed** → the role is staffed and behaves exactly as before: the
  `docs-keeper` agent, the `/docs-keeper:*` commands
  (`docs-index` · `docs-revise` · `docs-sweep` · `docs-registry-sync` · `docs-capture`),
  the commit-time drift gate, and the session/capture hooks all auto-register. Routing,
  the `/feature-team` roster, and dispatch (below) engage unchanged.
- **Plugin absent** → the docs role is simply **unstaffed**. The rest of team-process
  runs unchanged; doc work falls back to whoever the orchestrator assigns, with no broken
  hooks or dangling commands.

## Source

- Plugin + neutral core: the `docs-keeper` repo (core/engine + core/spec + the Claude
  Code adapter). The full role definition lives in the plugin's bundled `spec/role.md`.
- Install (one-time): `/plugin marketplace add kostiantyn-matsebora/docs-keeper` then
  `/plugin install docs-keeper@docs-keeper` — or rely on the `.claude/settings.json`
  `extraKnownMarketplaces` + `enabledPlugins` declaration.

## Hand-back contract (when staffed)

The plugin's docs role degrades gracefully to a standalone **Documentation Report**, and
**re-engages this host's typed-form protocol** (RESULT / REVIEW / FINDING via the outbox +
[`../protocol.md`](protocol.md) + `scripts/hooks/format_protocol_form.py`) when running
inside team-process. Those protocol files stay in this repo — they are shared by every
role, not extracted with docs-keeper.

- **Never commit/push/PR** — the orchestrator is the sole integrator.
- **Lanes / authoring rules / tooling:** [`../../bindings/docs.md`](../../bindings/docs.md)
  (also plugin-provided / opt-in).
