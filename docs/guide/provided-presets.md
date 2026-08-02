# Provided presets

Read-only, repo/CI-sourced UI-settings presets — separate from the [local presets](./ui-settings.md) a user saves in their own browser. A source (typically a `owner/repo` GitHub repository) publishes a bundle; every visitor to the dashboard sees the same catalog under a **PROVIDED** section of the presets popover, with **Apply** and **Clone-to-edit** actions. Nothing is written back — provided presets are never edited or deleted from the UI.

Full contract: [OpenAPI spec](../api/openapi.yaml) (`presets` tag) · [API_SPECIFICATION.md](../API_SPECIFICATION.md) (`provided_presets`) · [Fetcher spec § Preset discovery](../FETCHER_SPECIFICATION.md#8-preset-discovery-issue-391).

![Provided presets in the topbar popover — dark](../_assets/screenshots/provided-presets-dark.png#only-dark){ .dd-shot }
![Provided presets in the topbar popover — light](../_assets/screenshots/provided-presets-light.png#only-light){ .dd-shot }

## The `.deployment-dashboard/*.json` convention

A source publishes presets by committing JSON files under a `.deployment-dashboard/` directory at the repo root. Each `*.json` file is **single-or-bundle** — either shape is valid:

**Single envelope** — one preset per file:

```json
{
  "version": 1,
  "name": "Prod services",
  "settings": { "theme": "dark", "view": "matrix", "failOnly": true }
}
```

**Bundle** — multiple presets in one file:

```json
{
  "version": 1,
  "presets": [
    { "version": 1, "name": "Prod services", "settings": { "theme": "dark", "view": "matrix" } },
    { "version": 1, "name": "On-call",       "settings": { "theme": "dark", "view": "swimlanes" } }
  ]
}
```

`settings` is opaque — the backend stores it verbatim; it is the same shape a local preset's `settings` field carries (see [What a preset saves](./ui-settings.md#what-a-preset-saves)). Any number of `.json` files may live in the directory; non-`.json` files and sub-directories are ignored. All presets across every file in the directory are aggregated into one bundle per source.

## Publishing presets (push mode)

Any process that can make an HTTP call can publish, independent of the Fetcher:

```bash
curl -fsS -X PUT "$DASHBOARD_URL/api/presets/sources/acme/web" \
  -H "X-Api-Key: $DASHBOARD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "version": 1,
    "presets": [
      { "version": 1, "name": "Prod services", "settings": { "theme": "dark", "view": "matrix" } }
    ]
  }'
```

- `{source}` is the repo's `owner/repo` (it contains a slash — the API matches it with a catch-all route).
- The body is a `PresetBundle` — same shape as the bundle file above.
- Request body capped at 256 KiB; larger bodies get `413`.
- `204 No Content` on success; `401` if `X-Api-Key` is missing/invalid.
- **No Fetcher, no `Contents:read`, no GitHub token at all is involved.** A CI job step (GitHub Actions, Azure DevOps, GitLab CI, Jenkins — same "any pipeline can call a URL" pattern as [deployment events](./send-events.md)) can PUT the bundle directly whenever `.deployment-dashboard/*.json` changes.

## Automatic discovery (pull mode)

When the [Fetcher](./configuration/fetcher.md#fetcher-pull-mode) runs with `Contents:read` granted, it polls each configured `GITHUB_REPOS` entry's `.deployment-dashboard` directory on its own slow cadence (`DISCOVERY_INTERVAL_SECONDS`, default 3600s) and PUTs the aggregated bundle automatically — no manual `curl` needed. See [Fetcher spec § Preset discovery](../FETCHER_SPECIFICATION.md#8-preset-discovery-issue-391) for the mechanics (ETag-conditional directory read, single-or-bundle parsing, rate-limit budget).

## Three permission tiers

| Tier | Setup | What happens |
|---|---|---|
| **Push-only** | No Fetcher deployed (or deployed without reading this repo) | Zero GitHub read for presets. CI publishes bundles directly via the `curl PUT` recipe above whenever `.deployment-dashboard/*.json` changes. |
| **Pull, without `Contents:read`** | Fetcher runs in pull mode; `GITHUB_TOKEN` has `Deployments:read` + `Actions:read` only (the [minimal tier](./configuration/fetcher.md#github-token-permissions)) | Deployment ingest works normally, but preset discovery is skipped for that token — the directory-listing call needs `Contents:read`. Presets for this repo still require the push-mode recipe. |
| **Pull, with `Contents:read`** | Fetcher runs in pull mode; `GITHUB_TOKEN` has the [full tier](./configuration/fetcher.md#github-token-permissions) (`+ Contents: Read-only`, opt-in) | Fully automatic — the same `Contents:read` grant that unlocks explicit Swimlanes parent edges also unlocks preset discovery. No `curl` needed; commits to `.deployment-dashboard/*.json` are picked up within `DISCOVERY_INTERVAL_SECONDS`. |

**Grant-once-to-bootstrap-then-revoke.** `Contents:read` only needs to be present *at the moment a discovery cycle runs*. An adopter can grant it temporarily, let one discovery cycle publish the bundle, then revoke it — the published presets are unaffected by the revoke; see the keep-last-known-good semantics below.

## Replace-by-source and keep-last-known-good

Each `PUT /api/presets/sources/{source}` — whether from a CI `curl` step or the Fetcher — is **authoritative-replace**: it replaces every preset previously published by that source. An empty `presets: []` is a valid, deliberate authoritative-empty bundle that prunes all of that source's presets.

**Prune only ever follows a successful, authoritative read.** For Fetcher-driven discovery specifically:

| Directory-listing outcome | Effect |
|---|---|
| `200`, one or more valid `.json` files | Replace — publish the aggregated bundle for the source. |
| `200`, zero `.json` files (empty directory) | Replace with an empty bundle — **prunes** every preset previously published by this source. |
| `304 Not Modified` (ETag match) | No-op — reuses the last-published bundle, no re-`PUT`. |
| `403`, `404`, any other non-2xx, a per-file fetch/parse error, or a network failure | **Skip the whole source for this cycle — never prune, never publish a partial bundle.** The dashboard keeps whatever that source last successfully published. |

This is why revoking `Contents:read` after a bootstrap `PUT` is safe: the next discovery cycle gets a `403` on the directory listing, which is a **skip**, not a prune — the previously-published presets remain untouched until either `Contents:read` is re-granted or a push-mode `curl PUT` replaces them explicitly.

## See also

- [UI settings & presets](./ui-settings.md) — the local, per-browser preset feature this complements.
- [Configuration — Fetcher](./configuration/fetcher.md) — `DISCOVERY_INTERVAL_SECONDS` and GitHub token permission tiers.
- [Fetcher spec § Preset discovery](../FETCHER_SPECIFICATION.md#8-preset-discovery-issue-391) — full mechanics.
