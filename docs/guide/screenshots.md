# Screenshots

A visual tour of the dashboard. Every image below is the **live demo stack** (`--profile demo`) seeded with the curated demo dataset — exactly what you get from the [Quickstart](./quickstart.md). Toggle the site's light/dark switch and the matrix and swimlane shots follow.

## :material-view-grid-outline: Deployment matrix { #deployment-matrix }

The default view: one row per service, one column per environment. Each tile carries version, status (success / in-progress / failure), actor, commit, elapsed time, and a link to the CI/CD run. KPIs across the top summarise services, environments, in-flight, and failed counts.

![Deployment matrix — dark](../_assets/screenshots/matrix-dark.png#only-dark){ .dd-shot }
![Deployment matrix — light](../_assets/screenshots/matrix-light.png#only-light){ .dd-shot }

## :material-sitemap-outline: Swimlanes { #swimlanes }

A per-service graph view: see how a version flows from `dev` through `qa`, `staging`, `preprod`, and `prod`, with branching topology and status-colored edges.

![Swimlanes — dark](../_assets/screenshots/swimlanes-dark.png#only-dark){ .dd-shot }
![Swimlanes — light](../_assets/screenshots/swimlanes-light.png#only-light){ .dd-shot }

## :material-history: History drawer { #history-drawer }

Click any slot to open its full deployment history — every event ever recorded for that `(service, environment)`, newest first, with status, version, actor, commit, and run reference.

![History drawer](../_assets/screenshots/history-drawer-dark.png){ .dd-shot }

## :material-tune-variant: Demo control panel { #demo-control-panel }

The demo profile ships a **Demo Driver** control panel (`/demo/`): ingest the curated or random dataset, seed the GitHub emulator, drive live emission, trigger a system reset, and watch the deployment feed and component event streams in real time.

![Demo Driver control panel](../_assets/screenshots/demo-panel-dark.png){ .dd-shot }

---

Want to see it for yourself? It's one command:

[:material-rocket-launch-outline: Try the Quickstart](./quickstart.md){ .md-button .md-button--primary }
