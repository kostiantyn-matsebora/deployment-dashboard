---
title: Guide
shortTitle: Guide
intro: 'Adopter guides — run, deploy, configure, and feed the dashboard from any CI/CD, plus an architecture overview and FAQ.'
children:
  - /quickstart
  - /screenshots
  - /ui-settings
  - /install
  - /install-app
  - /configuration
  - /send-events
  - /architecture-overview
  - /faq
---

Task-oriented guides for running and adopting Deployment Dashboard. New here? Start with the Quickstart, then wire your CI/CD.

## Contents

### `quickstart.md`

- [Prerequisites](./quickstart.md#prerequisites)
- [Run the demo](./quickstart.md#run-the-demo)
- [What you're looking at](./quickstart.md#what-youre-looking-at)
- [Next steps](./quickstart.md#next-steps)

### `screenshots.md`

- [Deployment matrix](./screenshots.md#deployment-matrix)
- [Swimlanes](./screenshots.md#swimlanes)
- [History drawer](./screenshots.md#history-drawer)
- [Analytics](./screenshots.md#analytics)
- [Install as an app](./screenshots.md#install-as-an-app)
- [Demo control panel](./screenshots.md#demo-control-panel)
- [Footer](./screenshots.md#footer)

### `ui-settings.md`

- [UI settings & presets](./ui-settings.md#ui-settings-presets)
- [What a preset saves](./ui-settings.md#what-a-preset-saves)
- [Working with presets](./ui-settings.md#working-with-presets)
- [File-based sharing](./ui-settings.md#file-based-sharing)

### `install/` — Install & deploy

- [Concepts in one minute](./install/index.md#concepts-in-one-minute)
- [Deployment shapes](./install/index.md#deployment-shapes)
- [Choose a deployment method](./install/index.md#choose-a-deployment-method)
- [Production checklist](./install/index.md#production-checklist)
- [Pinning a release version](./install/index.md#pinning-a-release-version)
- [Hosting notes](./install/index.md#hosting-notes)

#### `install/docker-compose.md`

- [Get the stack](./install/docker-compose.md#1-get-the-stack)
- [Configure & run](./install/docker-compose.md#2-configure--run)
- [Running from local source](./install/docker-compose.md#running-from-local-source)
- [Pinning a release version](./install/docker-compose.md#pinning-a-release-version)

#### `install/azure-terraform.md`

- [Topology](./install/azure-terraform.md#topology)
- [Prerequisites](./install/azure-terraform.md#prerequisites)
- [Deploy](./install/azure-terraform.md#deploy)
- [Post-deploy steps](./install/azure-terraform.md#post-deploy-steps)
- [Cost](./install/azure-terraform.md#cost)
- [Networking & security](./install/azure-terraform.md#networking--security)

### `install-app.md` — Install as an app

- [What you get](./install-app.md#what-you-get)
- [Install in Chrome or Edge](./install-app.md#install-in-chrome-or-edge)
- [Requirements](./install-app.md#requirements)
- [Uninstall](./install-app.md#uninstall)

### `configuration/` — Configuration

#### `configuration/general.md` — General

- [Stack version](./configuration/general.md#stack-version)

#### `configuration/postgres.md` — PostgreSQL

- [PostgreSQL: bundled profiles](./configuration/postgres.md#postgresql-bundled-profiles)
- [PostgreSQL: external profiles](./configuration/postgres.md#postgresql-external-profiles)
- [PostgreSQL: auth modes](./configuration/postgres.md#postgresql-auth-modes)

#### `configuration/api.md` — API

- [API](./configuration/api.md#api)
- [API: service exclude](./configuration/api.md#service-scope-filter)

#### `configuration/fetcher.md` — Fetcher

- [Fetcher: pull mode](./configuration/fetcher.md#fetcher-pull-mode)
- [Fetcher: workflow exclude](./configuration/fetcher.md#github-workflow-exclude)

#### `configuration/demo.md` — Demo

- [Demo / dev only](./configuration/demo.md#demo-dev-only)

### `send-events.md`

- [The one endpoint](./send-events.md#the-one-endpoint)
- [Payload](./send-events.md#payload)
- [Responses](./send-events.md#responses)
- [Append-only semantics](./send-events.md#append-only-semantics)
- [Copy-paste integrations](./send-events.md#copy-paste-integrations)
- [Verify it worked](./send-events.md#verify-it-worked)

### `architecture-overview.md`

- [The question it answers](./architecture-overview.md#the-question-it-answers)
- [Data flow](./architecture-overview.md#data-flow)
- [Components](./architecture-overview.md#components)
- [Key design properties](./architecture-overview.md#key-design-properties)
- [Security model (short version)](./architecture-overview.md#security-model-short-version)

### `faq.md`

- [Adoption](./faq.md#adoption)
- [Troubleshooting](./faq.md#troubleshooting)
- [Still stuck?](./faq.md#still-stuck)
