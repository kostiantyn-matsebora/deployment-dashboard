---
title: Configuration
shortTitle: Configuration
intro: 'Every environment variable grouped by concern — General, PostgreSQL, API, Fetcher, and Demo.'
children:
  - /general
  - /postgres
  - /api
  - /fetcher
  - /demo
---

# Configuration

Every environment variable, grouped by concern. Source of truth: [`compose/.env.example`](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/compose/.env.example). Copy it to `compose/.env` and set the values for your [profile](../install/docker-compose.md#2-configure--run).

## Contents

### `general.md` — General

- [Stack version](./general.md#stack-version)

### `postgres.md` — PostgreSQL

- [PostgreSQL: bundled profiles](./postgres.md#postgresql-bundled-profiles)
- [PostgreSQL: external profiles](./postgres.md#postgresql-external-profiles)
- [PostgreSQL: auth modes](./postgres.md#postgresql-auth-modes)

### `api.md` — API

- [API](./api.md#api)
- [API: service exclude](./api.md#service-scope-filter)

### `fetcher.md` — Fetcher

- [Fetcher: pull mode](./fetcher.md#fetcher-pull-mode)
- [Fetcher: workflow exclude](./fetcher.md#github-workflow-exclude)

### `demo.md` — Demo

- [Demo / dev only](./demo.md#demo-dev-only)
- [Demo-gateway image vars](./demo.md#demo-gateway-image-vars)

