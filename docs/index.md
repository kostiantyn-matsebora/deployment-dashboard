---
title: Home
nav_order: 1
layout: home
description: Real-time deployment dashboard - services x environments matrix from any CI/CD tool.
---

# Deployment Dashboard

A real-time **services x environments** deployment matrix sourced from any CI/CD tool that can post an HTTP event (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, ...). One glance answers *"what version of service X is running in environment Y right now -- and did the last deployment succeed?"*

- **Read-only / notification-only.** It tracks deployments; it does not trigger them.
- **Tool-agnostic by design.** The backend never talks to a CI/CD tool directly.

> **Built end-to-end by AI.** Every commit, ADR, CR, test, and CI workflow in this repo was authored by AI specialists routed through [`ginee`](https://github.com/kostiantyn-matsebora/ginee), a multi-agent engineering process for small autonomous teams.

## Documentation

| Surface | Pointer |
|---|---|
| Architecture (SAD) | [architecture.md](./architecture.md) |
| Architecture Decision Records | [adr/](./adr/) |
| Change Requests | [cr/](./cr/) |
| CI/CD Integration (inbound) | [ci-cd-integration.md](./ci-cd-integration.md) |
| CI/CD Pipelines (outbound) | [ci-cd-pipelines.md](./ci-cd-pipelines.md) |
| UI Options | [ui/](./ui/) |
| Work Breakdown | [WBS.md](./WBS.md) |
| Install / Quick start | [README on GitHub]({{ site.github.repository_url }}/blob/main/README.md#quick-start-release-install) |

## Governance

[LICENSE]({{ site.github.repository_url }}/blob/main/LICENSE) - [CONTRIBUTING]({{ site.github.repository_url }}/blob/main/CONTRIBUTING.md) - [CODE_OF_CONDUCT]({{ site.github.repository_url }}/blob/main/CODE_OF_CONDUCT.md) - [SECURITY]({{ site.github.repository_url }}/blob/main/SECURITY.md) - [CHANGELOG]({{ site.github.repository_url }}/blob/main/CHANGELOG.md)
