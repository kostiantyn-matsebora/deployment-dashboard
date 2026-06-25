# FAQ & troubleshooting

## Adoption

**Do I have to change my pipelines?**
No — you add one HTTP `POST` step. Nothing else changes. See [Integrate your CI/CD](./send-events.md). If you can't touch the pipeline at all, the optional [Fetcher](./install/index.md#deployment-shapes) polls the CI/CD API and posts for you.

**Which CI/CD tools are supported?**
Any tool that can make an HTTP POST (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, …). Ingest is tool-agnostic. Pull mode currently has a GitHub Actions adapter.

**Does it trigger or roll back deployments?**
No. It's read-only / notification-only — a view of state, not a deployment engine.

**Do I need to register my services and environments?**
No. They're discovered from the events you post. A new `service`/`environment` appears automatically.

**How long is history kept?**
Per `HISTORY_RETENTION_DAYS` (default 365; minimum 90 — smaller values are clamped up). Pruned daily by a background job. See [Configuration](./configuration/api.md#api).

## Troubleshooting

**`401 Unauthorized` on POST.**
`X-Api-Key` is missing or doesn't match `API_KEY`. Confirm the header name and the configured value. See [Configuration](./configuration/api.md#api).

**`422 Unprocessable Entity` on POST.**
Validation failed. The `application/problem+json` body has an `errors[]` array pinpointing the field. Common causes: missing a required field (`deployment_id`, `service`, `environment`, `status`, `happened_at`); `status` not one of `in-progress|success|failure`; `happened_at` not RFC 3339 UTC; `run_number` not an integer; an unknown field (write bodies are closed). See [Integrate your CI/CD](./send-events.md#payload).

**My deployment doesn't show up.**
- Did the POST return `201`? If not, fix per the codes above.
- The matrix shows the **latest** row per `(service, environment)` by `happened_at`. A backdated `happened_at` won't surface as current. Use accurate UTC timestamps.
- Check you're hitting the gateway (`:8080`), not the internal API port directly.

**Live updates don't stream (matrix only updates on reload).**
SSE is being buffered by a proxy in front of the gateway. The bundled nginx gateway is configured for SSE; if you add another reverse proxy, disable response buffering for `text/event-stream` (e.g. nginx `proxy_buffering off;`). See the [Gateway spec §5](../GATEWAY_SPECIFICATION.md#5-sse-handling-the-one-critical-block).

**`503 Service Unavailable` from the API.**
The DB is unreachable, a required `LISTEN` channel isn't attached, or a reset is in progress. Check PostgreSQL connectivity and `GET /readyz`.

**`POST /api/control/reset` returns `404`.**
`CONTROL_API_KEY` is unset — the reset surface is hidden by design. Set it (distinct from `API_KEY`) to enable. See [Configuration](./configuration/api.md#api).

**Duplicate rows after a retry.**
Expected — ingest is append-only, retries append. The matrix still shows the latest; the history drawer shows every row. Make retries idempotent on your side if you want to avoid history noise. See [Integrate your CI/CD](./send-events.md#append-only-semantics).

**Fetcher gets `403` against an org repo even though the token is valid.**
Two common causes: (1) the org enforces SAML SSO and the token hasn't been authorized for it; (2) the token was recently rotated and the new token starts unauthorized — re-authorize before deploying. The `X-GitHub-SSO` header on the 403 contains the authorization URL. If the org also disables fine-grained PATs, a classic PAT with `repo` scope is the required path. See [GitHub token scope](./install/docker-compose.md#2-configure--run) for the full setup, including the re-authorize-after-rotation requirement.

## Still stuck?

- Browse the full [API contract](../api/index.md) and [component specs](../index.md).
- [Open an issue](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues) (bug or feature template).
- Suspected vulnerability? Follow the [Security policy](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/SECURITY.md) — do not file a public issue.
