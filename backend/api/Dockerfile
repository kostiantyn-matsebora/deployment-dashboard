# API container — single host composing the Write and Read surfaces.
#
# Per SAD §7 "Backend module architecture" and §10 Decision 11, the .NET
# solution is a thin host project (`backend/api/`) that references the
# Write and Read library projects plus the shared library. One Dockerfile,
# one image, one ACA container app. The host applies API-key middleware
# to the write endpoint group only; the read endpoints stay unauthenticated.
#
# Build context: the `backend/` directory (so `Dashboard.sln` and all four
# `.csproj` files are visible to `dotnet restore`). In docker-compose.local.yml:
#   build:
#     context: ../backend
#     dockerfile: api/Dockerfile
#
# Multi-stage:
#   1) .NET 10 SDK builds + publishes the host project (which transitively
#      pulls in the write-api, read-api, and shared libraries).
#   2) .NET 10 ASP.NET Core runtime hosts the published output.
#
# Serves JSON only — no SPA stage, no static-asset hosting. The Angular SPA
# is shipped in its own nginx container at `frontend/dashboard/`, and both
# sit behind the App Gateway. Final stage based on
# `mcr.microsoft.com/dotnet/aspnet:10.0`. EXPOSE 8080 per SAD §7.

# ----- Build stage --------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ENV DOTNET_NOLOGO=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1
WORKDIR /src

# Copy only csproj files first so the restore layer caches well. The host's
# ProjectReferences to write-api, read-api, and shared are what pull all
# four projects into the restore graph.
COPY shared/Dashboard.Shared/Dashboard.Shared.csproj shared/Dashboard.Shared/
COPY write-api/Dashboard.WriteApi/Dashboard.WriteApi.csproj write-api/Dashboard.WriteApi/
COPY read-api/Dashboard.ReadApi/Dashboard.ReadApi.csproj read-api/Dashboard.ReadApi/
COPY api/Dashboard.Api/Dashboard.Api.csproj api/Dashboard.Api/

RUN dotnet restore api/Dashboard.Api/Dashboard.Api.csproj

# Source files for the four projects we build. Tests are excluded by
# .dockerignore — keeps the build context lean.
COPY shared/Dashboard.Shared/ shared/Dashboard.Shared/
COPY write-api/Dashboard.WriteApi/ write-api/Dashboard.WriteApi/
COPY read-api/Dashboard.ReadApi/ read-api/Dashboard.ReadApi/
COPY api/ api/

RUN dotnet publish api/Dashboard.Api/Dashboard.Api.csproj \
    -c Release \
    -o /app/publish \
    --no-restore \
    /p:UseAppHost=false

# ----- Runtime stage ------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# Bind to 8080 inside the container (SAD §7).
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "Dashboard.Api.dll"]
