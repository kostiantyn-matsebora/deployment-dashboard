# Quickstart

Run the whole stack locally with **zero configuration** and watch a live deployment matrix fill in. No API keys, no database setup, no CI/CD wiring.

## Prerequisites

- Docker with Compose v2 (`docker compose version` ≥ 2.x).
- ~1 GB free RAM for the stack.

## Run the demo

The `demo` profile starts everything — Gateway, Frontend, API, PostgreSQL — plus a **Demo Driver**, **GitHub Emulator**, and **Fetcher** that generate realistic deployment traffic. Insecure defaults are applied automatically; nothing to fill in. No clone, no build — all images pull from GHCR.

Fetch the two compose files into a working directory, then start the stack:

```bash
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/docker-compose.yaml
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/docker-compose.demo.yaml
docker compose -f docker-compose.yaml -f docker-compose.demo.yaml --profile demo up
```

> On PowerShell, replace the trailing `\` line-continuations with backticks (`` ` ``).

To pin to a specific release, replace `main` in the URLs with the release tag (e.g. `.../v0.1.0/compose/...`) and set `DASHBOARD_VERSION=0.1.0` for a reproducible deploy — see [Pinning a release version](./install.md#pinning-a-release-version).

Then open:

| URL | What you get |
|---|---|
| <http://localhost:8080> | The dashboard — live services × environments matrix |
| <http://localhost:8080/demo/> | Demo Driver control panel — drive scenarios, reset state, watch event streams |

The gateway (`:8080`) is the **only** published port. Frontend, API, and PostgreSQL stay internal.

## What you're looking at

![The deployment matrix, populated by the demo](../_assets/screenshots/matrix-dark.png#only-dark){ .dd-shot }
![The deployment matrix, populated by the demo](../_assets/screenshots/matrix-light.png#only-light){ .dd-shot }

- **Matrix view** — one row per service, one column per environment. Each slot shows version, status (success / in-progress / failure), actor, elapsed time, and a link to the CI/CD run.
- **Live updates** — new deployment events stream to the browser over SSE. No reload.
- **History** — every slot keeps its full deployment history; open the drawer to see it.

Use the **Demo Driver control panel** to trigger deployment scenarios and a reset, then watch the matrix react in real time.

## Next steps

| You want to… | Go to |
|---|---|
| Deploy this for your team | [Install & deploy](./install.md) |
| Set the API key, database, retention, etc. | [Configuration](./configuration.md) |
| Send real deployments from your pipeline | [Integrate your CI/CD](./send-events.md) |
| Understand how the pieces fit | [Architecture overview](./architecture-overview.md) |
| Troubleshoot | [FAQ & troubleshooting](./faq.md) |
