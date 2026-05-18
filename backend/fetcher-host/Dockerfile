# Fetcher container — optional pull-mode worker (CR-0009).
#
# Per `docs/cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md` § 3a–3d
# and `docs/architecture.md` §7 "Dashboard.Fetcher (optional pull-mode
# adapter)", this is a stand-alone .NET Worker Service that:
#
#   1. Polls CI/CD-tool APIs (MVP: GitHub Actions) on an interval.
#   2. Reuses the existing `POST /api/deployments` write contract.
#   3. Identifies itself via the `X-Progress-Reporter` header
#      (slash-namespaced: e.g. `dashboard-fetcher/github-actions`).
#
# Strict NFR-04: the fetcher has NO inbound HTTP listener. It is purely an
# outbound poller + write-API client. There is therefore:
#   - NO `EXPOSE` directive,
#   - NO `ASPNETCORE_URLS` env-var default,
#   - NO healthcheck stanza in the compose entry (no surface to probe in MVP).
#
# The final-stage image uses the `aspnet:10.0` runtime (not `runtime:10.0`)
# to match the posture of `backend/api/Dockerfile`. This costs ~20 MB of
# layer size but leaves room to bolt on a future health endpoint without
# rebuilding the base image. Same trade-off the API host makes.
#
# Build context: the `backend/` directory (so `Dashboard.sln` and every
# `.csproj` are visible to `dotnet restore`). In docker-compose.local.yml:
#   build:
#     context: ../backend
#     dockerfile: fetcher-host/Dockerfile
#
# Multi-stage:
#   1) .NET 10 SDK builds + publishes the Worker host project, which
#      transitively pulls in the Fetcher library and the shared library.
#   2) .NET 10 ASP.NET Core runtime hosts the published output.

# ----- Build stage --------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ENV DOTNET_NOLOGO=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1
WORKDIR /src

# Copy only csproj files first so the restore layer caches well. The host's
# ProjectReferences to the Fetcher library and the shared library are what
# pull all three projects into the restore graph.
COPY shared/Dashboard.Shared/Dashboard.Shared.csproj shared/Dashboard.Shared/
COPY fetcher/Dashboard.Fetcher/Dashboard.Fetcher.csproj fetcher/Dashboard.Fetcher/
COPY fetcher-host/Dashboard.Fetcher.Host/Dashboard.Fetcher.Host.csproj fetcher-host/Dashboard.Fetcher.Host/

RUN dotnet restore fetcher-host/Dashboard.Fetcher.Host/Dashboard.Fetcher.Host.csproj

# Source files for the three projects we build. Tests are excluded by
# .dockerignore — keeps the build context lean.
COPY shared/Dashboard.Shared/ shared/Dashboard.Shared/
COPY fetcher/Dashboard.Fetcher/ fetcher/Dashboard.Fetcher/
COPY fetcher-host/ fetcher-host/

RUN dotnet publish fetcher-host/Dashboard.Fetcher.Host/Dashboard.Fetcher.Host.csproj \
    -c Release \
    -o /app/publish \
    --no-restore \
    /p:UseAppHost=false

# ----- Runtime stage ------------------------------------------------------
# `aspnet:10.0` rather than `runtime:10.0` — mirrors backend/api/Dockerfile
# posture; leaves room for a future health endpoint without a base-image
# rebuild. The fetcher does NOT bind a listener: no EXPOSE, no
# ASPNETCORE_URLS (NFR-04 strict — outbound-only worker).
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "Dashboard.Fetcher.Host.dll"]
