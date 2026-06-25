# adapters/copilot — reserved (contract stub)

**Status:** reserved / not implemented. This directory documents the contract a future
GitHub Copilot adapter MUST satisfy so platforms stay symmetric with `adapters/claude-code`.

An adapter is **per-platform glue only** — it carries no documentation logic. All logic
lives in [`core/engine`](../../core/engine) (runtime) and [`core/spec`](../../core/spec)
(procedures/templates). The Claude Code adapter is the reference implementation.

## What a Copilot adapter provides

1. **Manifest + hook-config** in Copilot's native format (the analogue of
   `.claude-plugin/plugin.json` + `hooks/hooks.json`).
2. **Thin hook entrypoints** translating Copilot's hook payload/response into the same
   `core/engine` calls the Claude Code entrypoints use:

   | Capability | Engine entrypoint | CC reference |
   |---|---|---|
   | Commit-time drift gate | `drift.evaluate_commit_maintenance(...)` / `drift.get_docs_drift_queue(...)` | `hooks/cc_maintenance.py` |
   | Session snapshot / track / mark-revised / GC | `session.invoke_session_snapshot` · `session.add_tracked_md_files` · `session.set_tracked_md_revised` · `session.remove_docs_session_state` | `hooks/cc_session.py` |
   | Capture (manual + compaction) | `capture.new_docs_capture_entry` · `capture.add_docs_capture_entry` · `capture.write_docs_capture` | `hooks/cc_capture.py` |
   | Neutral CI drift gate | `core/engine/cli.py --drift-only` | (platform-agnostic) |

3. **Native agent / command wrappers** pointing at the bundled `core/spec` procedures
   (`spec/role.md`, `spec/commands/*.md`, `spec/templates/*`).
4. **A `build/assemble.py` vendoring job** (if Copilot also forbids referencing files
   outside the adapter root) so the adapter ships self-contained, guarded by
   `assemble --check` in CI.

## Engine API the adapter binds to

Treat these as the stable surface — the same one `adapters/claude-code` uses:

- `core.engine.drift` — `evaluate_commit_maintenance`, `get_docs_drift_queue`,
  `format_block_message`, `resolve_enforcement_mode`, `read_hook_payload`,
  `get_session_id_from_payload`, `is_git_commit`.
- `core.engine.session` — session tracker lifecycle + merge + GC.
- `core.engine.capture` — capture model + I/O.
- `core.engine.gitio` — git / dir-lister / file-reader collaborator factories.

A Copilot entrypoint MUST keep the platform-neutral invariant: no Copilot-specific
payload field names or response verbs inside `core/` — translate them at the adapter edge.
