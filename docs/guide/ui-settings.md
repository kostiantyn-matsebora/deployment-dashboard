# UI settings & presets

Presets are a client-side feature of the running dashboard — no server configuration, no env vars, no accounts. State lives in `localStorage` in the browser.

## :material-bookmark-box-multiple-outline: UI settings presets { #ui-settings-presets }

Presets are a **client-side feature** — no env vars, no backend, no accounts. State lives in `localStorage` in the browser. Nothing here needs to be configured on the server.

### What a preset saves

A preset captures the full UI settings snapshot at the moment it is saved:

- free-text service filter input value
- active service, environment, and notification glob filter patterns
- view and display preferences (visible columns, layout options)
- notification filter settings (status, service, environment axes)

### Working with presets

The preset list marks the last-applied preset with an "Active" badge. The indicator persists across reloads and follows renames; it is cleared when the active preset is deleted or all settings are reset.

| Action | How |
|---|---|
| **Save** | Open the preset panel; type a name; click **Save**. |
| **Apply** | Hover a preset row; click the **Apply** icon — all captured settings take effect immediately. The row is marked Active. |
| **Clone** | Hover a preset row; click the **Clone** icon — saves a copy with `(copy)` appended. |
| **Update** | Hover a preset row; click the **Update** icon — overwrites the preset with the current settings after a confirmation. Name unchanged. |
| **Rename** | Hover a preset row; click the **Rename** icon — edit the name inline; confirm. |
| **Export** | Hover a preset row; click the **Export** icon — the file downloads instantly. |
| **Delete** | Hover a preset row; click the **Delete** icon — a confirmation prompt prevents accidental removal. |
| **Reset all settings** | Click **Reset all settings** at the bottom of the panel — a confirmation prompt resets every setting to its default and clears the active preset. |

### File-based sharing

Presets can be shared without a server. Each preset exports as a single `dd-preset-<slug>.json` file.

**Sharing flow:**

1. Hover a preset row; click **Export** — the file downloads instantly.
2. Share the file by email, Slack, or by committing it to a git repo alongside your pipeline config.
3. The recipient opens the preset panel, clicks **Import**, and selects the file — the preset appears in their list immediately.

The app **never fetches preset files from the network**. Import is always an explicit user action. There is no central registry and no sync — each browser holds its own presets independently.

!!! tip "Team starter kit"
    Commit a `presets/` directory to your repo with a `dd-preset-<name>.json` for each standard view (e.g. `dd-preset-prod-services.json`, `dd-preset-on-call.json`). New team members import them on first launch and are up to speed in seconds.

[:octicons-arrow-right-24: See the preset panel in action](./screenshots.md#ui-settings-presets)
