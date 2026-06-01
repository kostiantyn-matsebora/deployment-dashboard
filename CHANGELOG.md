# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — currently pre-1.0, expect breaking changes between minor versions.

## [Unreleased]


## [0.1.0] - 2026-06-02

### Added

- Release workflow (`.github/workflows/release.yml`): fires on a pushed `v*.*.*` tag; builds and pushes six versioned images to GHCR (`api`, `spa`, `gateway`, `fetcher`, `demo-driver`, `github-emulator`) under tags `X.Y.Z`, `X.Y`, and `latest`; creates a GitHub Release with CHANGELOG-extracted notes and a bundled compose zip.
- `scripts/release/New-Release.ps1`: release-prep script — bumps CHANGELOG, creates a `release/vX.Y.Z` branch, commits, pushes, and opens a PR. Tag creation remains a manual step after the PR merges.
- `DASHBOARD_VERSION` compose variable: pins all six stack images to a specific published release. Defaults to `latest`. Set without a leading `v` (e.g. `0.1.0`, not `v0.1.0`).
- Downloadable compose bundle (`compose/*.yaml` + `compose/.env.example`) attached to each GitHub Release for clone-free pinned deployments.
- `RELEASING.md`: maintainer release guide covering versioning policy, the end-to-end release flow, pre-releases, hotfixes, and version pinning.

### Changed

- `fetcher-host` and `github-emulator` compose services now run from published GHCR images by default (`${DASHBOARD_VERSION:-latest}`); local source builds moved to `docker-compose.local.yaml`.
