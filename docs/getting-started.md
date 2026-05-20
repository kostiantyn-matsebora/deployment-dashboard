---
title: Get Started
nav_order: 2
description: Spin up a demo install of the dashboard in 60 seconds and see real deployment data flow.
---

# Get Started

A 60-second walkthrough: clean machine to a live dashboard rendering real deployment activity, no PAT, no config.

For the full install reference (custom port, version pinning, contributor flow, escape hatches), see [install.md](install.html).

## Prerequisites

| Prereq | Notes |
|---|---|
| **Docker** (Engine + Compose v2) | Runs the four release images + the one-shot migrations container. |
| **`gh` CLI** authenticated | Required to fetch the installer from a private release repo + pull private GHCR images. `gh auth login` then `gh auth refresh --hostname github.com --scopes read:packages`. |

Full prereq detail (token scopes, OS-specific install commands, verify steps): [install.html#prerequisites](install.html#prerequisites).

## 60-second demo install

Demo mode (`-Demo` / `--demo`) bakes in two public repos (`PostHog/posthog` + `grafana/grafana`) and a 60-second poll interval, so the matrix paints with real deployment activity end-to-end. **No `GHA_TOKEN` required** — the fetcher uses GitHub's anonymous-mode rate bucket (60 req/h), which is enough to render on first boot.

### Windows (PowerShell 7+)

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1 -Demo
# Open http://localhost:8080
```

### Linux / macOS

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
bash install.sh --demo
# Open http://localhost:8080
```

## What you'll see

The installer prints a URL panel + the generated `API_TOKEN` once (also persisted to `./dashboard-release/dashboard.env`). On the dashboard:

- **Matrix** of services x environments. The two seeded repos surface multiple services each — expect a richer first-render than a single-repo demo would give.
- **Box states** populate live as the fetcher polls (every 60 s in demo mode): success / failure / in-flight / pending / unknown / stale.
- **PR-ephemeral envs** show up alongside steady-state ones: PostHog's `posthog-NNNN-*` columns and Grafana's `storybook-pr-preview-NNNNN` columns are part of the demo output by design (they're real GitHub Actions deployments).
- **Real-time updates** — SSE pushes new events to the SPA without a page refresh (≤ 5 s after the fetcher records them).
- **Views + layouts** — toggle Detailed / Compact / Glance / Focus and Matrix / Swim-lane / Workflow-rows from the header.

## Try it with your own CI/CD

The demo mode uses the optional fetcher worker against public repos. To wire up your own pipelines:

- **Non-demo install** — drop the `-Demo` / `--demo` flag and use the standard install path. See [install.html#windows-powershell-7](install.html#windows-powershell-7) or [install.html#linux--macos](install.html#linux--macos).
- **POST your own events** — any CI/CD tool that can issue an HTTP request can feed the matrix. Endpoint + payload contract + per-tool snippet examples: [ci-cd-integration.html](ci-cd-integration.html).
- **Architecture context** — wire-shape and topology: [architecture.html](architecture.html) §7.

## Stop / clean up

```powershell
# Windows — preserve data + secrets
pwsh -NoProfile -File uninstall.ps1
# Drop everything (irreversible)
pwsh -NoProfile -File uninstall.ps1 -RemoveData -RemoveSecrets
```

```bash
# Linux / macOS — preserve data + secrets
./uninstall.sh
# Drop everything (irreversible)
./uninstall.sh --remove-data --remove-secrets
```

Full uninstall variants (data only / secrets only): [install.html#uninstall](install.html#uninstall).
