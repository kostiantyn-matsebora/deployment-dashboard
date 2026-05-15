# Read API container — matrix / history / discovery / SSE / health.
#
# As of the App Gateway topology change (SAD §7): the Read API serves
# JSON only. The Angular SPA is built and shipped in its own Dashboard
# Frontend container at `frontend/dashboard/Dockerfile`; the gateway
# (`gateway/nginx.conf`) routes `GET /` to it and `GET /api/*` / SSE /
# health to this image. This Dockerfile no longer has a node build stage
# and the runtime image contains zero static assets.
#
# Build context: the `backend/` directory (so `Dashboard.sln` and the
# `shared/Dashboard.Shared` ProjectReference are visible to `dotnet
# restore`). In docker-compose.local.yml:
#   build:
#     context: ../backend
#     dockerfile: read-api/Dockerfile
#
# Multi-stage per SAD §7:
#   1) .NET 10 SDK builds + publishes the Read API.
#   2) .NET 10 ASP.NET Core runtime hosts the published output.
#
# Final stage based on `mcr.microsoft.com/dotnet/aspnet:10.0`. EXPOSE 8080.

# ----- Build stage --------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy only csproj files first so the restore layer caches well. The
# ProjectReference to Dashboard.Shared in the Read API csproj is what
# pulls the shared library into the restore graph.
COPY shared/Dashboard.Shared/Dashboard.Shared.csproj shared/Dashboard.Shared/
COPY read-api/Dashboard.ReadApi/Dashboard.ReadApi.csproj read-api/Dashboard.ReadApi/

RUN dotnet restore read-api/Dashboard.ReadApi/Dashboard.ReadApi.csproj

# Source files for the two projects we build. We deliberately do not COPY
# tests / write-api — keeps the build context lean.
COPY shared/Dashboard.Shared/ shared/Dashboard.Shared/
COPY read-api/Dashboard.ReadApi/ read-api/Dashboard.ReadApi/

RUN dotnet publish read-api/Dashboard.ReadApi/Dashboard.ReadApi.csproj \
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

ENTRYPOINT ["dotnet", "Dashboard.ReadApi.dll"]
